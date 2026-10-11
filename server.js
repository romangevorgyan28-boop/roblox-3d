const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ===== АНТИЧИТ =====
const RATE_LIMIT_MS = 50;
const MAX_SPEED = 0.5;
const rateLimits = new Map();

// ===== СОСТОЯНИЕ ШУТЕРА =====
const ShooterState = {
  LOBBY: 'lobby',
  MAP_SELECT: 'map_select',
  TEAM_SELECT: 'team_select',
  PLAYING: 'playing',
  ROUND_END: 'round_end'
};

const players = new Map();
const shooter = {
  state: ShooterState.LOBBY,
  map: 'arena',
  red: [],
  blue: [],
  redScore: 0,
  blueScore: 0,
  roundTimer: 180,
  roundInterval: null,
  waitingPlayers: []
};

// ===== ПОДКЛЮЧЕНИЕ =====
wss.on('connection', (ws) => {
  let pid = null;

  ws.on('message', (raw) => {
    try {
      const d = JSON.parse(raw);

      // Rate limit
      const now = Date.now();
      const lastMsg = rateLimits.get(pid) || 0;
      if (pid && now - lastMsg < RATE_LIMIT_MS) return;
      if (pid) rateLimits.set(pid, now);

      // РЕГИСТРАЦИЯ
      if (d.type === 'register') {
        const name = String(d.name || 'Guest').replace(/[<>\"&]/g, '').trim().substring(0, 16);
        if (name.length < 2) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Короткий ник' }));
          return;
        }
        pid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        players.set(pid, {
          ws, name, game: 'menu',
          x: 0, y: 1, z: 0, yaw: 0, pitch: 0,
          health: 100, team: null,
          input: { f: 0, r: 0, jump: false },
          lastAction: 0
        });
        ws.send(JSON.stringify({ type: 'registered', id: pid, name }));
        console.log(`[+] ${name} connected (${pid})`);
        broadcastShooterState();
        return;
      }

      if (!pid || !players.has(pid)) return;
      const p = players.get(pid);

      // ВВОД
      if (d.type === 'input') {
        p.input = {
          f: typeof d.f === 'number' ? Math.max(-1, Math.min(1, d.f)) : 0,
          r: typeof d.r === 'number' ? Math.max(-1, Math.min(1, d.r)) : 0,
          jump: !!d.jump
        };
        if (typeof d.yaw === 'number') p.yaw = d.yaw;
        if (typeof d.pitch === 'number') p.pitch = d.pitch;
      }

      // ВХОД В ИГРУ
      if (d.type === 'join' && d.gameId === 'shooter') {
        p.game = 'shooter';
        p.health = 100;
        p.team = null;
        
        if (shooter.state === ShooterState.PLAYING) {
          shooter.waitingPlayers.push(pid);
          ws.send(JSON.stringify({ 
            type: 'waiting_lobby', 
            msg: 'Раунд идёт. Ждите окончания...',
            time: shooter.roundTimer
          }));
        } else {
          ws.send(JSON.stringify({ type: 'gameReady', state: shooter.state }));
        }
        broadcastShooterState();
        return;
      }

      // ВЫБОР КАРТЫ
      if (d.type === 'select_map' && shooter.state === ShooterState.MAP_SELECT) {
        shooter.map = d.map || 'arena';
        shooter.state = ShooterState.TEAM_SELECT;
        broadcastShooterState();
        return;
      }

      // ВЫБОР КОМАНДЫ
      if (d.type === 'select_team' && shooter.state === ShooterState.TEAM_SELECT) {
        const team = d.team;
        if (team !== 'red' && team !== 'blue') return;
        const teamList = team === 'red' ? shooter.red : shooter.blue;
        
        if (teamList.length < 2 && !shooter.red.includes(pid) && !shooter.blue.includes(pid)) {
          teamList.push(pid);
          p.team = team;
          broadcastShooterState();
          
          if (shooter.red.length === 2 && shooter.blue.length === 2) {
            setTimeout(() => startRound(), 1000);
          }
        }
        return;
      }

      // ДЕЙСТВИЕ (СТРЕЛЬБА)
      if (d.type === 'action' && p.game === 'shooter' && shooter.state === ShooterState.PLAYING && p.team) {
        const now2 = Date.now();
        if (now2 - p.lastAction < 500) return; // Античит: не чаще 2 выстрелов в секунду
        p.lastAction = now2;

        const enemyTeam = p.team === 'red' ? shooter.blue : shooter.red;
        let hit = false;
        enemyTeam.forEach(oid => {
          const other = players.get(oid);
          if (!other) return;
          const dist = Math.hypot(other.x - p.x, other.z - p.z);
          if (dist < 10) {
            other.health -= 25;
            hit = true;
            if (other.health <= 0) {
              other.health = 100;
              other.x = p.team === 'red' ? -20 + Math.random() * 5 : 20 + Math.random() * 5;
              other.z = (Math.random() - 0.5) * 20;
              if (p.team === 'red') shooter.redScore++;
              else shooter.blueScore++;
              broadcastShooterState();
              broadcastToShooter({ type: 'kill', killer: p.name, victim: other.name });
            }
          }
        });
        ws.send(JSON.stringify({ type: 'shoot', hit }));
        broadcastToShooter({ type: 'shoot_effect', shooter: pid, hit });
        return;
      }

      // ЧАТ
      if (d.type === 'chat' && d.msg) {
        const msg = String(d.msg).replace(/[<>]/g, '').trim().substring(0, 200);
        if (msg) broadcastToShooter({ type: 'chat', name: p.name, msg });
      }

    } catch (e) {
      console.error('WS Error:', e);
    }
  });

  ws.on('close', () => {
    if (pid && players.has(pid)) {
      const p = players.get(pid);
      if (p.game === 'shooter') {
        shooter.red = shooter.red.filter(id => id !== pid);
        shooter.blue = shooter.blue.filter(id => id !== pid);
        shooter.waitingPlayers = shooter.waitingPlayers.filter(id => id !== pid);
        if (shooter.state === ShooterState.PLAYING) {
          if (shooter.red.length < 1 || shooter.blue.length < 1) {
            endRound();
          }
        }
      }
      players.delete(pid);
      rateLimits.delete(pid);
      broadcastShooterState();
    }
  });

  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
});

// ===== НАЧАЛО РАУНДА =====
function startRound() {
  shooter.state = ShooterState.PLAYING;
  shooter.roundTimer = 180;
  shooter.redScore = 0;
  shooter.blueScore = 0;
  
  shooter.red.forEach(pid => {
    const p = players.get(pid);
    if (p) {
      p.health = 100;
      p.x = -20 + Math.random() * 5;
      p.z = (Math.random() - 0.5) * 20;
      p.y = 1;
      p.ws.send(JSON.stringify({ type: 'round_start', team: 'red', time: 180, map: shooter.map }));
    }
  });
  
  shooter.blue.forEach(pid => {
    const p = players.get(pid);
    if (p) {
      p.health = 100;
      p.x = 20 + Math.random() * 5;
      p.z = (Math.random() - 0.5) * 20;
      p.y = 1;
      p.ws.send(JSON.stringify({ type: 'round_start', team: 'blue', time: 180, map: shooter.map }));
    }
  });
  
  // Ждущие игроки тоже начинают
  shooter.waitingPlayers.forEach(pid => {
    const p = players.get(pid);
    if (p) {
      p.health = 100;
      p.team = Math.random() > 0.5 ? 'red' : 'blue';
      p.x = p.team === 'red' ? -20 : 20;
      p.z = (Math.random() - 0.5) * 20;
      p.y = 1;
      if (p.team === 'red') shooter.red.push(pid);
      else shooter.blue.push(pid);
      p.ws.send(JSON.stringify({ type: 'round_start', team: p.team, time: 180, map: shooter.map }));
    }
  });
  shooter.waitingPlayers = [];
  
  broadcastShooterState();
  
  shooter.roundInterval = setInterval(() => {
    shooter.roundTimer--;
    if (shooter.roundTimer <= 0) {
      endRound();
    } else {
      broadcastToShooter({ type: 'timer', time: shooter.roundTimer });
    }
  }, 1000);
}

// ===== КОНЕЦ РАУНДА =====
function endRound() {
  if (shooter.roundInterval) {
    clearInterval(shooter.roundInterval);
    shooter.roundInterval = null;
  }
  
  const winner = shooter.redScore > shooter.blueScore ? 'red' : 
                 shooter.blueScore > shooter.redScore ? 'blue' : 'draw';
  
  broadcastToShooter({ 
    type: 'round_end', 
    winner, 
    redScore: shooter.redScore, 
    blueScore: shooter.blueScore 
  });
  
  setTimeout(() => {
    shooter.state = ShooterState.LOBBY;
    shooter.red = [];
    shooter.blue = [];
    shooter.waitingPlayers = [];
    players.forEach(p => {
      if (p.game === 'shooter') {
        p.team = null;
        p.ws.send(JSON.stringify({ type: 'back_to_lobby' }));
      }
    });
    broadcastShooterState();
  }, 5000);
}

// ===== РАССЫЛКА СОСТОЯНИЯ ШУТЕРА =====
function broadcastShooterState() {
  const shooterPlayers = Array.from(players.values()).filter(p => p.game === 'shooter');
  const data = {
    type: 'shooter_state',
    state: shooter.state,
    playerCount: shooterPlayers.length,
    map: shooter.map,
    red: shooter.red.map(id => players.get(id)?.name).filter(Boolean),
    blue: shooter.blue.map(id => players.get(id)?.name).filter(Boolean),
    redScore: shooter.redScore,
    blueScore: shooter.blueScore,
    time: shooter.roundTimer
  };
  shooterPlayers.forEach(p => {
    try { p.ws.send(JSON.stringify(data)); } catch(e) {}
  });
}

function broadcastToShooter(data) {
  const msg = JSON.stringify(data);
  players.forEach(p => {
    if (p.ws.readyState === 1 && p.game === 'shooter') {
      try { p.ws.send(msg); } catch(e) {}
    }
  });
}

// ===== ИГРОВОЙ ЦИКЛ =====
setInterval(() => {
  players.forEach(p => {
    if (p.ws.readyState !== 1) return;
    
    // Физика только для шутера во время раунда
    if (p.game === 'shooter' && shooter.state === ShooterState.PLAYING) {
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      const newX = p.x + (p.input.f * fx + p.input.r * rx) * 0.15;
      const newZ = p.z + (p.input.f * fz + p.input.r * rz) * 0.15;
      
      // Античит: проверка скорости
      const dist = Math.hypot(newX - p.x, newZ - p.z);
      if (dist <= MAX_SPEED) {
        p.x = Math.max(-50, Math.min(50, newX));
        p.z = Math.max(-50, Math.min(50, newZ));
      }
      
      if (p.input.jump && p.y <= 1.1) { p.y = 3.2; p.input.jump = false; }
      if (p.y > 1) p.y -= 0.22;
      if (p.y < 1) p.y = 1;

      const nearby = [];
      const allTeam = [...shooter.red, ...shooter.blue];
      allTeam.forEach(oid => {
        const other = players.get(oid);
        if (other && oid !== p.id && Math.hypot(other.x - p.x, other.z - p.z) < 60) {
          nearby.push({ 
            id: oid, name: other.name, 
            x: other.x, y: other.y, z: other.z, 
            yaw: other.yaw, team: other.team, health: other.health 
          });
        }
      });
      
      p.ws.send(JSON.stringify({ 
        type: 'snapshot', 
        players: nearby, 
        health: p.health, 
        team: p.team,
        scores: { red: shooter.redScore, blue: shooter.blueScore }
      }));
    }
  });
}, 1000 / 24);

// Heartbeat
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

server.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));

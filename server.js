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

// ===== СОСТОЯНИЕ ИГРЫ =====
const GameState = {
  LOBBY: 'lobby',
  MAP_SELECT: 'map_select',
  TEAM_SELECT: 'team_select',
  PLAYING: 'playing',
  ROUND_END: 'round_end'
};

const players = new Map();
const shooterState = {
  state: GameState.LOBBY,
  map: null,
  red: [],
  blue: [],
  redScore: 0,
  blueScore: 0,
  roundTimer: 180,
  roundInterval: null
};

wss.on('connection', (ws) => {
  let pid = null;

  ws.on('message', (raw) => {
    try {
      const d = JSON.parse(raw);

      if (d.type === 'register') {
        const name = (d.name || 'Guest').trim().slice(0, 16);
        pid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        players.set(pid, {
          ws, name, game: 'menu', x: 0, y: 1, z: 0, yaw: 0,
          health: 100, team: null, input: { f: 0, r: 0, jump: false }
        });
        ws.send(JSON.stringify({ type: 'registered', id: pid, name }));
        console.log(`[+] ${name} connected`);
        broadcastShooterState();
        return;
      }

      if (!pid || !players.has(pid)) return;
      const p = players.get(pid);

      if (d.type === 'input') {
        p.input = {
          f: typeof d.f === 'number' ? Math.max(-1, Math.min(1, d.f)) : 0,
          r: typeof d.r === 'number' ? Math.max(-1, Math.min(1, d.r)) : 0,
          jump: !!d.jump
        };
        if (typeof d.yaw === 'number') p.yaw = d.yaw;
      }

      if (d.type === 'join' && d.gameId === 'shooter') {
        p.game = 'shooter';
        p.health = 100;
        p.x = (Math.random() - 0.5) * 10;
        p.z = (Math.random() - 0.5) * 10;
        p.y = 1;
        p.team = null;
        
        if (shooterState.state === GameState.PLAYING) {
          ws.send(JSON.stringify({ type: 'waiting_lobby', msg: 'Раунд идёт. Ждите окончания...' }));
        } else {
          ws.send(JSON.stringify({ type: 'gameReady', state: shooterState.state }));
        }
        broadcastShooterState();
      }

      if (d.type === 'select_map') {
        if (shooterState.state === GameState.MAP_SELECT) {
          shooterState.map = d.map;
          shooterState.state = GameState.TEAM_SELECT;
          broadcastShooterState();
        }
      }

      if (d.type === 'select_team') {
        if (shooterState.state === GameState.TEAM_SELECT) {
          const team = d.team;
          const teamList = team === 'red' ? shooterState.red : shooterState.blue;
          if (teamList.length < 2 && !shooterState.red.includes(pid) && !shooterState.blue.includes(pid)) {
            teamList.push(pid);
            p.team = team;
            broadcastShooterState();
            
            if (shooterState.red.length === 2 && shooterState.blue.length === 2) {
              startRound();
            }
          }
        }
      }

      if (d.type === 'action' && p.game === 'shooter' && shooterState.state === GameState.PLAYING && p.team) {
        const enemyTeam = p.team === 'red' ? shooterState.blue : shooterState.red;
        enemyTeam.forEach(oid => {
          const other = players.get(oid);
          if (other) {
            const dist = Math.hypot(other.x - p.x, other.z - p.z);
            if (dist < 8) {
              other.health -= 25;
              if (other.health <= 0) {
                other.health = 100;
                other.x = (Math.random() - 0.5) * 10;
                other.z = (Math.random() - 0.5) * 10;
                if (p.team === 'red') shooterState.redScore++;
                else shooterState.blueScore++;
                broadcastShooterState();
              }
            }
          }
        });
        broadcastToShooter({ type: 'shoot', shooter: pid });
      }

      if (d.type === 'chat' && d.msg) {
        const msg = d.msg.substring(0, 120);
        broadcastToShooter({ type: 'chat', name: p.name, msg });
      }

    } catch (e) { console.error('WS Error:', e); }
  });

  ws.on('close', () => {
    if (pid && players.has(pid)) {
      const p = players.get(pid);
      if (p.game === 'shooter') {
        shooterState.red = shooterState.red.filter(id => id !== pid);
        shooterState.blue = shooterState.blue.filter(id => id !== pid);
        if (shooterState.state === GameState.PLAYING) {
          if (shooterState.red.length < 2 || shooterState.blue.length < 2) {
            endRound();
          }
        }
      }
      players.delete(pid);
      broadcastShooterState();
    }
  });

  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
});

function startRound() {
  shooterState.state = GameState.PLAYING;
  shooterState.roundTimer = 180;
  shooterState.redScore = 0;
  shooterState.blueScore = 0;
  
  shooterState.red.forEach(pid => {
    const p = players.get(pid);
    if (p) {
      p.health = 100;
      p.x = -20 + Math.random() * 10;
      p.z = (Math.random() - 0.5) * 20;
      p.y = 1;
      p.ws.send(JSON.stringify({ type: 'round_start', team: 'red', time: 180 }));
    }
  });
  
  shooterState.blue.forEach(pid => {
    const p = players.get(pid);
    if (p) {
      p.health = 100;
      p.x = 20 + Math.random() * 10;
      p.z = (Math.random() - 0.5) * 20;
      p.y = 1;
      p.ws.send(JSON.stringify({ type: 'round_start', team: 'blue', time: 180 }));
    }
  });
  
  broadcastShooterState();
  
  shooterState.roundInterval = setInterval(() => {
    shooterState.roundTimer--;
    if (shooterState.roundTimer <= 0) {
      endRound();
    } else {
      broadcastToShooter({ type: 'timer', time: shooterState.roundTimer });
    }
  }, 1000);
}

function endRound() {
  if (shooterState.roundInterval) {
    clearInterval(shooterState.roundInterval);
    shooterState.roundInterval = null;
  }
  
  const winner = shooterState.redScore > shooterState.blueScore ? 'red' : 
                 shooterState.blueScore > shooterState.redScore ? 'blue' : 'draw';
  
  broadcastToShooter({ 
    type: 'round_end', 
    winner, 
    redScore: shooterState.redScore, 
    blueScore: shooterState.blueScore 
  });
  
  setTimeout(() => {
    shooterState.state = GameState.LOBBY;
    shooterState.red = [];
    shooterState.blue = [];
    shooterState.map = null;
    players.forEach(p => {
      if (p.game === 'shooter') {
        p.team = null;
        p.ws.send(JSON.stringify({ type: 'back_to_lobby' }));
      }
    });
    broadcastShooterState();
  }, 5000);
}

function broadcastShooterState() {
  const shooterPlayers = Array.from(players.values()).filter(p => p.game === 'shooter');
  const data = {
    type: 'shooter_state',
    state: shooterState.state,
    playerCount: shooterPlayers.length,
    map: shooterState.map,
    red: shooterState.red.map(id => players.get(id)?.name).filter(Boolean),
    blue: shooterState.blue.map(id => players.get(id)?.name).filter(Boolean),
    redScore: shooterState.redScore,
    blueScore: shooterState.blueScore,
    time: shooterState.roundTimer
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

setInterval(() => {
  players.forEach(p => {
    if (p.ws.readyState !== 1 || p.game !== 'shooter' || shooterState.state !== GameState.PLAYING) return;
    
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    p.x += (p.input.f * fx + p.input.r * rx) * 0.15;
    p.z += (p.input.f * fz + p.input.r * rz) * 0.15;
    p.x = Math.max(-50, Math.min(50, p.x));
    p.z = Math.max(-50, Math.min(50, p.z));
    if (p.input.jump && p.y <= 1.1) { p.y = 3.2; p.input.jump = false; }
    if (p.y > 1) p.y -= 0.22;
    if (p.y < 1) p.y = 1;

    const nearby = [];
    const teamPlayers = p.team === 'red' ? shooterState.red : shooterState.blue;
    const enemyPlayers = p.team === 'red' ? shooterState.blue : shooterState.red;
    [...teamPlayers, ...enemyPlayers].forEach(oid => {
      const other = players.get(oid);
      if (other && oid !== p.id && Math.hypot(other.x - p.x, other.z - p.z) < 60) {
        nearby.push({ id: oid, name: other.name, x: other.x, y: other.y, z: other.z, yaw: other.yaw, team: other.team, health: other.health });
      }
    });
    
    p.ws.send(JSON.stringify({ type: 'snapshot', players: nearby, health: p.health, team: p.team }));
  });
}, 1000 / 24);

setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

server.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));

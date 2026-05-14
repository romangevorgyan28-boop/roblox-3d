/**
 * 🧱 ROBLOX 3D FULL SERVER
 * Оптимизирован под 512 МБ ОЗУ / 0.1 CPU
 * Поддержка 4 игр, мобильное управление, ники, регистрация
 */

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ 
  server, 
  maxPayload: 64 * 1024,
  perMessageDeflate: false 
});

const PORT = process.env.PORT || 3000;

// Раздача статических файлов из корня
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// КОНФИГУРАЦИЯ ИГР
// ==========================================
const GAMES = {
  brookhaven: { name: 'Brookhaven RP', mapSize: 80, spawnRange: 30 },
  shooter:    { name: 'Team Shooter', mapSize: 70, teams: ['red', 'blue'], respawnTime: 3000 },
  brainrot:   { name: 'Steal a Brainrot', mapSize: 60, artifactSpawn: { x: 0, z: 0 } },
  cheese:     { name: 'Horror of Cheese', mapSize: 50, cheeseCount: 9, ratSpeed: 4.5 }
};

// ==========================================
// СОСТОЯНИЕ СЕРВЕРА
// ==========================================
const players = new Map();
const gameStates = new Map();
let nextId = 1;

// Инициализация состояний игр
Object.keys(GAMES).forEach(gameId => {
  const cfg = GAMES[gameId];
  const state = {
    id: gameId,
    config: cfg,
    objects: new Map(),
    enemies: new Map(),
    scores: { red: 0, blue: 0 },
    time: 0
  };

  if (gameId === 'brainrot') {
    state.objects.set('artifact', { type: 'artifact', x: cfg.artifactSpawn.x, z: cfg.artifactSpawn.z, collected: false, holderId: null });
  }
  if (gameId === 'cheese') {
    for (let i = 0; i < cfg.cheeseCount; i++) {
      state.objects.set(`cheese_${i}`, { 
        type: 'cheese', 
        x: (Math.random() - 0.5) * (cfg.mapSize - 10), 
        z: (Math.random() - 0.5) * (cfg.mapSize - 10),
        collected: false 
      });
    }
    state.enemies.set('rat', { type: 'rat', x: 0, z: cfg.mapSize / 2 - 5, yaw: 0 });
  }

  gameStates.set(gameId, state);
});

// ==========================================
// КЛАСС ИГРОКА
// ==========================================
class Player {
  constructor(id, ws, name, gameId) {
    this.id = id;
    this.ws = ws;
    this.name = name.substring(0, 16);
    this.gameId = gameId;
    this.x = (Math.random() - 0.5) * 20;
    this.y = 1;
    this.z = (Math.random() - 0.5) * 20;
    this.yaw = 0;
    this.health = 100;
    this.team = null;
    this.input = { f: 0, r: 0, jump: false, action: false };
    this.lastSnapshot = { x: this.x, y: this.y, z: this.z, yaw: this.yaw };
    
    if (gameId === 'shooter') {
      this.team = players.size % 2 === 0 ? 'red' : 'blue';
      this.respawnTimer = 0;
    }
  }

  getPublicData() {
    return {
      id: this.id,
      name: this.name,
      x: this.x,
      y: this.y,
      z: this.z,
      yaw: this.yaw,
      health: this.health,
      team: this.team,
      gameId: this.gameId
    };
  }
}

// ==========================================
// WEBSOCKET ОБРАБОТКА
// ==========================================
wss.on('connection', (ws) => {
  ws.isAlive = true;
  
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      const player = players.get(data.playerId);
      
      if (!player && data.type === 'register') {
        // Регистрация нового игрока
        const id = nextId++;
        const name = data.name || `Player_${id}`;
        const newPlayer = new Player(id, ws, name, 'brookhaven');
        players.set(id, newPlayer);
        
        ws.send(JSON.stringify({ 
          type: 'registered', 
          id, 
          name, 
          players: Array.from(players.values()).filter(p => p.id !== id).map(p => p.getPublicData()) 
        }));
        
        // Уведомляем остальных
        broadcast({ type: 'playerJoined', player: newPlayer.getPublicData() }, id);
        console.log(`[+] ${name} зарегистрирован. Онлайн: ${players.size}`);
        return;
      }

      if (!player) return;

      if (data.type === 'input') {
        player.input = {
          f: typeof data.f === 'number' ? Math.max(-1, Math.min(1, data.f)) : 0,
          r: typeof data.r === 'number' ? Math.max(-1, Math.min(1, data.r)) : 0,
          jump: !!data.jump,
          action: !!data.action
        };
        if (typeof data.yaw === 'number') player.yaw = data.yaw;
      }

      if (data.type === 'switchGame' && GAMES[data.gameId]) {
        player.gameId = data.gameId;
        player.x = (Math.random() - 0.5) * 10;
        player.z = (Math.random() - 0.5) * 10;
        player.y = 1;
        player.health = 100;
        if (data.gameId === 'shooter') player.team = players.size % 2 === 0 ? 'red' : 'blue';
        
        ws.send(JSON.stringify({ type: 'gameSwitched', gameId: data.gameId }));
        broadcast({ type: 'playerMoved', player: player.getPublicData() });
      }

      if (data.type === 'chat' && data.msg) {
        broadcast({ type: 'chat', name: player.name, msg: data.msg.substring(0, 120) });
      }

    } catch (e) {
      // Игнорируем битые пакеты
    }
  });

  ws.on('close', () => {
    for (const [id, p] of players) {
      if (p.ws === ws) {
        players.delete(id);
        broadcast({ type: 'playerLeft', playerId: id });
        console.log(`[-] ${p.name} отключился. Онлайн: ${players.size}`);
        break;
      }
    }
  });
});

// ==========================================
// ИГРОВОЙ ЦИКЛ (20 ТИКОВ/СЕК)
// ==========================================
setInterval(() => {
  const dt = 0.05;
  const speed = 6;
  const halfMap = 40;

  players.forEach(player => {
    if (player.ws.readyState !== 1) return;

    // Физика движения
    const fx = -Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    const rx = Math.cos(player.yaw);
    const rz = -Math.sin(player.yaw);

    player.x += (player.input.f * fx + player.input.r * rx) * speed * dt;
    player.z += (player.input.f * fz + player.input.r * rz) * speed * dt;
    
    // Прыжок (визуальный + серверный)
    if (player.input.jump && player.y <= 1.01) {
      player.y = 2.5;
      player.input.jump = false;
    }
    if (player.y > 1) player.y -= 12 * dt;
    if (player.y < 1) player.y = 1;

    // Границы
    player.x = Math.max(-halfMap, Math.min(halfMap, player.x));
    player.z = Math.max(-halfMap, Math.min(halfMap, player.z));

    // Логика игр
    const state = gameStates.get(player.gameId);
    if (state) {
      if (player.gameId === 'brainrot') {
        const art = state.objects.get('artifact');
        if (art && !art.collected && player.input.action) {
          const dist = Math.hypot(player.x - art.x, player.z - art.z);
          if (dist < 3) {
            art.collected = true;
            art.holderId = player.id;
            broadcast({ type: 'artifactStolen', playerId: player.id, name: player.name });
          }
        }
      }

      if (player.gameId === 'cheese') {
        state.objects.forEach((cheese, key) => {
          if (!cheese.collected && player.input.action) {
            const dist = Math.hypot(player.x - cheese.x, player.z - cheese.z);
            if (dist < 2) {
              cheese.collected = true;
              player.ws.send(JSON.stringify({ type: 'cheeseCollected', total: Array.from(state.objects.values()).filter(c => c.collected).length }));
            }
          }
        });

        // Крыса ИИ
        const rat = state.enemies.get('rat');
        if (rat) {
          let target = null;
          let minDist = 999;
          players.forEach(p => {
            if (p.gameId === 'cheese') {
              const d = Math.hypot(p.x - rat.x, p.z - rat.z);
              if (d < minDist) { minDist = d; target = p; }
            }
          });
          if (target && minDist > 1.5) {
            const dx = target.x - rat.x;
            const dz = target.z - rat.z;
            rat.x += (dx / minDist) * GAMES.cheese.ratSpeed * dt;
            rat.z += (dz / minDist) * GAMES.cheese.ratSpeed * dt;
            rat.yaw = Math.atan2(dx, dz);
          }
          if (minDist < 1.5) {
            player.health -= 10 * dt;
            if (player.health <= 0) {
              player.health = 100;
              player.x = 0; player.z = -20;
              player.ws.send(JSON.stringify({ type: 'caughtByRat' }));
            }
          }
        }
      }
    }

    // Дельта-отправка (только если изменилось)
    const snap = player.getPublicData();
    const changed = Math.abs(snap.x - player.lastSnapshot.x) > 0.1 || 
                    Math.abs(snap.z - player.lastSnapshot.z) > 0.1 || 
                    Math.abs(snap.yaw - player.lastSnapshot.yaw) > 0.1;
    
    if (changed) {
      try {
        player.ws.send(JSON.stringify({ type: 'snapshot', players: getVisiblePlayers(player) }));
        player.lastSnapshot = { x: snap.x, y: snap.y, z: snap.z, yaw: snap.yaw };
      } catch(e) {}
    }
  });
}, 1000 / 20);

function getVisiblePlayers(self) {
  const visible = [];
  players.forEach(p => {
    if (p.id === self.id) return;
    const dist = Math.hypot(self.x - p.x, self.z - p.z);
    if (dist < 50) visible.push(p.getPublicData());
  });
  return visible;
}

function broadcast(data, excludeId = null) {
  const msg = JSON.stringify(data);
  players.forEach(p => {
    if (p.id !== excludeId && p.ws.readyState === 1) {
      try { p.ws.send(msg); } catch(e) {}
    }
  });
}

// Heartbeat для стабильности
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ FULL SERVER RUNNING on port ${PORT}`);
  console.log(`💾 Optimized for 512MB RAM / 0.1 CPU`);
});

process.on('SIGINT', () => { console.log('\n🛑 Stop'); process.exit(0); });

/**
 * 🧱 ROBLOX 3D ULTIMATE SERVER
 * Полная версия: Редактор уровней, умная крыса, точные коллизии, сбор на E
 * Оптимизирован под Render Free Tier (0.1 CPU / 512MB RAM)
 */

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 128 * 1024 });
const PORT = process.env.PORT || 3000;

// ============================================
// СТАТИСТИКА ИГРОКОВ
// ============================================
const stats = {
  totalPlayers: 0,
  totalJoins: 0,
  currentDate: new Date().toLocaleDateString()
};

try {
  if (fs.existsSync('stats.json')) {
    const saved = JSON.parse(fs.readFileSync('stats.json', 'utf8'));
    if (saved.currentDate === stats.currentDate) {
      stats.totalPlayers = saved.totalPlayers || 0;
      stats.totalJoins = saved.totalJoins || 0;
    }
  }
} catch (e) { console.log('[STATS] Ошибка чтения статистики'); }

function saveStats() {
  try { fs.writeFileSync('stats.json', JSON.stringify(stats, null, 2)); } 
  catch (e) { console.log('[STATS] Ошибка сохранения'); }
}

app.use(express.static(__dirname, { maxAge: '1d' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/stats', (req, res) => res.json(stats));

// ============================================
// КОНФИГУРАЦИЯ И ГЕНЕРАЦИЯ ЛАБИРИНТА
// ============================================
const CONFIG = {
  TICK_RATE: 20,
  GRAVITY: 18,
  MOVE_SPEED: 8.0,
  JUMP_FORCE: 9.0,
  CELL_SIZE: 5.0,
  GRID_SIZE: 13 // УМЕНЬШЕННЫЙ ЛАБИРИНТ
};

function generateMaze() {
  console.log('[MAZE] Генерация лабиринта 13x13...');
  const size = CONFIG.GRID_SIZE;
  const maze = Array(size).fill(null).map(() => Array(size).fill(1));
  
  // Гарантированная безопасная зона спавна 3x3
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) { maze[y][x] = 0; }
  }
  maze[1][1] = 2; // Точка спавна игрока

  const stack = [{ x: 3, y: 3 }];
  maze[3][3] = 0;
  const directions = [{ x: 0, y: -2 }, { x: 0, y: 2 }, { x: -2, y: 0 }, { x: 2, y: 0 }];
  
  let iterations = 0;
  while (stack.length > 0 && iterations < 500) {
    iterations++;
    const current = stack[stack.length - 1];
    const neighbors = [];
    
    for (const dir of directions) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      if (nx > 2 && nx < size - 1 && ny > 2 && ny < size - 1 && maze[ny][nx] === 1) {
        neighbors.push({ x: nx, y: ny, dx: dir.x / 2, dy: dir.y / 2 });
      }
    }
    
    if (neighbors.length > 0) {
      const chosen = neighbors[Math.floor(Math.random() * neighbors.length)];
      maze[chosen.y][chosen.x] = 0;
      maze[current.y + chosen.dy][current.x + chosen.dx] = 0;
      stack.push({ x: chosen.x, y: chosen.y });
    } else {
      stack.pop();
    }
  }
  
  // Дополнительные проходы для удобства
  for (let i = 0; i < 8; i++) {
    const rx = 2 + Math.floor(Math.random() * (size - 4));
    const ry = 2 + Math.floor(Math.random() * (size - 4));
    if (maze[ry][rx] === 1) maze[ry][rx] = 0;
  }
  
  // Выход в противоположном углу
  maze[size - 2][size - 2] = 4;
  if (maze[size - 2][size - 3] === 1) maze[size - 2][size - 3] = 0;
  
  // Размещение сыров (6 штук для компактной карты)
  let cheeseCount = 0;
  let attempts = 0;
  while (cheeseCount < 6 && attempts < 150) {
    const rx = 2 + Math.floor(Math.random() * (size - 4));
    const ry = 2 + Math.floor(Math.random() * (size - 4));
    if (maze[ry][rx] === 0) { maze[ry][rx] = 3; cheeseCount++; }
    attempts++;
  }
  
  console.log(`[MAZE] Готово. Сыров: ${cheeseCount}`);
  return maze;
}

const MAZE_MAP = generateMaze();
const EMPTY_SPOTS = [];
for (let y = 0; y < CONFIG.GRID_SIZE; y++) {
  for (let x = 0; x < CONFIG.GRID_SIZE; x++) {
    if (MAZE_MAP[y][x] === 0 && !(x < 3 && y < 3)) {
      EMPTY_SPOTS.push({
        x: (x - CONFIG.GRID_SIZE / 2) * CONFIG.CELL_SIZE,
        z: (y - CONFIG.GRID_SIZE / 2) * CONFIG.CELL_SIZE
      });
    }
  }
}

// ============================================
// ИГРОВОЕ СОСТОЯНИЕ
// ============================================
const players = new Map();
let nextId = 1;

const gameState = {
  walls: [],
  cheeses: [],
  greenZones: [],
  rat: { x: 0, z: 0, speed: 4.5, yaw: 0, targetX: 0, targetZ: 0, lastMove: 0 },
  exit: { x: 0, z: 0, open: false },
  spawn: { x: 0, z: 0 },
  time: 0,
  editorObjects: [] // Объекты редактора
};

function generateGameObjects() {
  gameState.walls = [];
  gameState.cheeses = [];
  gameState.greenZones = [];
  
  for (let y = 0; y < CONFIG.GRID_SIZE; y++) {
    for (let x = 0; x < CONFIG.GRID_SIZE; x++) {
      const cell = MAZE_MAP[y][x];
      const wx = (x - CONFIG.GRID_SIZE / 2) * CONFIG.CELL_SIZE;
      const wz = (y - CONFIG.GRID_SIZE / 2) * CONFIG.CELL_SIZE;
      
      if (cell === 1) {
        gameState.walls.push({ x: wx, z: wz, w: CONFIG.CELL_SIZE, d: CONFIG.CELL_SIZE, h: 6.0 });
      } else if (cell === 2) {
        gameState.greenZones.push({ x: wx, z: wz });
        gameState.spawn = { x: wx, z: wz };
      } else if (cell === 3) {
        gameState.cheeses.push({ id: `c${gameState.cheeses.length}`, x: wx, z: wz, collected: false });
      } else if (cell === 4) {
        gameState.exit = { x: wx, z: wz, open: false };
      }
    }
  }
  
  // Спавн крысы подальше от игрока
  if (EMPTY_SPOTS.length > 0) {
    const spot = EMPTY_SPOTS[Math.floor(Math.random() * EMPTY_SPOTS.length)];
    gameState.rat.x = spot.x;
    gameState.rat.z = spot.z;
  }
}

generateGameObjects();

// ============================================
// КЛАСС ИГРОКА
// ============================================
class Player {
  constructor(id, ws, name) {
    this.id = id;
    this.ws = ws;
    this.name = name.substring(0, 16);
    this.gameId = 'menu';
    this.x = 0; this.y = 1; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0;
    this.onGround = false;
    this.input = { f: 0, r: 0, jump: false, action: false };
    this.health = 100;
    this.inventory = { cheese: 0 };
    this.isDead = false;
    this.editorMode = false;
  }
  
  reset(gameId) {
    this.gameId = gameId;
    this.x = gameState.spawn.x + (Math.random() - 0.5) * 1.5;
    this.z = gameState.spawn.z + (Math.random() - 0.5) * 1.5;
    this.y = 1; this.vx = 0; this.vy = 0; this.vz = 0;
    this.health = 100; this.inventory.cheese = 0; this.isDead = false;
    
    if (EMPTY_SPOTS.length > 0) {
      const spot = EMPTY_SPOTS[Math.floor(Math.random() * EMPTY_SPOTS.length)];
      gameState.rat.x = spot.x;
      gameState.rat.z = spot.z;
    }
  }
  
  getPublic() {
    return {
      id: this.id, name: this.name,
      x: this.x, y: this.y, z: this.z, yaw: this.yaw,
      health: this.health, gameId: this.gameId,
      anim: (Math.abs(this.input.f) > 0.1 || Math.abs(this.input.r) > 0.1) ? 1 : 0,
      isDead: this.isDead,
      editorMode: this.editorMode
    };
  }
}

// ============================================
// WEBSOCKET ОБРАБОТКА
// ============================================
wss.on('connection', (ws) => {
  console.log('[WS] Подключение клиента');
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
  
  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      
      if (!data.playerId && data.type === 'register') {
        const id = nextId++;
        const player = new Player(id, ws, data.name || `Player_${id}`);
        players.set(id, player);
        stats.totalPlayers++; stats.totalJoins++; saveStats();
        ws.send(JSON.stringify({ type: 'registered', id, name: player.name, stats }));
        console.log(`[GAME] ${player.name} подключился. Всего: ${stats.totalPlayers}`);
        return;
      }
      
      const player = players.get(data.playerId);
      if (!player) return;
      
      if (data.type === 'input') {
        player.input = {
          f: Math.max(-1, Math.min(1, data.f || 0)),
          r: Math.max(-1, Math.min(1, data.r || 0)),
          jump: !!data.jump,
          action: !!data.action
        };
        if (typeof data.yaw === 'number') player.yaw = data.yaw;
      }
      
      if (data.type === 'joinGame' && ['brookhaven', 'shooter', 'brainrot', 'cheese', 'editor'].includes(data.gameId)) {
        player.reset(data.gameId);
        const existing = Array.from(players.values()).filter(p => p.id !== player.id && p.gameId === data.gameId).map(p => p.getPublic());
        ws.send(JSON.stringify({ type: 'existingPlayers', players: existing, stats }));
        if (data.gameId === 'cheese' || data.gameId === 'editor') {
          ws.send(JSON.stringify({ type: 'mapData', walls: gameState.walls, cheeses: gameState.cheeses, spawn: gameState.spawn, greenZones: gameState.greenZones, exit: gameState.exit, editorObjects: gameState.editorObjects }));
        }
        broadcast({ type: 'playerJoined', player: player.getPublic() }, player.id, data.gameId);
      }
      
      if (data.type === 'respawn') {
        player.reset('cheese');
        broadcast({ type: 'playerJoined', player: player.getPublic() }, null, 'cheese');
      }
      
      if (data.type === 'editorAction') {
        if (data.action === 'addWall') {
          gameState.editorObjects.push({ type: 'wall', x: data.x, z: data.z, w: 5, h: 6, d: 5 });
          broadcast({ type: 'editorUpdate', action: 'addWall', obj: gameState.editorObjects[gameState.editorObjects.length - 1] }, null, 'editor');
        } else if (data.action === 'moveObj') {
          const obj = gameState.editorObjects[data.index];
          if (obj) { obj.x = data.x; obj.z = data.z; }
          broadcast({ type: 'editorUpdate', action: 'moveObj', index: data.index, x: data.x, z: data.z }, null, 'editor');
        } else if (data.action === 'deleteObj') {
          gameState.editorObjects.splice(data.index, 1);
          broadcast({ type: 'editorUpdate', action: 'deleteObj', index: data.index }, null, 'editor');
        }
      }
      
      if (data.type === 'chat' && data.msg) {
        broadcast({ type: 'chat', name: player.name, msg: data.msg.substring(0, 120) }, null, player.gameId);
      }
    } catch (e) { console.error('[MSG] Ошибка:', e); }
  });
  
  ws.on('close', () => {
    for (const [id, pl] of players) {
      if (pl.ws === ws) {
        players.delete(id);
        broadcast({ type: 'playerLeft', playerId: id, gameId: pl.gameId }, null, pl.gameId);
        break;
      }
    }
  });
});

function broadcast(data, excludeId, targetGameId) {
  const msg = JSON.stringify(data);
  players.forEach(p => {
    if (p.id !== excludeId && p.ws.readyState === 1 && (!targetGameId || p.gameId === targetGameId)) {
      try { p.ws.send(msg); } catch(e){}
    }
  });
}

// ============================================
// ФИЗИКА И КОЛЛИЗИИ (СФЕРА vs AABB)
// ============================================
function resolveCollision(x, z, radius, walls, editorWalls) {
  let nx = x, nz = z;
  const allWalls = [...walls, ...(editorWalls || [])];
  
  for (const w of allWalls) {
    const halfW = w.w / 2 + radius;
    const halfD = w.d / 2 + radius;
    const wx1 = w.x - halfW, wx2 = w.x + halfW;
    const wz1 = w.z - halfD, wz2 = w.z + halfD;
    
    if (nx > wx1 && nx < wx2 && nz > wz1 && nz < wz2) {
      const dx1 = nx - wx1, dx2 = wx2 - nx;
      const dz1 = nz - wz1, dz2 = wz2 - nz;
      const minD = Math.min(dx1, dx2, dz1, dz2);
      
      if (minD === dx1) nx = wx1;
      else if (minD === dx2) nx = wx2;
      else if (minD === dz1) nz = wz1;
      else nz = wz2;
    }
  }
  return { x: nx, z: nz };
}

// ============================================
// ИГРОВОЙ ЦИКЛ
// ============================================
setInterval(() => {
  if (players.size === 0) return;
  const dt = 1 / CONFIG.TICK_RATE;
  
  players.forEach(player => {
    if (player.ws.readyState !== 1 || player.gameId === 'menu' || player.isDead) return;
    
    // Движение
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    player.vx = (player.input.f * fx + player.input.r * rx) * CONFIG.MOVE_SPEED;
    player.vz = (player.input.f * fz + player.input.r * rz) * CONFIG.MOVE_SPEED;
    
    if (player.input.jump && player.onGround) { player.vy = CONFIG.JUMP_FORCE; player.onGround = false; }
    player.vy -= CONFIG.GRAVITY * dt;
    
    let nx = player.x + player.vx * dt;
    let nz = player.z + player.vz * dt;
    let ny = player.y + player.vy * dt;
    
    if (ny <= 1) { ny = 1; player.vy = 0; player.onGround = true; }
    
    // Коллизии
    if (player.gameId === 'cheese' || player.gameId === 'editor') {
      const resolved = resolveCollision(nx, nz, 0.4, gameState.walls, gameState.editorObjects.filter(o => o.type === 'wall'));
      nx = resolved.x; nz = resolved.z;
    }
    player.x = nx; player.z = nz; player.y = ny;
    
    // Логика игры "Сыр"
    if (player.gameId === 'cheese') {
      const rat = gameState.rat;
      const now = Date.now();
      
      // ИИ Крысы: ищет ближайшего живого игрока
      let nearest = null, minD = 999;
      players.forEach(o => {
        if (o.gameId === 'cheese' && !o.isDead) {
          const d = Math.hypot(o.x - rat.x, o.z - rat.z);
          if (d < minD) { minD = d; nearest = o; }
        }
      });
      
      if (nearest) {
        rat.targetX = nearest.x; rat.targetZ = nearest.z;
        const dx = rat.targetX - rat.x, dz = rat.targetZ - rat.z;
        const dist = Math.hypot(dx, dz);
        
        // Плавное движение с обходом стен
        if (dist > 0.6 && now - rat.lastMove > 40) {
          const speed = rat.speed * dt;
          const moveX = (dx / dist) * speed;
          const moveZ = (dz / dist) * speed;
          const res = resolveCollision(rat.x + moveX, rat.z + moveZ, 0.5, gameState.walls, gameState.editorObjects.filter(o => o.type === 'wall'));
          rat.x = res.x; rat.z = res.z; rat.yaw = Math.atan2(dx, dz);
          rat.lastMove = now;
        }
      }
      
      // Урон от крысы
      if (minD < 2.2) {
        player.health -= 120 * dt;
        if (player.health <= 0 && !player.isDead) {
          player.isDead = true; player.health = 0;
          player.ws.send(JSON.stringify({ type: 'playerDied', x: player.x, y: player.y, z: player.z, name: player.name, playerId: player.id }));
          broadcast({ type: 'playerDied', x: player.x, y: player.y, z: player.z, name: player.name, playerId: player.id }, null, 'cheese');
        }
      }
      
      // СБОР СЫРА НА КЛАВИШУ E (action)
      if (player.input.action) {
        gameState.cheeses.forEach(c => {
          if (!c.collected && Math.hypot(player.x - c.x, player.z - c.z) < 4.0) {
            c.collected = true;
            player.inventory.cheese++;
            player.ws.send(JSON.stringify({ type: 'collectCheese', total: player.inventory.cheese }));
            if (player.inventory.cheese >= 6) gameState.exit.open = true;
          }
        });
      }
      
      // Выход
      if (gameState.exit.open && Math.hypot(player.x - gameState.exit.x, player.z - gameState.exit.z) < 4.5) {
        player.ws.send(JSON.stringify({ type: 'win', score: Math.floor(1000 - gameState.time) }));
      }
    }
    
    // Отправка состояния
    player.ws.send(JSON.stringify({
      type: 'snapshot',
      players: Array.from(players.values()).filter(p => p.id !== player.id && p.gameId === player.gameId).map(p => p.getPublic()),
      rat: player.gameId === 'cheese' ? gameState.rat : null,
      exit: player.gameId === 'cheese' ? gameState.exit : null,
      editorObjects: player.editorMode ? gameState.editorObjects : null
    }));
  });
  
  if (gameState) gameState.time += dt;
}, 1000 / CONFIG.TICK_RATE);

setInterval(() => { wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }); }, 15000);
process.on('uncaughtException', e => console.error('[FATAL]', e));
server.listen(PORT, '0.0.0.0', () => console.log(`✅ SERVER :${PORT} | Игроков: ${players.size}`));
process.on('SIGINT', () => { saveStats(); process.exit(0); });

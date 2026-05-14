/**
 * 🧱 ROBLOX 3D ULTIMATE SERVER ENGINE v3.0
 * Оптимизирован под 512MB RAM / 0.1 CPU
 * Включает: Генератор лабиринтов, ИИ врагов, Физику, Систему комнат
 */

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ 
  server, 
  maxPayload: 128 * 1024, // Увеличен буфер для пакетов состояния
  perMessageDeflate: false 
});

const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ==========================================
// КОНФИГУРАЦИЯ МИРА
// ==========================================
const WORLD_CONFIG = {
  TICK_RATE: 24, // Баланс между плавностью и нагрузкой на CPU
  GRAVITY: 18,
  MOVE_SPEED: 7.5,
  JUMP_FORCE: 9.5,
  MAP_BOUNDARY: 60
};

// ==========================================
// ГЕНЕРАТОР ЛАБИРИНТА (Для игры Cheese)
// ==========================================
class MazeGenerator {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.grid = [];
    this.generate();
  }

  generate() {
    // Инициализация сетки (1 = стена, 0 = проход)
    for (let y = 0; y < this.height; y++) {
      this.grid[y] = [];
      for (let x = 0; x < this.width; x++) {
        this.grid[y][x] = 1;
      }
    }

    // Алгоритм Recursive Backtracker
    const stack = [];
    const start = { x: 1, y: 1 };
    this.grid[start.y][start.x] = 0;
    stack.push(start);

    const directions = [
      { x: 0, y: -2 }, { x: 0, y: 2 }, { x: -2, y: 0 }, { x: 2, y: 0 }
    ];

    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const neighbors = [];

      for (let dir of directions) {
        const nx = current.x + dir.x;
        const ny = current.y + dir.y;

        if (nx > 0 && nx < this.width - 1 && ny > 0 && ny < this.height - 1 && this.grid[ny][nx] === 1) {
          neighbors.push({ x: nx, y: ny, dx: dir.x / 2, dy: dir.y / 2 });
        }
      }

      if (neighbors.length > 0) {
        const chosen = neighbors[Math.floor(Math.random() * neighbors.length)];
        this.grid[chosen.y][chosen.x] = 0;
        this.grid[current.y + chosen.dy][current.x + chosen.dx] = 0;
        stack.push({ x: chosen.x, y: chosen.y });
      } else {
        stack.pop();
      }
    }
    
    // Гарантируем выход
    this.grid[this.height - 2][this.width - 2] = 0;
  }

  getWalls() {
    const walls = [];
    const cellSize = 3; // Размер блока стены
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.grid[y][x] === 1) {
          walls.push({
            x: (x - this.width / 2) * cellSize,
            z: (y - this.height / 2) * cellSize,
            w: cellSize,
            d: cellSize
          });
        }
      }
    }
    return walls;
  }
}

// ==========================================
// КЛАСС ИГРОКА
// ==========================================
class Player {
  constructor(id, ws, name) {
    this.id = id;
    this.ws = ws;
    this.name = name.substring(0, 16);
    this.gameId = 'menu'; // menu, brookhaven, shooter, brainrot, cheese
    
    // Физика
    this.x = 0; this.y = 1; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0;
    this.onGround = false;
    
    // Состояние
    this.input = { f: 0, r: 0, jump: false, action: false };
    this.health = 100;
    this.team = null;
    this.inventory = { cheese: 0, hasArtifact: false };
    
    // Оптимизация: отправка только при изменении
    this.lastSentState = { x: 0, y: 0, z: 0, yaw: 0, anim: 0 };
  }

  reset(gameId) {
    this.gameId = gameId;
    this.x = (Math.random() - 0.5) * 20;
    this.z = (Math.random() - 0.5) * 20;
    this.y = 1;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.health = 100;
    this.inventory = { cheese: 0, hasArtifact: false };
    if (gameId === 'shooter') this.team = players.size % 2 === 0 ? 'red' : 'blue';
  }
}

// ==========================================
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ
// ==========================================
const players = new Map();
const gameInstances = {};
let nextId = 1;

// Инициализация игры "Сыр" (Лабиринт)
const maze = new MazeGenerator(15, 15);
gameInstances.cheese = {
  walls: maze.getWalls(),
  cheeses: [],
  rat: { x: 0, z: 0, speed: 5.5, targetId: null },
  exit: { x: (15/2 - 2) * 3, z: (15/2 - 2) * 3, open: false },
  time: 0
};

// Спавн сыров в пустых клетках лабиринта
let cheeseCount = 0;
for(let y=1; y<14; y+=2) {
  for(let x=1; x<14; x+=2) {
    if(cheeseCount < 9 && Math.random() > 0.3) {
      gameInstances.cheese.cheeses.push({
        id: `c_${x}_${y}`,
        x: (x - 15/2) * 3,
        z: (y - 15/2) * 3,
        collected: false
      });
      cheeseCount++;
    }
  }
}

// ==========================================
// WEBSOCKET ОБРАБОТКА
// ==========================================
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);

  ws.on('message', (raw) => {
    try {
      const d = JSON.parse(raw);
      
      // Регистрация
      if (!d.playerId && d.type === 'register') {
        const id = nextId++;
        const p = new Player(id, ws, d.name || `Guest_${id}`);
        players.set(id, p);
        ws.send(JSON.stringify({ 
          type: 'registered', 
          id, 
          name: p.name, 
          players: Array.from(players.values()).filter(x=>x.id!==id).map(x=>x.getPublic()) 
        }));
        broadcast({ type: 'playerJoined', player: p.getPublic() }, id);
        return;
      }

      const p = players.get(d.playerId);
      if (!p) return;

      // Ввод
      if (d.type === 'input') {
        p.input = {
          f: typeof d.f==='number' ? Math.max(-1,Math.min(1,d.f)) : 0,
          r: typeof d.r==='number' ? Math.max(-1,Math.min(1,d.r)) : 0,
          jump: !!d.jump, 
          action: !!d.action
        };
        if (typeof d.yaw==='number') p.yaw = d.yaw;
      }

      // Смена игры
      if (d.type === 'joinGame' && ['brookhaven','shooter','brainrot','cheese'].includes(d.gameId)) {
        p.reset(d.gameId);
        // Отправляем карту если это сыр
        if (d.gameId === 'cheese') {
          ws.send(JSON.stringify({ type: 'mapData', walls: gameInstances.cheese.walls, cheeses: gameInstances.cheese.cheeses }));
        }
        broadcast({ type: 'playerMoved', player: p.getPublic() });
      }

      if (d.type === 'chat' && d.msg) broadcast({ type: 'chat', name: p.name, msg: d.msg.substring(0, 120) });

    } catch(e) {}
  });

  ws.on('close', () => {
    for (const [id, pl] of players) {
      if (pl.ws === ws) { players.delete(id); broadcast({ type: 'playerLeft', playerId: id }); break; }
    }
  });
});

// ==========================================
// ГЛАВНЫЙ ЦИКЛ (ФИЗИКА И ЛОГИКА)
// ==========================================
setInterval(() => {
  const dt = 1 / WORLD_CONFIG.TICK_RATE;
  
  players.forEach(p => {
    if (p.ws.readyState !== 1 || p.gameId === 'menu') return;

    // 1. ДВИЖЕНИЕ
    const speed = WORLD_CONFIG.MOVE_SPEED;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    
    p.vx = (p.input.f * fx + p.input.r * rx) * speed;
    p.vz = (p.input.f * fz + p.input.r * rz) * speed;

    // 2. ПРЫЖОК И ГРАВИТАЦИЯ
    if (p.input.jump && p.onGround) {
      p.vy = WORLD_CONFIG.JUMP_FORCE;
      p.onGround = false;
    }
    p.vy -= WORLD_CONFIG.GRAVITY * dt;

    // 3. КОЛЛИЗИЯ (ПРОСТАЯ)
    let nextX = p.x + p.vx * dt;
    let nextZ = p.z + p.vz * dt;
    let nextY = p.y + p.vy * dt;

    // Пол
    if (nextY <= 1) { nextY = 1; p.vy = 0; p.onGround = true; }
    
    // Стены (только для сыра)
    if (p.gameId === 'cheese') {
      const cellSize = 3;
      const gridX = Math.floor((nextX / cellSize) + 15/2);
      const gridZ = Math.floor((nextZ / cellSize) + 15/2);
      
      if (gridX >= 0 && gridX < 15 && gridZ >= 0 && gridZ < 15) {
        if (maze.grid[gridZ][gridX] === 1) {
          nextX = p.x; // Отмена движения по X
          nextZ = p.z; // Отмена движения по Z
        }
      }
    }

    p.x = nextX; p.z = nextZ; p.y = nextY;
    p.x = Math.max(-WORLD_CONFIG.MAP_BOUNDARY, Math.min(WORLD_CONFIG.MAP_BOUNDARY, p.x));
    p.z = Math.max(-WORLD_CONFIG.MAP_BOUNDARY, Math.min(WORLD_CONFIG.MAP_BOUNDARY, p.z));

    // 4. ЛОГИКА ИГР
    if (p.gameId === 'brainrot') {
      // Логика артефакта (упрощена для сервера, клиент показывает)
    }

    if (p.gameId === 'cheese') {
      // Крыса
      const rat = gameInstances.cheese.rat;
      if (p.health > 0) {
        const dx = p.x - rat.x;
        const dz = p.z - rat.z;
        const dist = Math.hypot(dx, dz);
        if (dist < rat.speed * dt * 2 + 1.5) { // Радиус атаки
           p.health -= 5;
           if (p.health <= 0) {
             p.health = 100; p.x = 0; p.z = -20;
             p.ws.send(JSON.stringify({ type: 'died', reason: 'rat' }));
           }
        }
      }
      // ИИ Крысы (преследование ближайшего)
      let target = null, minD = 999;
      players.forEach(other => {
        if (other.gameId === 'cheese' && other.health > 0) {
          const d = Math.hypot(other.x - rat.x, other.z - rat.z);
          if (d < minD) { minD = d; target = other; }
        }
      });
      if (target) {
        const tx = target.x - rat.x, tz = target.z - rat.z;
        const tDist = Math.hypot(tx, tz);
        if (tDist > 1) {
          rat.x += (tx/tDist) * rat.speed * dt;
          rat.z += (tz/tDist) * rat.speed * dt;
          rat.yaw = Math.atan2(tx, tz);
        }
      }

      // Сбор сыра
      gameInstances.cheese.cheeses.forEach(c => {
        if (!c.collected && p.input.action && Math.hypot(p.x-c.x, p.z-c.z) < 2.5) {
          c.collected = true;
          p.inventory.cheese++;
          p.ws.send(JSON.stringify({ type: 'collectCheese', total: p.inventory.cheese }));
          if (p.inventory.cheese >= 9) gameInstances.cheese.exit.open = true;
        }
      });
      
      // Выход
      if (gameInstances.cheese.exit.open && Math.hypot(p.x - gameInstances.cheese.exit.x, p.z - gameInstances.cheese.exit.z) < 3) {
        p.ws.send(JSON.stringify({ type: 'win', score: Math.floor(1000 - gameInstances.cheese.time) }));
        p.health = 0;
      }
    }

    // 5. ОТПРАВКА ДАННЫХ (Дельта)
    const currentAnim = Math.abs(p.input.f) > 0.1 || Math.abs(p.input.r) > 0.1 ? 1 : 0;
    if (Math.abs(p.x - p.lastSentState.x) > 0.1 || 
        Math.abs(p.y - p.lastSentState.y) > 0.1 || 
        Math.abs(p.z - p.lastSentState.z) > 0.1 ||
        Math.abs(p.yaw - p.lastSentState.yaw) > 0.1 ||
        currentAnim !== p.lastSentState.anim) {
      
      try {
        p.ws.send(JSON.stringify({ 
          type: 'snapshot', 
          players: Array.from(players.values())
            .filter(o => o.id !== p.id && o.gameId === p.gameId)
            .map(o => o.getPublic()),
          rat: p.gameId === 'cheese' ? gameInstances.cheese.rat : null,
          exit: p.gameId === 'cheese' ? gameInstances.cheese.exit : null
        }));
        p.lastSentState = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, anim: currentAnim };
      } catch(e){}
    }
  });
  
  // Таймер сыра
  if (gameInstances.cheese) gameInstances.cheese.time += dt;

}, 1000 / WORLD_CONFIG.TICK_RATE);

Player.prototype.getPublic = function() {
  return {
    id: this.id, name: this.name, x: this.x, y: this.y, z: this.z, 
    yaw: this.yaw, health: this.health, team: this.team, 
    gameId: this.gameId, inv: this.inventory, anim: Math.abs(this.input.f)>0.1 || Math.abs(this.input.r)>0.1 ? 1 : 0
  };
};

function broadcast(data, exclude=null) {
  const msg = JSON.stringify(data);
  players.forEach(p => { if (p.id !== exclude && p.ws.readyState===1) try{ p.ws.send(msg); }catch(e){} });
}

// Heartbeat
setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); });
}, 15000);

server.listen(PORT, '0.0.0.0', () => console.log(`🚀 ULTIMATE ENGINE RUNNING :${PORT}`));
process.on('SIGINT', () => { console.log('\n🛑'); process.exit(0); });

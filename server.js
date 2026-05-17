const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 128 * 1024 });
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const WORLD_CONFIG = { TICK_RATE: 24, GRAVITY: 18, MOVE_SPEED: 8.0, JUMP_FORCE: 9.5 };

// Генерация нормального лабиринта (алгоритм Recursive Backtracker)
function generateMaze() {
  const size = 21; // Нечётное число для лабиринта
  const maze = Array(size).fill().map(() => Array(size).fill(1));
  const stack = [];
  const startX = 1, startY = 1;
  maze[startY][startX] = 0;
  stack.push({ x: startX, y: startY });

  const directions = [
    { x: 0, y: -2 }, { x: 0, y: 2 }, { x: -2, y: 0 }, { x: 2, y: 0 }
  ];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const neighbors = [];

    for (const dir of directions) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      if (nx > 0 && nx < size - 1 && ny > 0 && ny < size - 1 && maze[ny][nx] === 1) {
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
  // Добавляем проходы для связности
  for (let i = 0; i < 15; i++) {
    const x = Math.floor(Math.random() * (size - 2)) + 1;
    const y = Math.floor(Math.random() * (size - 2)) + 1;
    if (maze[y][x] === 1) maze[y][x] = 0;
  }

  // Размещаем сыр в случайных пустых клетках
  const cheeses = [];
  for (let i = 0; i < 9; i++) {
    let placed = false;
    while (!placed) {
      const x = Math.floor(Math.random() * (size - 2)) + 1;
      const y = Math.floor(Math.random() * (size - 2)) + 1;
      if (maze[y][x] === 0 && !cheeses.find(c => c.x === x && c.y === y)) {
        cheeses.push({ x, y });
        placed = true;
      }
    }
  }

  // Выход в противоположном углу
  let exitX = size - 2, exitY = size - 2;
  while (maze[exitY][exitX] === 1) {
    exitX--;
    if (exitX < size - 10) { exitX = size - 2; exitY--; }
  }
  maze[exitY][exitX] = 4;

  // Спавн в начале
  maze[1][1] = 2;
  cheeses.forEach(c => { if (maze[c.y][c.x] !== 4) maze[c.y][c.x] = 3; });

  return { maze, cheeses, exit: { x: exitX, y: exitY } };
}

const { maze: MAZE_MAP, cheeses: CHEESE_POSITIONS, exit: EXIT_POS } = generateMaze();
const MAZE_SIZE = MAZE_MAP.length;
const CELL_SIZE = 5.0;

const PATROL_SPOTS = [];
for(let y=0; y<MAZE_SIZE; y++) {
  for(let x=0; x<MAZE_SIZE; x++) {
    if(MAZE_MAP[y][x] === 0) {
      PATROL_SPOTS.push({ x: (x - MAZE_SIZE/2) * CELL_SIZE, z: (y - MAZE_SIZE/2) * CELL_SIZE });
    }
  }
}

class MazeGenerator {  constructor(map) {
    this.map = map;
    this.rows = map.length;
    this.cols = map[0].length;
    this.cellSize = CELL_SIZE;
    this.wallSize = CELL_SIZE;
    this.wallHeight = 6.0;
  }
  
  getWalls() {
    const walls = [], cheeseSpots = [], greenZones = [];
    let exitPos = null, spawnPos = { x: 0, z: 0 };
    
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const cell = this.map[y][x];
        const worldX = (x - this.cols / 2) * this.cellSize;
        const worldZ = (y - this.rows / 2) * this.cellSize;
        
        if (cell === 1) walls.push({ x: worldX, z: worldZ, w: this.wallSize, d: this.wallSize, h: this.wallHeight });
        if (cell === 2) { greenZones.push({ x: worldX, z: worldZ }); if (spawnPos.x === 0) spawnPos = { x: worldX, z: worldZ }; }
        if (cell === 3) cheeseSpots.push({ x: worldX, z: worldZ });
        if (cell === 4) exitPos = { x: worldX, z: worldZ };
      }
    }
    return { walls, spawn: spawnPos, greenZones, cheeseSpots, exit: exitPos };
  }
}

const players = new Map();
const gameInstances = {};
let nextId = 1;

const maze = new MazeGenerator(MAZE_MAP);
const mapData = maze.getWalls();

gameInstances.cheese = {
  walls: mapData.walls,
  cheeses: mapData.cheeseSpots.map((c, i) => ({ id: `c_${i}`, x: c.x, z: c.z, collected: false })),
  greenZones: mapData.greenZones,
  rat: { x: 0, z: 0, speed: 3.5, yaw: 0, targetX: 0, targetZ: 0, targetTimer: 0 },
  exit: { x: mapData.exit?.x || 0, z: mapData.exit?.z || 0, open: false },
  spawn: mapData.spawn,
  time: 0
};

class Player {
  constructor(id, ws, name) {
    this.id = id; this.ws = ws; this.name = name.substring(0, 16);
    this.gameId = 'menu'; this.x = 0; this.y = 1; this.z = 0;    this.vx = 0; this.vy = 0; this.vz = 0; this.yaw = 0; this.onGround = false;
    this.input = { f: 0, r: 0, jump: false, action: false };
    this.health = 100; this.inventory = { cheese: 0 };
    this.lastSent = { x: 0, y: 0, z: 0, yaw: 0, anim: 0 };
  }
  
  reset(gameId) {
    this.gameId = gameId;
    const spawn = gameInstances.cheese?.spawn || { x: 0, z: 0 };
    this.x = spawn.x + (Math.random() - 0.5) * 2.0;
    this.z = spawn.z + (Math.random() - 0.5) * 2.0;
    this.y = 1; this.vx = 0; this.vy = 0; this.vz = 0; this.health = 100;
    this.inventory.cheese = 0;
  }
  
  getPublic() {
    return { id: this.id, name: this.name, x: this.x, y: this.y, z: this.z, yaw: this.yaw, health: this.health, gameId: this.gameId, anim: Math.abs(this.input.f) > 0.1 || Math.abs(this.input.r) > 0.1 ? 1 : 0 };
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
  ws.on('message', (raw) => {
    try {
      const d = JSON.parse(raw);
      if (!d.playerId && d.type === 'register') {
        const id = nextId++;
        const p = new Player(id, ws, d.name || `Player_${id}`);
        players.set(id, p);
        ws.send(JSON.stringify({ type: 'registered', id, name: p.name }));
        return;
      }
      const p = players.get(d.playerId); if (!p) return;
      if (d.type === 'input') {
        p.input = { f: typeof d.f==='number'?Math.max(-1,Math.min(1,d.f)):0, r: typeof d.r==='number'?Math.max(-1,Math.min(1,d.r)):0, jump: !!d.jump, action: !!d.action };
        if (typeof d.yaw==='number') p.yaw = d.yaw;
      }
      if (d.type === 'joinGame' && ['brookhaven','shooter','brainrot','cheese'].includes(d.gameId)) {
        p.reset(d.gameId);
        const existing = Array.from(players.values()).filter(o => o.id !== p.id && o.gameId === d.gameId).map(o => o.getPublic());
        ws.send(JSON.stringify({ type: 'existingPlayers', players: existing }));
        if (d.gameId === 'cheese') ws.send(JSON.stringify({ type: 'mapData', walls: gameInstances.cheese.walls, cheeses: gameInstances.cheese.cheeses, spawn: gameInstances.cheese.spawn, greenZones: gameInstances.cheese.greenZones, exit: gameInstances.cheese.exit }));
        broadcast({ type: 'playerJoined', player: p.getPublic() }, p.id, d.gameId);
      }
      if (d.type === 'chat' && d.msg) broadcast({ type: 'chat', name: p.name, msg: d.msg.substring(0, 120) }, null, p.gameId);
    } catch(e) { console.error('Msg err:', e); }
  });
  ws.on('close', () => { for (const [id, pl] of players) { if (pl.ws === ws) { players.delete(id); broadcast({ type: 'playerLeft', playerId: id, gameId: pl.gameId }, null, pl.gameId); break; } } });
});
function broadcast(data, excludeId = null, targetGameId = null) {
  const msg = JSON.stringify(data);
  players.forEach(p => { if(p.id !== excludeId && p.ws.readyState === 1 && (!targetGameId || p.gameId === targetGameId)) try{ p.ws.send(msg); }catch(e){} });
}

// Проверка коллизии со стенами для крысы
function canRatMove(x, z) {
  const gridX = Math.floor((x / CELL_SIZE) + MAZE_SIZE/2);
  const gridZ = Math.floor((z / CELL_SIZE) + MAZE_SIZE/2);
  if (gridX < 0 || gridX >= MAZE_SIZE || gridZ < 0 || gridZ >= MAZE_SIZE) return false;
  return MAZE_MAP[gridZ][gridX] !== 1;
}

setInterval(() => {
  const dt = 1 / WORLD_CONFIG.TICK_RATE;
  players.forEach(p => {
    if (p.ws.readyState !== 1 || p.gameId === 'menu') return;
    const speed = WORLD_CONFIG.MOVE_SPEED;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    p.vx = (p.input.f * fx + p.input.r * rx) * speed;
    p.vz = (p.input.f * fz + p.input.r * rz) * speed;
    if (p.input.jump && p.onGround) { p.vy = WORLD_CONFIG.JUMP_FORCE; p.onGround = false; }
    p.vy -= WORLD_CONFIG.GRAVITY * dt;
    let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt, ny = p.y + p.vy * dt;
    if (ny <= 1) { ny = 1; p.vy = 0; p.onGround = true; }
    
    // Коллизия игрока
    if (p.gameId === 'cheese') {
      const gridX = Math.floor((nx / CELL_SIZE) + MAZE_SIZE/2);
      const gridZ = Math.floor((nz / CELL_SIZE) + MAZE_SIZE/2);
      if (gridX >= 0 && gridX < MAZE_SIZE && gridZ >= 0 && gridZ < MAZE_SIZE && MAZE_MAP[gridZ][gridX] === 1) {
        nx = p.x; nz = p.z;
      }
    }
    p.x = nx; p.z = nz; p.y = ny;

    if (p.gameId === 'cheese') {
      const rat = gameInstances.cheese.rat;
      const greenZones = gameInstances.cheese.greenZones;
      
      // Крыса всегда идёт за ближайшим игроком
      let nearestPlayer = null, minDist = 999;
      players.forEach(o => { if(o.gameId === 'cheese' && o.health > 0) { const d = Math.hypot(o.x - rat.x, o.z - rat.z); if(d < minDist) { minDist = d; nearestPlayer = o; } }});
      
      if (nearestPlayer) {
        rat.targetX = nearestPlayer.x;
        rat.targetZ = nearestPlayer.z;
      } else {        rat.targetTimer -= dt;
        if (rat.targetTimer <= 0) {
          const spot = PATROL_SPOTS[Math.floor(Math.random() * PATROL_SPOTS.length)];
          rat.targetX = spot.x;
          rat.targetZ = spot.z;
          rat.targetTimer = 3.0 + Math.random() * 2.0;
        }
      }
      
      // Плавное движение крысы с проверкой коллизий
      const dx = rat.targetX - rat.x;
      const dz = rat.targetZ - rat.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.5) {
        const newX = rat.x + (dx / dist) * rat.speed * dt;
        const newZ = rat.z + (dz / dist) * rat.speed * dt;
        if (canRatMove(newX, newZ)) {
          rat.x = newX;
          rat.z = newZ;
          rat.yaw = Math.atan2(dx, dz);
        }
      }

      // Урон от крысы
      let ratInGreen = false;
      for (const gz of greenZones) { if (Math.hypot(rat.x - gz.x, rat.z - gz.z) < 5) { ratInGreen = true; break; } }
      if (p.health > 0 && !ratInGreen && minDist < 2.5) {
        p.health -= 10;
        if (p.health <= 0) { p.health = 100; p.x = gameInstances.cheese.spawn.x; p.z = gameInstances.cheese.spawn.z; p.ws.send(JSON.stringify({ type: 'died' })); }
      }

      // Сбор сыра
      gameInstances.cheese.cheeses.forEach(c => {
        if(!c.collected && p.input.action && Math.hypot(p.x - c.x, p.z - c.z) < 5.0) {
          c.collected = true; p.inventory.cheese++;
          p.ws.send(JSON.stringify({ type: 'collectCheese', total: p.inventory.cheese }));
          if(p.inventory.cheese >= 9) gameInstances.cheese.exit.open = true;
        }
      });

      // Выход
      if(gameInstances.cheese.exit.open && Math.hypot(p.x - gameInstances.cheese.exit.x, p.z - gameInstances.cheese.exit.z) < 5.0) {
        p.ws.send(JSON.stringify({ type: 'win', score: Math.floor(1000 - gameInstances.cheese.time) })); p.health=0;
      }
    }
    
    const curAnim = Math.abs(p.input.f) > 0.1 || Math.abs(p.input.r) > 0.1 ? 1 : 0;
    p.ws.send(JSON.stringify({ type: 'snapshot', players: Array.from(players.values()).filter(o => o.id !== p.id && o.gameId === p.gameId).map(o => o.getPublic()), rat: p.gameId === 'cheese' ? gameInstances.cheese.rat : null, exit: p.gameId === 'cheese' ? gameInstances.cheese.exit : null }));
    p.lastSent = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, anim: curAnim };
  });  if(gameInstances.cheese) gameInstances.cheese.time += dt;
}, 1000 / WORLD_CONFIG.TICK_RATE);

setInterval(() => { wss.clients.forEach(ws => { if(!ws.isAlive) return ws.terminate(); ws.isAlive=false; ws.ping(); }); }, 15000);
server.listen(PORT, '0.0.0.0', () => console.log(`✅ SERVER RUNNING :${PORT}`));
process.on('SIGINT', () => process.exit(0));

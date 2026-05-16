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

const WORLD_CONFIG = { 
    TICK_RATE: 24, 
    GRAVITY: 18, 
    MOVE_SPEED: 6.5, 
    JUMP_FORCE: 9.0 
};

// 0=пол, 1=стена, 2=спавн, 3=сыр, 4=выход
const MAZE_MAP = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,2,0,0,0,0,0,0,1,3,0,4,1],
  [1,0,1,0,1,0,1,0,1,0,1,0,1],
  [1,0,1,0,0,0,1,0,0,0,1,0,1],
  [1,0,1,1,1,1,1,0,1,1,1,0,1],
  [1,0,0,0,0,0,0,0,1,3,0,0,1],
  [1,1,1,0,1,1,1,1,1,0,1,1,1],
  [1,3,0,0,1,0,0,0,0,0,1,3,1],
  [1,0,1,1,1,0,1,1,1,0,1,0,1],
  [1,0,1,3,0,0,0,0,1,0,0,0,1],
  [1,0,1,1,1,1,1,0,1,1,1,0,1],
  [1,0,0,0,0,0,1,0,0,0,1,0,1],
  [1,1,1,1,1,0,1,1,1,0,1,0,1],
  [1,3,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,1,1,1,1,1,1,1,0,1],
  [1,0,1,3,0,0,0,0,0,0,1,0,1],
  [1,0,1,1,1,0,1,1,1,0,1,0,1],
  [1,0,0,0,1,0,1,3,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1],
];

// Предвычисляем пустые клетки для патруля крысы
const PATROL_SPOTS = [];
for(let y=0; y<MAZE_MAP.length; y++) {
  for(let x=0; x<MAZE_MAP[0].length; x++) {
    if(MAZE_MAP[y][x] === 0 || MAZE_MAP[y][x] === 2 || MAZE_MAP[y][x] === 3 || MAZE_MAP[y][x] === 4) {
      PATROL_SPOTS.push({ 
        x: (x - 6.5) * 4.5,         z: (y - 9.5) * 4.5 
      });
    }
  }
}

class MazeGenerator {
  constructor(map) {
    this.map = map;
    this.rows = map.length;
    this.cols = map[0].length;
    this.cellSize = 4.5; // 1.5x шире
    this.wallHeight = 5.0;
  }
  
  getWalls() {
    const walls = [];
    const cheeseSpots = [];
    const greenZones = [];
    let exitPos = null;
    let spawnPos = { x: 0, z: 0 };
    
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const cell = this.map[y][x];
        const worldX = (x - this.cols / 2) * this.cellSize;
        const worldZ = (y - this.rows / 2) * this.cellSize;
        
        if (cell === 1) {
          walls.push({ x: worldX, z: worldZ, w: this.cellSize, d: this.cellSize, h: this.wallHeight });
        }
        if (cell === 2) { 
          greenZones.push({ x: worldX, z: worldZ }); 
          if (spawnPos.x === 0) spawnPos = { x: worldX, z: worldZ }; 
        }
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
  rat: { 
    x: 0, z: 0, speed: 4.0, yaw: 0, 
    state: 'patrol', 
    target: { x: 0, z: 0 }, 
    targetTimer: 0 
  },
  exit: { x: mapData.exit?.x || 0, z: mapData.exit?.z || 0, open: false },
  spawn: mapData.spawn,
  time: 0
};

class Player {
  constructor(id, ws, name) {
    this.id = id; this.ws = ws; this.name = name.substring(0, 16);
    this.gameId = 'menu'; this.x = 0; this.y = 1; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0; this.yaw = 0; this.onGround = false;
    this.input = { f: 0, r: 0, jump: false, action: false };
    this.health = 100; this.inventory = { cheese: 0 };
    this.lastSent = { x: 0, y: 0, z: 0, yaw: 0, anim: 0 };
  }
  
  reset(gameId) {
    this.gameId = gameId;
    const spawn = gameInstances.cheese?.spawn || { x: 0, z: 0 };
    this.x = spawn.x; this.z = spawn.z; this.y = 1;
    this.vx = 0; this.vy = 0; this.vz = 0; this.health = 100;
    this.inventory.cheese = 0;
  }
  
  getPublic() {
    return { 
      id: this.id, name: this.name, x: this.x, y: this.y, z: this.z, 
      yaw: this.yaw, health: this.health, gameId: this.gameId, 
      anim: Math.abs(this.input.f) > 0.1 || Math.abs(this.input.r) > 0.1 ? 1 : 0 
    };
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
  
  ws.on('message', (raw) => {
    try {
      const d = JSON.parse(raw);
      if (!d.playerId && d.type === 'register') {        const id = nextId++;
        const p = new Player(id, ws, d.name || `Player_${id}`);
        players.set(id, p);
        ws.send(JSON.stringify({ type: 'registered', id, name: p.name, players: Array.from(players.values()).filter(x => x.id !== id).map(x => x.getPublic()) }));
        broadcast({ type: 'playerJoined', player: p.getPublic() }, id);
        return;
      }
      
      const p = players.get(d.playerId); if (!p) return;
      
      if (d.type === 'input') {
        p.input = { 
          f: typeof d.f === 'number' ? Math.max(-1, Math.min(1, d.f)) : 0, 
          r: typeof d.r === 'number' ? Math.max(-1, Math.min(1, d.r)) : 0, 
          jump: !!d.jump, action: !!d.action 
        };
        if (typeof d.yaw === 'number') p.yaw = d.yaw;
      }
      
      if (d.type === 'joinGame' && ['brookhaven','shooter','brainrot','cheese'].includes(d.gameId)) {
        p.reset(d.gameId);
        if (d.gameId === 'cheese') {
          ws.send(JSON.stringify({ type: 'mapData', walls: gameInstances.cheese.walls, cheeses: gameInstances.cheese.cheeses, spawn: gameInstances.cheese.spawn, greenZones: gameInstances.cheese.greenZones, exit: gameInstances.cheese.exit }));
        }
        broadcast({ type: 'playerMoved', player: p.getPublic() });
      }
      
      if (d.type === 'chat' && d.msg) broadcast({ type: 'chat', name: p.name, msg: d.msg.substring(0, 120) });
    } catch(e) { console.error('Msg err:', e); }
  });
  
  ws.on('close', () => {
    for (const [id, pl] of players) { if (pl.ws === ws) { players.delete(id); broadcast({ type: 'playerLeft', playerId: id }); break; } }
  });
});

setInterval(() => {
  const dt = 1 / WORLD_CONFIG.TICK_RATE;
  
  players.forEach(p => {
    if (p.ws.readyState !== 1 || p.gameId === 'menu') return;
    
    const speed = WORLD_CONFIG.MOVE_SPEED;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    
    p.vx = (p.input.f * fx + p.input.r * rx) * speed;
    p.vz = (p.input.f * fz + p.input.r * rz) * speed;
    
    if (p.input.jump && p.onGround) { p.vy = WORLD_CONFIG.JUMP_FORCE; p.onGround = false; }    p.vy -= WORLD_CONFIG.GRAVITY * dt;
    
    let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt, ny = p.y + p.vy * dt;
    if (ny <= 1) { ny = 1; p.vy = 0; p.onGround = true; }
    
    if (p.gameId === 'cheese') {
      const cs = 4.5, halfX = 6.5, halfZ = 9.5;
      const gx = Math.floor((nx / cs) + halfX), gz = Math.floor((nz / cs) + halfZ);
      if (gx >= 0 && gx < 13 && gz >= 0 && gz < 19 && MAZE_MAP[gz][gx] === 1) { nx = p.x; nz = p.z; }
    }
    p.x = nx; p.z = nz; p.y = ny;

    if (p.gameId === 'cheese') {
      const rat = gameInstances.cheese.rat;
      const greenZones = gameInstances.cheese.greenZones;
      
      // Поиск ближайшего игрока
      let nearestPlayer = null;
      let minDist = 999;
      players.forEach(o => { 
        if(o.gameId === 'cheese' && o.health > 0) { 
          const d = Math.hypot(o.x - rat.x, o.z - rat.z); 
          if(d < minDist) { minDist = d; nearestPlayer = o; }
        }
      });

      // Логика переключения состояний крысы
      if (nearestPlayer && minDist < 5.5) {
        rat.state = 'chase';
        rat.target = { x: nearestPlayer.x, z: nearestPlayer.z };
      } else if (rat.state === 'chase' && minDist > 7.0) {
        rat.state = 'patrol';
      }

      // Патрулирование
      if (rat.state === 'patrol') {
        rat.targetTimer -= dt;
        if (rat.targetTimer <= 0) {
          rat.target = PATROL_SPOTS[Math.floor(Math.random() * PATROL_SPOTS.length)];
          rat.targetTimer = 2.5 + Math.random() * 2.0;
        }
      }

      // Движение крысы
      const dx = rat.target.x - rat.x;
      const dz = rat.target.z - rat.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.5) {
        rat.x += (dx / dist) * rat.speed * dt;
        rat.z += (dz / dist) * rat.speed * dt;        rat.yaw = Math.atan2(dx, dz);
      }

      // Урон от крысы
      let ratInGreen = false;
      for (const gz of greenZones) { if (Math.hypot(rat.x - gz.x, rat.z - gz.z) < 5) { ratInGreen = true; break; } }
      
      if (p.health > 0 && !ratInGreen) {
        if (minDist < 2.2) {
          p.health -= 10;
          if (p.health <= 0) { 
            p.health = 100; p.x = gameInstances.cheese.spawn.x; p.z = gameInstances.cheese.spawn.z; 
            p.ws.send(JSON.stringify({ type: 'died' })); 
          }
        }
      }

      // Сбор сыра
      gameInstances.cheese.cheeses.forEach(c => {
        if(!c.collected && p.input.action && Math.hypot(p.x - c.x, p.z - c.z) < 3.0) {
          c.collected = true; p.inventory.cheese++;
          p.ws.send(JSON.stringify({ type: 'collectCheese', total: p.inventory.cheese }));
          if(p.inventory.cheese >= 9) gameInstances.cheese.exit.open = true;
        }
      });

      // Выход
      if(gameInstances.cheese.exit.open && Math.hypot(p.x - gameInstances.cheese.exit.x, p.z - gameInstances.cheese.exit.z) < 3.5) {
        p.ws.send(JSON.stringify({ type: 'win', score: Math.floor(1000 - gameInstances.cheese.time) })); 
        p.health = 0;
      }
    }
    
    const curAnim = Math.abs(p.input.f) > 0.1 || Math.abs(p.input.r) > 0.1 ? 1 : 0;
    if(Math.abs(p.x - p.lastSent.x) > 0.2 || Math.abs(p.z - p.lastSent.z) > 0.2 || Math.abs(p.yaw - p.lastSent.yaw) > 0.1 || curAnim !== p.lastSent.anim) {
      try {
        p.ws.send(JSON.stringify({ 
          type: 'snapshot', 
          players: Array.from(players.values()).filter(o => o.id !== p.id && o.gameId === p.gameId).map(o => o.getPublic()), 
          rat: p.gameId === 'cheese' ? gameInstances.cheese.rat : null, 
          exit: p.gameId === 'cheese' ? gameInstances.cheese.exit : null 
        }));
        p.lastSent = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, anim: curAnim };
      } catch(e) {}
    }
  });
  
  if(gameInstances.cheese) gameInstances.cheese.time += dt;
}, 1000 / WORLD_CONFIG.TICK_RATE);
function broadcast(data, excludeId = null) {
  const msg = JSON.stringify(data);
  players.forEach(p => { if(p.id !== excludeId && p.ws.readyState === 1) try{ p.ws.send(msg); }catch(e){} });
}

setInterval(() => { wss.clients.forEach(ws => { if(!ws.isAlive) return ws.terminate(); ws.isAlive=false; ws.ping(); }); }, 15000);
server.listen(PORT, '0.0.0.0', () => console.log(`✅ SERVER RUNNING :${PORT}`));
process.on('SIGINT', () => process.exit(0));

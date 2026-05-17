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

const WORLD_CONFIG = { TICK_RATE: 20, GRAVITY: 18, MOVE_SPEED: 8.0, JUMP_FORCE: 9.0 };
const CELL_SIZE = 5.0;
const GRID_SIZE = 19;

function generateMaze() {
  try {
    const maze = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(1));
    for(let y=0; y<3; y++) for(let x=0; x<3; x++) maze[y][x] = 0;
    maze[1][1] = 2; 
    const stack = [{ x: 3, y: 3 }]; maze[3][3] = 0;
    const dirs = [{ x: 0, y: -2 }, { x: 0, y: 2 }, { x: -2, y: 0 }, { x: 2, y: 0 }];
    
    while (stack.length > 0) {
      const cur = stack[stack.length - 1];
      const neighbors = [];
      for (const d of dirs) {
        const nx = cur.x + d.x, ny = cur.y + d.y;
        if (nx > 2 && nx < GRID_SIZE - 1 && ny > 2 && ny < GRID_SIZE - 1 && maze[ny][nx] === 1) {
          neighbors.push({ x: nx, y: ny, dx: d.x / 2, dy: d.y / 2 });
        }
      }
      if (neighbors.length) {
        const ch = neighbors[Math.floor(Math.random() * neighbors.length)];
        maze[ch.y][ch.x] = 0; maze[cur.y + ch.dy][cur.x + ch.dx] = 0;
        stack.push({ x: ch.x, y: ch.y });
      } else stack.pop();
    }
    
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(Math.random() * (GRID_SIZE - 4)) + 2;
      const y = Math.floor(Math.random() * (GRID_SIZE - 4)) + 2;
      if (maze[y][x] === 1) maze[y][x] = 0;
    }
    
    maze[GRID_SIZE-2][GRID_SIZE-2] = 4;
    if(maze[GRID_SIZE-2][GRID_SIZE-3] === 1) maze[GRID_SIZE-2][GRID_SIZE-3] = 0;
        let placed = 0;
    while(placed < 9) {
      const x = Math.floor(Math.random() * (GRID_SIZE - 4)) + 2;
      const y = Math.floor(Math.random() * (GRID_SIZE - 4)) + 2;
      if (maze[y][x] === 0) { maze[y][x] = 3; placed++; }
    }
    return maze;
  } catch(e) {
    console.error('[MAZE] Ошибка генерации:', e);
    return Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));
  }
}

const MAZE_MAP = generateMaze();
const EMPTY_SPOTS = [];
for(let y=0; y<GRID_SIZE; y++) for(let x=0; x<GRID_SIZE; x++) {
  if(MAZE_MAP[y][x] === 0 && !(x<3 && y<3)) EMPTY_SPOTS.push({ x: (x - GRID_SIZE/2) * CELL_SIZE, z: (y - GRID_SIZE/2) * CELL_SIZE });
}

const players = new Map();
const gameInstances = {};
let nextId = 1;

gameInstances.cheese = {
  walls: MAZE_MAP.flatMap((row, y) => row.map((cell, x) => cell === 1 ? {
    x: (x - GRID_SIZE/2)*CELL_SIZE, z: (y - GRID_SIZE/2)*CELL_SIZE, w: CELL_SIZE, d: CELL_SIZE, h: 6.0
  } : null).filter(Boolean)),
  cheeses: [],
  greenZones: [],
  rat: { x: 0, z: 0, speed: 4.5, yaw: 0, targetX: 0, targetZ: 0 },
  exit: { x: 0, z: 0, open: false },
  spawn: { x: (1.0 - GRID_SIZE/2)*CELL_SIZE, z: (1.0 - GRID_SIZE/2)*CELL_SIZE },
  time: 0
};

// Заполняем сыры и зоны
for(let y=0; y<GRID_SIZE; y++) for(let x=0; x<GRID_SIZE; x++) {
  const wx = (x - GRID_SIZE/2)*CELL_SIZE, wz = (y - GRID_SIZE/2)*CELL_SIZE;
  if(MAZE_MAP[y][x] === 2) gameInstances.cheese.greenZones.push({x:wx, z:wz});
  if(MAZE_MAP[y][x] === 3) gameInstances.cheese.cheeses.push({id:`c_${gameInstances.cheese.cheeses.length}`, x:wx, z:wz, collected:false});
  if(MAZE_MAP[y][x] === 4) gameInstances.cheese.exit = {x:wx, z:wz, open:false};
}

class Player {
  constructor(id, ws, name) {
    this.id = id; this.ws = ws; this.name = name.substring(0, 16);
    this.gameId = 'menu'; this.x = 0; this.y = 1; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0; this.yaw = 0; this.onGround = false;
    this.input = { f: 0, r: 0, jump: false, action: false };
    this.health = 100; this.inventory = { cheese: 0 };    this.isDead = false;
  }
  reset(gameId) {
    this.gameId = gameId;
    this.x = gameInstances.cheese.spawn.x + (Math.random()-0.5)*2;
    this.z = gameInstances.cheese.spawn.z + (Math.random()-0.5)*2;
    this.y = 1; this.vx = 0; this.vy = 0; this.vz = 0; this.health = 100;
    this.inventory.cheese = 0; this.isDead = false;
    if(EMPTY_SPOTS.length) {
      const s = EMPTY_SPOTS[Math.floor(Math.random()*EMPTY_SPOTS.length)];
      gameInstances.cheese.rat.x = s.x; gameInstances.cheese.rat.z = s.z;
    }
  }
  getPublic() {
    return { id:this.id, name:this.name, x:this.x, y:this.y, z:this.z, yaw:this.yaw, health:this.health, gameId:this.gameId, anim: (Math.abs(this.input.f)>0.1||Math.abs(this.input.r)>0.1)?1:0, isDead:this.isDead };
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
        p.input = { f: Math.max(-1,Math.min(1,d.f||0)), r: Math.max(-1,Math.min(1,d.r||0)), jump:!!d.jump, action:!!d.action };
        if (typeof d.yaw==='number') p.yaw = d.yaw;
      }
      if (d.type === 'joinGame' && ['brookhaven','shooter','brainrot','cheese'].includes(d.gameId)) {
        p.reset(d.gameId);
        const existing = Array.from(players.values()).filter(o => o.id !== p.id && o.gameId === d.gameId).map(o => o.getPublic());
        ws.send(JSON.stringify({ type: 'existingPlayers', players: existing }));
        if (d.gameId === 'cheese') ws.send(JSON.stringify({ type: 'mapData', walls: gameInstances.cheese.walls, cheeses: gameInstances.cheese.cheeses, spawn: gameInstances.cheese.spawn, greenZones: gameInstances.cheese.greenZones, exit: gameInstances.cheese.exit }));
        broadcast({ type: 'playerJoined', player: p.getPublic() }, p.id, d.gameId);
      }
      if (d.type === 'respawn') { p.reset('cheese'); broadcast({ type: 'playerJoined', player: p.getPublic() }, null, 'cheese'); }
      if (d.type === 'chat' && d.msg) broadcast({ type: 'chat', name: p.name, msg: d.msg.substring(0, 120) }, null, p.gameId);
    } catch(e) { /* Игнорируем битые пакеты */ }
  });
  ws.on('close', () => {
    for (const [id, pl] of players) { 
      if (pl.ws === ws) { players.delete(id); broadcast({ type: 'playerLeft', playerId: id, gameId: pl.gameId }, null, pl.gameId); break; }     }
  });
});

function broadcast(data, excludeId = null, targetGameId = null) {
  const msg = JSON.stringify(data);
  players.forEach(p => { 
    if(p.id !== excludeId && p.ws.readyState === 1 && (!targetGameId || p.gameId === targetGameId)) try{ p.ws.send(msg); }catch(e){} 
  });
}

function canMove(x, z) {
  const gx = Math.floor((x / CELL_SIZE) + GRID_SIZE/2);
  const gz = Math.floor((z / CELL_SIZE) + GRID_SIZE/2);
  return gx>=0 && gx<GRID_SIZE && gz>=0 && gz<GRID_SIZE && MAZE_MAP[gz][gx] !== 1;
}

// Оптимизированный тик-луп
setInterval(() => {
  if (players.size === 0) return; // Экономия CPU
  const dt = 1 / WORLD_CONFIG.TICK_RATE;
  players.forEach(p => {
    if (p.ws.readyState !== 1 || p.gameId === 'menu' || p.isDead) return;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    p.vx = (p.input.f * fx + p.input.r * rx) * WORLD_CONFIG.MOVE_SPEED;
    p.vz = (p.input.f * fz + p.input.r * rz) * WORLD_CONFIG.MOVE_SPEED;
    if (p.input.jump && p.onGround) { p.vy = WORLD_CONFIG.JUMP_FORCE; p.onGround = false; }
    p.vy -= WORLD_CONFIG.GRAVITY * dt;
    let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt, ny = p.y + p.vy * dt;
    if (ny <= 1) { ny = 1; p.vy = 0; p.onGround = true; }
    
    if (p.gameId === 'cheese') {
      if (!canMove(nx, p.z)) nx = p.x;
      if (!canMove(p.x, nz)) nz = p.z;
      
      const rat = gameInstances.cheese.rat;
      let nearest = null, minD = 999;
      players.forEach(o => { if(o.gameId==='cheese' && !o.isDead) { const d=Math.hypot(o.x-rat.x, o.z-rat.z); if(d<minD){minD=d; nearest=o;} }});
      if(nearest) { rat.targetX = nearest.x; rat.targetZ = nearest.z; }
      
      const dx = rat.targetX - rat.x, dz = rat.targetZ - rat.z, dist = Math.hypot(dx,dz);
      if(dist > 0.5) {
        const nxR = rat.x + (dx/dist)*rat.speed*dt;
        const nzR = rat.z + (dz/dist)*rat.speed*dt;
        if(canMove(nxR, nzR)) { rat.x = nxR; rat.z = nzR; rat.yaw = Math.atan2(dx,dz); }
      }
      
      if(minD < 2.0) {
        p.health -= 100 * dt;        if(p.health <= 0 && !p.isDead) {
          p.isDead = true; p.health = 0;
          p.ws.send(JSON.stringify({ type: 'playerDied', x: p.x, y: p.y, z: p.z, name: p.name, playerId: p.id }));
          broadcast({ type: 'playerDied', x: p.x, y: p.y, z: p.z, name: p.name, playerId: p.id }, null, 'cheese');
        }
      }
      
      gameInstances.cheese.cheeses.forEach(c => {
        if(!c.collected && p.input.action && Math.hypot(p.x-c.x, p.z-c.z) < 5.0) {
          c.collected = true; p.inventory.cheese++;
          p.ws.send(JSON.stringify({ type: 'collectCheese', total: p.inventory.cheese }));
          if(p.inventory.cheese >= 9) gameInstances.cheese.exit.open = true;
        }
      });
      if(gameInstances.cheese.exit.open && Math.hypot(p.x-gameInstances.cheese.exit.x, p.z-gameInstances.cheese.exit.z) < 5.0) {
        p.ws.send(JSON.stringify({ type: 'win', score: Math.floor(1000-gameInstances.cheese.time) }));
      }
    }
    p.x = nx; p.z = nz; p.y = ny;
    p.ws.send(JSON.stringify({ type: 'snapshot', players: Array.from(players.values()).filter(o=>o.id!==p.id && o.gameId===p.gameId).map(o=>o.getPublic()), rat: p.gameId==='cheese'?gameInstances.cheese.rat:null, exit: p.gameId==='cheese'?gameInstances.cheese.exit:null }));
  });
  if(gameInstances.cheese) gameInstances.cheese.time += dt;
}, 1000 / WORLD_CONFIG.TICK_RATE);

setInterval(() => { wss.clients.forEach(ws => { if(!ws.isAlive) return ws.terminate(); ws.isAlive=false; ws.ping(); }); }, 15000);
process.on('uncaughtException', e => console.error('[FATAL]', e));
server.listen(PORT, '0.0.0.0', () => console.log(`✅ SERVER :${PORT} | Players: 0`));
process.on('SIGINT', () => process.exit(0));

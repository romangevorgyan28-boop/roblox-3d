/**
 * 🧱 ROBLOX 3D ULTIMATE SERVER v3.5
 * Исправлено: ширина лабиринта (x3), убраны тупики, оптимизация
 */
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 128 * 1024, perMessageDeflate: false });
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const WORLD_CONFIG = { TICK_RATE: 24, GRAVITY: 18, MOVE_SPEED: 8.0, JUMP_FORCE: 10.0 };

class MazeGenerator {
  constructor(size) {
    this.size = size;
    this.grid = [];
    this.cellSize = 12.0; // ШИРОКИЕ ПРОХОДЫ (было 4.0)
    this.wallHeight = 6.5;
    this.generate();
    this.removeDeadEnds(); // Убираем тупики
  }

  generate() {
    for (let y = 0; y < this.size; y++) {
      this.grid[y] = [];
      for (let x = 0; x < this.size; x++) this.grid[y][x] = 1;
    }
    const stack = [{ x: 1, y: 1 }];
    this.grid[1][1] = 0;
    const dirs = [{ x: 0, y: -2 }, { x: 0, y: 2 }, { x: -2, y: 0 }, { x: 2, y: 0 }];

    while (stack.length) {
      const curr = stack[stack.length - 1];
      const neighbors = [];
      for (const d of dirs) {
        const nx = curr.x + d.x, ny = curr.y + d.y;
        if (nx > 0 && nx < this.size - 1 && ny > 0 && ny < this.size - 1 && this.grid[ny][nx] === 1) {
          neighbors.push({ x: nx, y: ny, dx: d.x / 2, dy: d.y / 2 });
        }
      }
      if (neighbors.length) {
        const ch = neighbors[Math.floor(Math.random() * neighbors.length)];
        this.grid[ch.y][ch.x] = 0;        this.grid[curr.y + ch.dy][curr.x + ch.dx] = 0;
        stack.push({ x: ch.x, y: ch.y });
      } else stack.pop();
    }
  }

  removeDeadEnds() {
    // Прорубаем ~35% внутренних стен, создавая петли и открытые зоны
    for (let y = 1; y < this.size - 1; y++) {
      for (let x = 1; x < this.size - 1; x++) {
        if (this.grid[y][x] === 1 && Math.random() < 0.35) {
          this.grid[y][x] = 0;
        }
      }
    }
    // Гарантируем безопасную зону спавна и выхода
    this.grid[1][1] = 0; this.grid[1][2] = 0; this.grid[2][1] = 0;
    this.grid[this.size-2][this.size-2] = 0;
  }

  getWalls() {
    const walls = [];
    const half = this.size / 2;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.grid[y][x] === 1) {
          walls.push({
            x: (x - half) * this.cellSize,
            z: (y - half) * this.cellSize,
            w: this.cellSize,
            d: this.cellSize,
            h: this.wallHeight
          });
        }
      }
    }
    return { walls, spawn: { x: (1 - half) * this.cellSize, z: (1 - half) * this.cellSize } };
  }
}

const players = new Map();
const gameInstances = {};
let nextId = 1;

const maze = new MazeGenerator(19); // 19x19 клеток, но очень широкие
gameInstances.cheese = {
  ...maze.getWalls(),
  cheeses: [],
  rat: { x: 0, z: 0, speed: 5.5, yaw: 0 },
  exit: { x: (19/2 - 2) * 12, z: (19/2 - 2) * 12, open: false },  time: 0
};

let cheeseCount = 0;
for(let y=1; y<18; y+=2) {
  for(let x=1; x<18; x+=2) {
    if(cheeseCount < 9 && Math.random() > 0.2) {
      gameInstances.cheese.cheeses.push({
        id: `c_${x}_${y}`,
        x: (x - 9.5) * 12,
        z: (y - 9.5) * 12,
        collected: false
      });
      cheeseCount++;
    }
  }
}

class Player {
  constructor(id, ws, name) {
    this.id = id; this.ws = ws; this.name = name.substring(0, 16);
    this.gameId = 'menu'; this.x = 0; this.y = 1; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0; this.yaw = 0; this.onGround = false;
    this.input = { f: 0, r: 0, jump: false, action: false };
    this.health = 100; this.team = null; this.inventory = { cheese: 0 };
    this.lastSent = { x: 0, y: 0, z: 0, yaw: 0, anim: 0 };
  }
  reset(gid) {
    this.gameId = gid;
    const spawn = gameInstances.cheese?.spawn || { x: 0, z: 0 };
    this.x = spawn.x; this.z = spawn.z; this.y = 1;
    this.vx = 0; this.vy = 0; this.vz = 0; this.health = 100;
    this.inventory.cheese = 0;
    if (gid === 'shooter') this.team = players.size % 2 === 0 ? 'red' : 'blue';
  }
  getPublic() {
    return { id:this.id, name:this.name, x:this.x, y:this.y, z:this.z, yaw:this.yaw, health:this.health, team:this.team, gameId:this.gameId, anim: Math.abs(this.input.f)>0.1||Math.abs(this.input.r)>0.1?1:0 };
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
        players.set(id, p);        ws.send(JSON.stringify({ type: 'registered', id, name: p.name, players: Array.from(players.values()).filter(x=>x.id!==id).map(x=>x.getPublic()) }));
        broadcast({ type: 'playerJoined', player: p.getPublic() }, id);
        return;
      }
      const p = players.get(d.playerId); if (!p) return;
      if (d.type === 'input') {
        p.input = { f: typeof d.f==='number'?Math.max(-1,Math.min(1,d.f)):0, r: typeof d.r==='number'?Math.max(-1,Math.min(1,d.r)):0, jump: !!d.jump, action: !!d.action };
        if (typeof d.yaw==='number') p.yaw = d.yaw;
      }
      if (d.type === 'joinGame' && ['brookhaven','shooter','brainrot','cheese'].includes(d.gameId)) {
        p.reset(d.gameId);
        if (d.gameId === 'cheese') {
          ws.send(JSON.stringify({ type: 'mapData', walls: gameInstances.cheese.walls, cheeses: gameInstances.cheese.cheeses, spawn: gameInstances.cheese.spawn }));
        }
        broadcast({ type: 'playerMoved', player: p.getPublic() });
      }
      if (d.type === 'chat' && d.msg) broadcast({ type: 'chat', name: p.name, msg: d.msg.substring(0, 120) });
    } catch(e) {}
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
    if (p.input.jump && p.onGround) { p.vy = WORLD_CONFIG.JUMP_FORCE; p.onGround = false; }
    p.vy -= WORLD_CONFIG.GRAVITY * dt;
    let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt, ny = p.y + p.vy * dt;
    if (ny <= 1) { ny = 1; p.vy = 0; p.onGround = true; }
    
    if (p.gameId === 'cheese') {
      const cs = 12.0, half = 9.5;
      const gx = Math.floor((nx / cs) + half), gz = Math.floor((nz / cs) + half);
      if (gx >= 0 && gx < 19 && gz >= 0 && gz < 19 && maze.grid[gz][gx] === 1) {
        nx = p.x; nz = p.z;
      }
    }
    p.x = nx; p.z = nz; p.y = ny;

    if (p.gameId === 'cheese') {
      const rat = gameInstances.cheese.rat;
      if (p.health > 0) {        const dx = p.x - rat.x, dz = p.z - rat.z;
        if (Math.hypot(dx, dz) < 2.5) {
          p.health -= 8;
          if (p.health <= 0) { p.health = 100; p.x = gameInstances.cheese.spawn.x; p.z = gameInstances.cheese.spawn.z; p.ws.send(JSON.stringify({ type: 'died' })); }
        }
      }
      let target = null, minD = 999;
      players.forEach(o => { if(o.gameId==='cheese' && o.health>0) { const d=Math.hypot(o.x-rat.x, o.z-rat.z); if(d<minD){minD=d; target=o;} }});
      if(target) {
        const tx=target.x-rat.x, tz=target.z-rat.z;
        rat.x += (tx/minD)*rat.speed*dt; rat.z += (tz/minD)*rat.speed*dt; rat.yaw = Math.atan2(tx,tz);
      }
      gameInstances.cheese.cheeses.forEach(c => {
        if(!c.collected && p.input.action && Math.hypot(p.x-c.x, p.z-c.z) < 3) {
          c.collected = true; p.inventory.cheese++;
          p.ws.send(JSON.stringify({ type: 'collectCheese', total: p.inventory.cheese }));
          if(p.inventory.cheese >= 9) gameInstances.cheese.exit.open = true;
        }
      });
      if(gameInstances.cheese.exit.open && Math.hypot(p.x-gameInstances.cheese.exit.x, p.z-gameInstances.cheese.exit.z) < 3.5) {
        p.ws.send(JSON.stringify({ type: 'win', score: Math.floor(1000 - gameInstances.cheese.time) })); p.health=0;
      }
    }

    const curAnim = Math.abs(p.input.f)>0.1||Math.abs(p.input.r)>0.1 ? 1 : 0;
    if(Math.abs(p.x-p.lastSent.x)>0.2 || Math.abs(p.z-p.lastSent.z)>0.2 || Math.abs(p.yaw-p.lastSent.yaw)>0.1 || curAnim!==p.lastSent.anim) {
      try {
        p.ws.send(JSON.stringify({ type:'snapshot', players: Array.from(players.values()).filter(o=>o.id!==p.id&&o.gameId===p.gameId).map(o=>o.getPublic()), rat: p.gameId==='cheese'?gameInstances.cheese.rat:null, exit: p.gameId==='cheese'?gameInstances.cheese.exit:null }));
        p.lastSent = { x:p.x, y:p.y, z:p.z, yaw:p.yaw, anim:curAnim };
      } catch(e){}
    }
  });
  if(gameInstances.cheese) gameInstances.cheese.time += dt;
}, 1000 / WORLD_CONFIG.TICK_RATE);

function broadcast(data, ex=null) {
  const msg = JSON.stringify(data);
  players.forEach(p => { if(p.id!==ex && p.ws.readyState===1) try{p.ws.send(msg);}catch(e){} });
}

setInterval(() => { wss.clients.forEach(ws => { if(!ws.isAlive) return ws.terminate(); ws.isAlive=false; ws.ping(); }); }, 15000);
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 v3.5 RUNNING :${PORT}`));
process.on('SIGINT', () => process.exit(0));

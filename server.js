const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 50 * 1024 });

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 60;
const players = new Map();
let nextId = 1;

// === ВАЖНО: Эта строка ищет index.html в корне папки ===
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

wss.on('connection', (ws) => {
  const id = nextId++;
  const player = {
    id, ws,
    x: (Math.random() - 0.5) * 20,
    y: 1, z: (Math.random() - 0.5) * 20,
    vx: 0, vy: 0, vz: 0,
    yaw: Math.random() * Math.PI * 2,
    input: { forward: 0, right: 0, jump: false },
    onGround: true
  };
  
  players.set(id, player);
  console.log(`[+] Player ${id} connected. Online: ${players.size}`);

  ws.send(JSON.stringify({
    type: 'init',
    id: id,
    players: Array.from(players.values())
      .filter(p => p.id !== id)
      .map(p => ({ id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw }))
  }));

  broadcast({ type: 'spawn', id: player.id, x: player.x, y: player.y, z: player.z, yaw: player.yaw }, id);

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      if (data.type === 'input') {
        player.input = {
          forward: typeof data.forward === 'number' ? Math.max(-1, Math.min(1, data.forward)) : 0,
          right: typeof data.right === 'number' ? Math.max(-1, Math.min(1, data.right)) : 0,
          jump: !!data.jump
        };
        if (typeof data.yaw === 'number') player.yaw = data.yaw;
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'despawn', id });
    console.log(`[-] Player ${id} disconnected.`);
  });

  ws.on('error', () => {
    players.delete(id);
  });
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;

  players.forEach(p => {
    const speed = 7;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    
    p.vx = (p.input.forward * fx + p.input.right * rx) * speed;
    p.vz = (p.input.forward * fz + p.input.right * rz) * speed;
    
    if (p.input.jump && p.onGround) { p.vy = 9; p.onGround = false; }
    p.vy -= 20 * dt;
    
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.y <= 1) { p.y = 1; p.vy = 0; p.onGround = true; }
    
    p.x = Math.max(-50, Math.min(50, p.x));
    p.z = Math.max(-50, Math.min(50, p.z));
  });

  players.forEach(p => {
    if (p.ws.readyState !== 1) return;
    const visible = [];
    players.forEach(o => {
      if (o.id === p.id) return;
      if (Math.hypot(p.x - o.x, p.z - o.z) < 45) {
        visible.push({ id: o.id, x: o.x, y: o.y, z: o.z, yaw: o.yaw });
      }
    });
    try {
      p.ws.send(JSON.stringify({ type: 'snapshot', players: visible }));
    } catch (e) {}
  });
}, 1000 / 25);

function broadcast(data, excludeId = null) {
  const msg = JSON.stringify(data);
  players.forEach(p => {
    if (p.id !== excludeId && p.ws.readyState === 1) {
      try { p.ws.send(msg); } catch(e){}
    }
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 SERVER RUNNING on port ${PORT}`);
  console.log(`👥 Max players: ${MAX_PLAYERS}`);
});

process.on('SIGINT', () => { console.log('\n🛑 Stopping...'); process.exit(0); });

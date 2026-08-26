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

const players = new Map();
const gameStates = {
  shooter: { players: new Map(), red: 0, blue: 0 },
  brookhaven: { players: new Map() },
  cheese: { players: new Map() },
  brainrot: { players: new Map() }
};

wss.on('connection', (ws) => {
  let pid = null;

  ws.on('message', (raw) => {
    try {
      const d = JSON.parse(raw);

      if (d.type === 'register') {
        const name = (d.name || 'Guest').trim().slice(0, 16);
        if (name.length < 2) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Name too short' }));
          return;
        }
        pid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        players.set(pid, {
          ws, name, game: 'menu',
          x: 0, y: 1, z: 0, yaw: 0,
          health: 100, team: null,
          input: { f: 0, r: 0, jump: false }
        });
        ws.send(JSON.stringify({ type: 'registered', id: pid, name }));
        console.log(`[+] ${name} connected`);
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

      if (d.type === 'join' && gameStates[d.gameId]) {
        if (p.game !== 'menu' && gameStates[p.game].players) {
          gameStates[p.game].players.delete(pid);
        }
        p.game = d.gameId;
        p.health = 100;
        p.x = (Math.random() - 0.5) * 10;
        p.z = (Math.random() - 0.5) * 10;
        p.y = 1;
        if (d.gameId === 'shooter') {
          p.team = Math.random() > 0.5 ? 'red' : 'blue';
        }
        gameStates[d.gameId].players.set(pid, p);
        ws.send(JSON.stringify({ type: 'gameReady', gameId: d.gameId, team: p.team }));
        console.log(`[*] ${p.name} joined ${d.gameId}`);
      }

      if (d.type === 'chat' && d.msg) {
        const msg = d.msg.substring(0, 120).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        broadcast({ type: 'chat', name: p.name, msg, gameId: p.game });
      }

      if (d.type === 'action' && p.game === 'shooter' && p.team) {
        gameStates.shooter.players.forEach((other, oid) => {
          if (oid === pid || other.team === p.team) return;
          const dist = Math.hypot(other.x - p.x, other.z - p.z);
          if (dist < 8) {
            other.health -= 25;
            if (other.health <= 0) {
              other.health = 100;
              other.x = (Math.random() - 0.5) * 10;
              other.z = (Math.random() - 0.5) * 10;
              gameStates.shooter[p.team]++;
              broadcast({
                type: 'kill',
                killer: p.name,
                victim: other.name,
                scores: { red: gameStates.shooter.red, blue: gameStates.shooter.blue }
              });
            }
          }
        });
        ws.send(JSON.stringify({ type: 'shoot' }));
      }

    } catch (e) { console.error('WS Error:', e); }
  });

  ws.on('close', () => {
    if (pid && players.has(pid)) {
      const p = players.get(pid);
      if (p.game !== 'menu' && gameStates[p.game].players) {
        gameStates[p.game].players.delete(pid);
      }
      players.delete(pid);
      console.log(`[-] ${p.name} disconnected`);
    }
  });

  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
});

setInterval(() => {
  players.forEach(p => {
    if (p.ws.readyState !== 1 || p.game === 'menu') return;

    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    p.x += (p.input.f * fx + p.input.r * rx) * 0.15;
    p.z += (p.input.f * fz + p.input.r * rz) * 0.15;
    p.x = Math.max(-40, Math.min(40, p.x));
    p.z = Math.max(-40, Math.min(40, p.z));

    if (p.input.jump && p.y <= 1.1) { p.y = 3.2; p.input.jump = false; }
    if (p.y > 1) p.y -= 0.22;
    if (p.y < 1) p.y = 1;

    const nearby = [];
    gameStates[p.game].players.forEach((other, oid) => {
      if (oid !== p.id && Math.hypot(other.x - p.x, other.z - p.z) < 50) {
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
      scores: p.game === 'shooter' ? { red: gameStates.shooter.red, blue: gameStates.shooter.blue } : null
    }));
  });
}, 1000 / 24);

function broadcast(data) {
  const msg = JSON.stringify(data);
  players.forEach(p => {
    if (p.ws.readyState === 1 && (!data.gameId || p.game === data.gameId)) {
      try { p.ws.send(msg); } catch(e) {}
    }
  });
}

setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

server.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));

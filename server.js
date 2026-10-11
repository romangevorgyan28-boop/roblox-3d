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
const shooter = {
  state: 'lobby', map: 'arena',
  red: [], blue: [],
  redScore: 0, blueScore: 0,
  roundTimer: 180, roundInterval: null,
  waiting: []
};

wss.on('connection', (ws) => {
  let pid = null;

  ws.on('message', (raw) => {
    try {
      const d = JSON.parse(raw);

      if (d.type === 'register') {
        const name = String(d.name || 'Guest').replace(/[<>\"&]/g, '').trim().substring(0, 16);
        if (name.length < 2) { ws.send(JSON.stringify({ type: 'error', msg: 'Короткий ник' })); return; }
        pid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        players.set(pid, { ws, name, game: 'menu', x: 0, y: 1, z: 0, yaw: 0, health: 100, team: null, input: { f: 0, r: 0, jump: false }, lastAction: 0 });
        ws.send(JSON.stringify({ type: 'registered', id: pid, name }));
        console.log(`[+] ${name} connected`);
        broadcastState();
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
        p.game = 'shooter'; p.health = 100; p.team = null;
        if (shooter.state === 'playing') {
          shooter.waiting.push(pid);
          ws.send(JSON.stringify({ type: 'waiting_lobby', msg: 'Раунд идёт. Ждите...' }));
        } else {
          ws.send(JSON.stringify({ type: 'gameReady', state: shooter.state }));
        }
        broadcastState();
        return;
      }

      if (d.type === 'select_map' && shooter.state === 'map_select') {
        shooter.map = d.map || 'arena';
        shooter.state = 'team_select';
        broadcastState();
        return;
      }

      if (d.type === 'select_team' && shooter.state === 'team_select') {
        const team = d.team;
        if (team !== 'red' && team !== 'blue') return;
        const list = team === 'red' ? shooter.red : shooter.blue;
        if (list.length < 2 && !shooter.red.includes(pid) && !shooter.blue.includes(pid)) {
          list.push(pid); p.team = team;
          broadcastState();
          if (shooter.red.length === 2 && shooter.blue.length === 2) setTimeout(startRound, 1000);
        }
        return;
      }

      if (d.type === 'action' && p.game === 'shooter' && shooter.state === 'playing' && p.team) {
        const now = Date.now();
        if (now - p.lastAction < 500) return;
        p.lastAction = now;
        const enemy = p.team === 'red' ? shooter.blue : shooter.red;
        enemy.forEach(oid => {
          const o = players.get(oid);
          if (!o) return;
          const dist = Math.hypot(o.x - p.x, o.z - p.z);
          if (dist < 10) {
            o.health -= 25;
            if (o.health <= 0) {
              o.health = 100;
              o.x = p.team === 'red' ? -20 + Math.random() * 5 : 20 + Math.random() * 5;
              o.z = (Math.random() - 0.5) * 20;
              if (p.team === 'red') shooter.redScore++; else shooter.blueScore++;
              broadcastState();
              broadcastShooter({ type: 'kill', killer: p.name, victim: o.name });
            }
          }
        });
        ws.send(JSON.stringify({ type: 'shoot', hit: true }));
        return;
      }

      if (d.type === 'chat' && d.msg) {
        const msg = String(d.msg).replace(/[<>]/g, '').trim().substring(0, 200);
        if (msg) broadcastShooter({ type: 'chat', name: p.name, msg });
      }
    } catch (e) { console.error('WS:', e); }
  });

  ws.on('close', () => {
    if (pid && players.has(pid)) {
      const p = players.get(pid);
      if (p.game === 'shooter') {
        shooter.red = shooter.red.filter(id => id !== pid);
        shooter.blue = shooter.blue.filter(id => id !== pid);
        shooter.waiting = shooter.waiting.filter(id => id !== pid);
        if (shooter.state === 'playing' && (shooter.red.length < 1 || shooter.blue.length < 1)) endRound();
      }
      players.delete(pid);
      broadcastState();
    }
  });

  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
});

function startRound() {
  shooter.state = 'playing';
  shooter.roundTimer = 180;
  shooter.redScore = 0; shooter.blueScore = 0;
  shooter.red.forEach(pid => {
    const p = players.get(pid);
    if (p) { p.health = 100; p.x = -20 + Math.random() * 5; p.z = (Math.random() - 0.5) * 20; p.y = 1; p.ws.send(JSON.stringify({ type: 'round_start', team: 'red', time: 180 })); }
  });
  shooter.blue.forEach(pid => {
    const p = players.get(pid);
    if (p) { p.health = 100; p.x = 20 + Math.random() * 5; p.z = (Math.random() - 0.5) * 20; p.y = 1; p.ws.send(JSON.stringify({ type: 'round_start', team: 'blue', time: 180 })); }
  });
  shooter.waiting.forEach(pid => {
    const p = players.get(pid);
    if (p) {
      p.health = 100; p.team = Math.random() > 0.5 ? 'red' : 'blue';
      p.x = p.team === 'red' ? -20 : 20; p.z = (Math.random() - 0.5) * 20; p.y = 1;
      if (p.team === 'red') shooter.red.push(pid); else shooter.blue.push(pid);
      p.ws.send(JSON.stringify({ type: 'round_start', team: p.team, time: 180 }));
    }
  });
  shooter.waiting = [];
  broadcastState();
  shooter.roundInterval = setInterval(() => {
    shooter.roundTimer--;
    if (shooter.roundTimer <= 0) endRound();
    else broadcastShooter({ type: 'timer', time: shooter.roundTimer });
  }, 1000);
}

function endRound() {
  if (shooter.roundInterval) { clearInterval(shooter.roundInterval); shooter.roundInterval = null; }
  const winner = shooter.redScore > shooter.blueScore ? 'red' : shooter.blueScore > shooter.redScore ? 'blue' : 'draw';
  broadcastShooter({ type: 'round_end', winner, redScore: shooter.redScore, blueScore: shooter.blueScore });
  setTimeout(() => {
    shooter.state = 'lobby'; shooter.red = []; shooter.blue = []; shooter.waiting = [];
    players.forEach(p => { if (p.game === 'shooter') { p.team = null; p.ws.send(JSON.stringify({ type: 'back_to_lobby' })); } });
    broadcastState();
  }, 5000);
}

function broadcastState() {
  const sp = Array.from(players.values()).filter(p => p.game === 'shooter');
  const data = { type: 'shooter_state', state: shooter.state, playerCount: sp.length, map: shooter.map, red: shooter.red.map(id => players.get(id)?.name).filter(Boolean), blue: shooter.blue.map(id => players.get(id)?.name).filter(Boolean), redScore: shooter.redScore, blueScore: shooter.blueScore, time: shooter.roundTimer };
  sp.forEach(p => { try { p.ws.send(JSON.stringify(data)); } catch(e) {} });
}

function broadcastShooter(data) {
  const msg = JSON.stringify(data);
  players.forEach(p => { if (p.ws.readyState === 1 && p.game === 'shooter') { try { p.ws.send(msg); } catch(e) {} } });
}

setInterval(() => {
  players.forEach(p => {
    if (p.ws.readyState !== 1) return;
    if (p.game === 'shooter' && shooter.state === 'playing') {
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      const nx = p.x + (p.input.f * fx + p.input.r * rx) * 0.15;
      const nz = p.z + (p.input.f * fz + p.input.r * rz) * 0.15;
      const dist = Math.hypot(nx - p.x, nz - p.z);
      if (dist <= 0.5) { p.x = Math.max(-50, Math.min(50, nx)); p.z = Math.max(-50, Math.min(50, nz)); }
      if (p.input.jump && p.y <= 1.1) { p.y = 3.2; p.input.jump = false; }
      if (p.y > 1) p.y -= 0.22;
      if (p.y < 1) p.y = 1;
      const nearby = [];
      [...shooter.red, ...shooter.blue].forEach(oid => {
        const o = players.get(oid);
        if (o && oid !== p.id && Math.hypot(o.x - p.x, o.z - p.z) < 60) {
          nearby.push({ id: oid, name: o.name, x: o.x, y: o.y, z: o.z, yaw: o.yaw, team: o.team, health: o.health });
        }
      });
      p.ws.send(JSON.stringify({ type: 'snapshot', players: nearby, health: p.health, team: p.team }));
    }
  });
}, 1000 / 24);

setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); });
}, 15000);

server.listen(PORT, '0.0.0.0', () => console.log(`✅ Server on ${PORT}`));

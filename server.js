const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ===================== USERS (registration / authentication) =====================
// stored in users.json on disk so accounts survive restarts
const USERS_FILE = path.join(__dirname, 'users.json');
let usersDb = {};
try { usersDb = JSON.parse(require('fs').readFileSync(USERS_FILE, 'utf8')); } catch (e) { usersDb = {}; }
function saveUsers() {
  try { require('fs').writeFileSync(USERS_FILE, JSON.stringify(usersDb, null, 2)); } catch (e) {}
}
function hashPass(salt, pass) { return crypto.scryptSync(String(pass), salt, 32).toString('hex'); }
function makeToken() { return crypto.randomBytes(24).toString('hex'); }
const sessions = new Map(); // token -> username

app.post('/api/register', (req, res) => {
  const u = String((req.body && req.body.username) || '').trim();
  const p = String((req.body && req.body.password) || '');
  if (!/^[a-zA-Z0-9_\u0400-\u04FF -]{2,16}$/.test(u)) return res.json({ ok: false, msg: 'Ник: 2–16 символов (буквы, цифры, _)' });
  if (p.length < 4) return res.json({ ok: false, msg: 'Пароль должен быть не короче 4 символов' });
  const key = u.toLowerCase();
  if (usersDb[key]) return res.json({ ok: false, msg: 'Такой игрок уже зарегистрирован' });
  const salt = crypto.randomBytes(16).toString('hex');
  usersDb[key] = { username: u, salt, hash: hashPass(salt, p), avatar: null, created: Date.now() };
  saveUsers();
  const token = makeToken();
  sessions.set(token, key);
  res.json({ ok: true, token, username: u, avatar: usersDb[key].avatar });
});

app.post('/api/login', (req, res) => {
  const u = String((req.body && req.body.username) || '').trim();
  const p = String((req.body && req.body.password) || '');
  const key = u.toLowerCase();
  const rec = usersDb[key];
  if (!rec) return res.json({ ok: false, msg: 'Игрок не найден — зарегистрируйтесь' });
  if (hashPass(rec.salt, p) !== rec.hash) return res.json({ ok: false, msg: 'Неверный пароль' });
  const token = makeToken();
  sessions.set(token, key);
  res.json({ ok: true, token, username: rec.username, avatar: rec.avatar });
});

app.post('/api/logout', (req, res) => {
  const t = String((req.body && req.body.token) || '');
  sessions.delete(t);
  res.json({ ok: true });
});

app.post('/api/me', (req, res) => {
  const t = String((req.body && req.body.token) || '');
  const key = sessions.get(t);
  if (!key || !usersDb[key]) return res.json({ ok: false });
  res.json({ ok: true, username: usersDb[key].username, avatar: usersDb[key].avatar });
});

app.post('/api/avatar', (req, res) => {
  const t = String((req.body && req.body.token) || '');
  const key = sessions.get(t);
  if (!key || !usersDb[key]) return res.json({ ok: false, msg: 'Сессия истекла' });
  const b = req.body || {};
  const clean = {};
  ['skin', 'shirt', 'pants'].forEach(k => { if (/^#[0-9a-fA-F]{6}$/.test(b[k])) clean[k] = b[k].toLowerCase(); });
  ['face', 'hair'].forEach(k => { if (typeof b[k] === 'number' && b[k] >= 0 && b[k] <= 7) clean[k] = Math.floor(b[k]); });
  if (typeof b.hat === 'number' && b.hat >= 0 && b.hat <= 5) clean.hat = Math.floor(b.hat);
  usersDb[key].avatar = clean;
  saveUsers();
  // update live player if online
  players.forEach(p => { if (p.userKey === key) { p.avatar = clean; broadcastToGame(p.game, { type: 'playerAvatar', id: p.id, avatar: clean }); } });
  res.json({ ok: true, avatar: clean });
});

// real online stats for the menu (poll over HTTP)
app.get('/api/stats', (req, res) => {
  const perGame = {};
  Object.keys(games).forEach(g => { perGame[g] = games[g].players.size; });
  res.json({ online: players.size, perGame });
});

// ===================== STATE =====================
const players = new Map(); // pid -> player
const games = {
  shooter:    { players: new Map(), red: 0, blue: 0 },
  brookhaven: { players: new Map() },
  cheese:     { players: new Map() },
  airplane:   { players: new Map() },
  racing:     { players: new Map() }
};

const TEAM_SPAWNS = {
  red:  { x: -42, z: -42 },
  blue: { x: 42, z: 42 }
};

function sanitizeName(name) {
  return String(name || 'Guest').trim().slice(0, 16).replace(/[<>]/g, '');
}

wss.on('connection', (ws) => {
  let pid = null;
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
  ws._lastChat = 0;
  ws._lastHit = 0;

  ws.on('message', (raw) => {
    let d;
    try { d = JSON.parse(raw); } catch (e) { return; }
    if (!d || typeof d.type !== 'string') return;

    // ---------- REGISTER (with optional auth token) ----------
    if (d.type === 'register') {
      let name = sanitizeName(d.name);
      let userKey = null;
      let avatar = null;
      const token = typeof d.token === 'string' ? d.token : '';
      if (token && sessions.get(token) && usersDb[sessions.get(token)]) {
        userKey = sessions.get(token);
        name = usersDb[userKey].username;
        avatar = usersDb[userKey].avatar || null;
      } else if (!/^[a-zA-Z0-9_ -]{2,16}$/.test(name)) {
        ws.send(JSON.stringify({ type: 'error', msg: 'Требуется вход в аккаунт или ник 2–16 символов' }));
        return;
      }
      pid = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      players.set(pid, {
        id: pid, ws, name, game: 'menu',
        x: 0, y: 1, z: 0, yaw: 0, moving: false,
        health: 100, team: null, kills: 0, deaths: 0,
        userKey, avatar,
        input: { f: 0, r: 0, jump: false }
      });
      ws.send(JSON.stringify({ type: 'registered', id: pid, name, authenticated: !!userKey }));
      pushStats();
      console.log(`[+] ${name} connected${userKey ? ' (auth)' : ''} (${players.size} total)`);
      return;
    }

    // ---------- WEBSOCKET AUTH (login while connected) ----------
    if (d.type === 'auth') {
      const u = String(d.username || '').trim().toLowerCase();
      const rec = usersDb[u];
      if (!rec || hashPass(rec.salt, String(d.password || '')) !== rec.hash) {
        ws.send(JSON.stringify({ type: 'authFail', msg: 'Неверный логин или пароль' }));
        return;
      }
      const token = makeToken();
      sessions.set(token, u);
      ws.send(JSON.stringify({ type: 'authOk', token, username: rec.username, avatar: rec.avatar }));
      return;
    }

    if (!pid || !players.has(pid)) return;
    const p = players.get(pid);

    // ---------- JOIN GAME ----------
    if (d.type === 'join' && games[d.gameId]) {
      if (p.game !== 'menu' && games[p.game] && games[p.game].players) {
        games[p.game].players.delete(pid);
      }
      p.game = d.gameId;
      p.health = 100;
      p.kills = 0; p.deaths = 0;
      p.team = null;
      if (d.gameId === 'shooter') {
        const redN = [...games.shooter.players.values()].filter(x => x.team === 'red').length;
        const blueN = [...games.shooter.players.values()].filter(x => x.team === 'blue').length;
        p.team = redN <= blueN ? 'red' : 'blue';
        const sp = TEAM_SPAWNS[p.team];
        p.x = sp.x + (Math.random() - 0.5) * 6;
        p.z = sp.z + (Math.random() - 0.5) * 6;
      } else {
        p.x = (Math.random() - 0.5) * 8;
        p.z = (Math.random() - 0.5) * 8;
      }
      p.y = 1;
      games[d.gameId].players.set(pid, p);
      ws.send(JSON.stringify({ type: 'gameReady', gameId: d.gameId, team: p.team }));
      broadcastToGame(d.gameId, { type: 'chat', name: 'sys', msg: `${p.name} присоединился 👋`, sys: true });
      pushStats();
      return;
    }

    // ---------- INPUT (client authoritative for own movement) ----------
    if (d.type === 'input') {
      p.input = {
        f: typeof d.f === 'number' ? Math.max(-1, Math.min(1, d.f)) : 0,
        r: typeof d.r === 'number' ? Math.max(-1, Math.min(1, d.r)) : 0,
        jump: !!d.jump
      };
      if (typeof d.yaw === 'number' && isFinite(d.yaw)) p.yaw = d.yaw;
      p.moving = !!d.moving || p.input.f !== 0 || p.input.r !== 0;
      if (typeof d.x === 'number' && typeof d.z === 'number' && isFinite(d.x) && isFinite(d.z)) {
        p.x = Math.max(-160, Math.min(160, d.x));
        p.z = Math.max(-160, Math.min(160, d.z));
        p.y = typeof d.y === 'number' && isFinite(d.y) ? Math.max(0, Math.min(200, d.y)) : 1;
      }
      return;
    }

    // ---------- CHAT (rate-limited) ----------
    if (d.type === 'chat' && d.msg) {
      const now = Date.now();
      if (now - ws._lastChat < 700) { ws.send(JSON.stringify({ type: 'rateLimited' })); return; }
      ws._lastChat = now;
      const msg = String(d.msg).substring(0, 140);
      broadcastToGame(p.game, { type: 'chat', name: p.name, msg });
      return;
    }

    // ---------- SHOOTER: hitscan reported by shooter's client ----------
    if (d.type === 'hitTry' && p.game === 'shooter') {
      const now = Date.now();
      if (now - ws._lastHit < 90) return;
      ws._lastHit = now;
      const target = games.shooter.players.get(d.target);
      if (!target || target.id === pid || target.health <= 0) return;
      if (p.team && target.team === p.team) return;
      const dist = Math.hypot(target.x - p.x, target.z - p.z);
      if (dist > 160) return;
      const dmg = 18 + Math.floor(Math.random() * 10);
      target.health -= dmg;
      ws.send(JSON.stringify({ type: 'hit', damage: dmg, victim: target.name }));
      if (target.health <= 0) {
        target.health = 100;
        target.deaths++;
        const sp = TEAM_SPAWNS[target.team] || { x: 0, z: 0 };
        target.x = sp.x + (Math.random() - 0.5) * 6;
        target.z = sp.z + (Math.random() - 0.5) * 6;
        target.y = 1;
        p.kills++;
        games.shooter[p.team]++;
        target.ws.send(JSON.stringify({ type: 'killedBy', killer: p.name }));
        ws.send(JSON.stringify({ type: 'hit', kill: true, victim: target.name }));
        broadcastToGame('shooter', { type: 'chat', name: 'sys', sys: true, msg: `💀 ${p.name} убил ${target.name}` });
      }
      return;
    }

    // ---------- HEAL PACK ----------
    if (d.type === 'healRequest' && p.game === 'shooter') {
      p.health = Math.min(100, p.health + 35);
      return;
    }

    // ---------- CHEESE: death by rat ----------
    if (d.type === 'cheeseDie' && p.game === 'cheese') {
      p.health = 100;
      p.x = (Math.random() - 0.5) * 6;
      p.z = (Math.random() - 0.5) * 6;
      p.y = 1;
      ws.send(JSON.stringify({ type: 'respawn' }));
      return;
    }

    // ---------- RESPAWN ----------
    if (d.type === 'respawn') {
      p.health = 100;
      if (p.game === 'shooter') {
        const sp = TEAM_SPAWNS[p.team] || { x: 0, z: 0 };
        p.x = sp.x + (Math.random() - 0.5) * 6;
        p.z = sp.z + (Math.random() - 0.5) * 6;
      } else {
        p.x = (Math.random() - 0.5) * 8;
        p.z = (Math.random() - 0.5) * 8;
      }
      p.y = 1;
      ws.send(JSON.stringify({ type: 'respawn' }));
      return;
    }

    if (d.type === 'action') return;
  });

  ws.on('close', () => {
    if (pid && players.has(pid)) {
      const p = players.get(pid);
      if (p.game !== 'menu' && games[p.game] && games[p.game].players) {
        games[p.game].players.delete(pid);
        broadcastToGame(p.game, { type: 'chat', name: 'sys', msg: `${p.name} вышел 😢`, sys: true });
      }
      players.delete(pid);
      pushStats();
      console.log(`[-] ${p.name} disconnected (${players.size} left)`);
    }
  });
});

// ===================== REAL ONLINE STATS PUSH =====================
const menuSockets = new Set(); // ws of players currently in menu
function pushStats() {
  const perGame = {};
  Object.keys(games).forEach(g => { perGame[g] = games[g].players.size; });
  const msg = JSON.stringify({ type: 'stats', online: players.size, perGame });
  players.forEach(p => {
    if (p.ws.readyState === 1) { try { p.ws.send(msg); } catch (e) {} }
  });
}

function broadcastToGame(gameId, data) {
  if (!games[gameId]) return;
  const msg = JSON.stringify(data);
  games[gameId].players.forEach(pl => {
    if (pl.ws.readyState === 1) { try { pl.ws.send(msg); } catch (e) {} }
  });
}

// ===================== SNAPSHOT LOOP (24 Hz) =====================
setInterval(() => {
  const ping = Math.round(10 + Math.random() * 25);
  Object.keys(games).forEach(gid => {
    const g = games[gid];
    g.players.forEach((p) => {
      if (p.ws.readyState !== 1) return;
      const nearby = [];
      g.players.forEach((other, oid) => {
        if (oid === p.id) return;
        if (Math.hypot(other.x - p.x, other.z - p.z) < 90) {
          nearby.push({
            id: oid, name: other.name,
            x: other.x, y: other.y, z: other.z, yaw: other.yaw,
            team: other.team, hp: other.health, moving: other.moving,
            avatar: other.avatar || null
          });
        }
      });
      const payload = {
        type: 'snapshot',
        players: nearby,
        health: p.health,
        team: p.team,
        kills: p.kills,
        deaths: p.deaths,
        ping,
        online: players.size,
        gamePlayers: g.players.size,
        scores: gid === 'shooter' ? { red: g.red, blue: g.blue } : undefined
      };
      try { p.ws.send(JSON.stringify(payload)); } catch (e) {}
    });
  });
}, 1000 / 24);

// ===================== KEEPALIVE =====================
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

server.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT}`));

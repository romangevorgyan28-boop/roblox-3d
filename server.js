const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
const PORT = process.env.PORT || 3000;

// Раздаем всё из корня (плоская структура)
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ===== БЕЗОПАСНОСТЬ =====
const NAME_REGEX = /^[a-zA-Z0-9_а-яА-ЯёЁ]{2,16}$/;
const RATE_LIMIT = 1500; // мс между действиями
const players = new Map();

function sanitize(name) {
  return name.trim().replace(/[^\wа-яА-ЯёЁ]/g, '').substring(0, 16);
}

function checkRateLimit(id) {
  const p = players.get(id);
  if (!p) return false;
  const now = Date.now();
  if (now - p.lastAction < RATE_LIMIT) return true;
  p.lastAction = now;
  return false;
}

// ===== ИГРОВОЕ СОСТОЯНИЕ =====
const gameStates = {
  brookhaven: { players: new Map() },
  shooter: { players: new Map(), red: 0, blue: 0, map: { w: 60, h: 60 } },
  brainrot: { players: new Map() },
  cheese: { players: new Map(), walls: [], cheeses: [], rat: { x: 0, z: 0 } }
};

wss.on('connection', (ws) => {
  let pid = null;

  ws.on('message', (raw) => {
    try {
      const d = JSON.parse(raw);

      // РЕГИСТРАЦИЯ
      if (d.type === 'register') {
        const clean = sanitize(d.name);
        if (!NAME_REGEX.test(clean)) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Ник: 2-16 букв/цифр' }));
          return;
        }
        pid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        players.set(pid, {
          ws, name: clean, lastAction: 0, game: 'menu',
          x: 0, y: 1, z: 0, yaw: 0, health: 100, team: null, input: { f: 0, r: 0, jump: false }
        });
        ws.send(JSON.stringify({ type: 'registered', id: pid, name: clean }));
        return;
      }

      if (!pid || !players.has(pid)) return;
      const p = players.get(pid);

      // ВВОД
      if (d.type === 'input') {
        p.input = {
          f: typeof d.f === 'number' ? Math.max(-1, Math.min(1, d.f)) : 0,
          r: typeof d.r === 'number' ? Math.max(-1, Math.min(1, d.r)) : 0,
          jump: !!d.jump
        };
        if (typeof d.yaw === 'number') p.yaw = d.yaw;
      }

      // СМЕНА ИГРЫ
      if (d.type === 'join' && gameStates[d.gameId]) {
        // Очистка из старой игры
        if (p.game !== 'menu') gameStates[p.game].players.delete(pid);
        
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
      }

      // ЧАТ
      if (d.type === 'chat' && d.msg) {
        if (checkRateLimit(pid)) return;
        const safe = d.msg.substring(0, 100).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        broadcast({ type: 'chat', name: p.name, msg: safe, gameId: p.game });
      }

      // ДЕЙСТВИЕ (Стрельба)
      if (d.type === 'action' && p.game === 'shooter' && p.team) {
        if (checkRateLimit(pid)) return;
        
        let hit = false;
        gameStates.shooter.players.forEach((other, oid) => {
          if (oid === pid || other.team === p.team) return;
          const dist = Math.hypot(other.x - p.x, other.z - p.z);
          if (dist < 8) { // Радиус поражения
            other.health -= 25;
            hit = true;
            if (other.health <= 0) {
              other.health = 100;
              other.x = (Math.random() - 0.5) * 10;
              other.z = (Math.random() - 0.5) * 10;
              gameStates.shooter[p.team]++;
              broadcast({ type: 'kill', killer: p.name, victim: other.name, scores: { red: gameStates.shooter.red, blue: gameStates.shooter.blue } });
            }
          }
        });
        ws.send(JSON.stringify({ type: 'shoot', hit }));
      }

    } catch (e) { console.error('WS Error:', e); }
  });

  ws.on('close', () => {
    if (pid && players.has(pid)) {
      const p = players.get(pid);
      if (p.game !== 'menu') gameStates[p.game].players.delete(pid);
      players.delete(pid);
      broadcast({ type: 'playerLeft', id: pid });
    }
  });
});

// ИГРОВОЙ ТИК (24 Гц)
setInterval(() => {
  players.forEach(p => {
    if (p.ws.readyState !== 1 || p.game === 'menu') return;

    // Физика
    const speed = 0.18;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    
    let nx = p.x + (p.input.f * fx + p.input.r * rx) * speed;
    let nz = p.z + (p.input.f * fz + p.input.r * rz) * speed;
    
    // Границы карты
    const bound = gameStates[p.game]?.map?.w / 2 || 30;
    nx = Math.max(-bound, Math.min(bound, nx));
    nz = Math.max(-bound, Math.min(bound, nz));
    
    p.x = nx; p.z = nz;
    if (p.input.jump && p.y <= 1.1) { p.y = 3.2; p.input.jump = false; }
    if (p.y > 1) p.y -= 0.22;
    if (p.y < 1) p.y = 1;

    // Отправка снимка
    const nearby = [];
    gameStates[p.game].players.forEach((other, oid) => {
      if (oid !== p.id && Math.hypot(other.x - p.x, other.z - p.z) < 35) {
        nearby.push({ id: oid, name: other.name, x: other.x, y: other.y, z: other.z, yaw: other.yaw, health: other.health, team: other.team });
      }
    });

    p.ws.send(JSON.stringify({
      type: 'snapshot', players: nearby, health: p.health, team: p.team, game: p.game,
      scores: p.game === 'shooter' ? { red: gameStates.shooter.red, blue: gameStates.shooter.blue } : null
    }));
  });
}, 1000 / 24);

function broadcast(data) {
  const msg = JSON.stringify(data);
  players.forEach(p => { if (p.ws.readyState === 1) try { p.ws.send(msg); } catch(e){} });
}

server.listen(PORT, '0.0.0.0', () => console.log(`✅ SERVER :${PORT}`));

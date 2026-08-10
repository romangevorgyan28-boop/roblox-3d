/**
 * 🧱 ROBLOX 3D ULTIMATE SERVER v4.0
 * Оптимизирован под Render (512MB RAM / 0.1 CPU)
 * Поддержка: Brookhaven RP, Team Shooter, Brainrot, Cheese Horror
 */

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

// ===== ИНИЦИАЛИЗАЦИЯ =====
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024, perMessageDeflate: false });
const PORT = process.env.PORT || 3000;

// Раздаём все файлы из корня (плоская структура)
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ===== КОНФИГУРАЦИЯ И БЕЗОПАСНОСТЬ =====
const CONFIG = {
  TICK_RATE: 24,
  GRAVITY: 18,
  MOVE_SPEED: 7.5,
  JUMP_FORCE: 9.5,
  RATE_LIMIT_MS: 1500,
  MAX_NAME_LEN: 16,
  MIN_NAME_LEN: 2,
  NAME_REGEX: /^[a-zA-Z0-9_а-яА-ЯёЁ]+$/
};

const players = new Map();
const gameStates = {
  brookhaven: { players: new Map() },
  shooter: { players: new Map(), red: 0, blue: 0, bounds: { x: 40, z: 40 } },
  brainrot: { players: new Map(), artifact: { x: 0, z: 0, holder: null, collected: false } },
  cheese: { players: new Map(), walls: [], cheeses: [], rat: { x: 0, z: 0, yaw: 0 }, exit: { x: 0, z: 0, open: false } }
};

// Проверка лимита сообщений
function checkRateLimit(id) {
  const p = players.get(id);
  if (!p) return true;
  const now = Date.now();
  if (now - p.lastAction < CONFIG.RATE_LIMIT_MS) return true;
  p.lastAction = now;
  return false;
}

// Очистка ника
function sanitizeName(name) {
  return name.trim().slice(0, CONFIG.MAX_NAME_LEN).replace(/[^\wа-яА-ЯёЁ]/g, '');
}

// ===== WEBSOCKET ОБРАБОТКА =====
wss.on('connection', (ws) => {
  let pid = null;

  ws.on('message', (raw) => {
    try {
      const d = JSON.parse(raw);

      // 1. РЕГИСТРАЦИЯ
      if (d.type === 'register') {
        const clean = sanitizeName(d.name || '');
        if (clean.length < CONFIG.MIN_NAME_LEN || clean.length > CONFIG.MAX_NAME_LEN || !CONFIG.NAME_REGEX.test(clean)) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Ник: 2-16 букв/цифр' }));
          return;
        }
        pid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        players.set(pid, {
          ws, name: clean, lastAction: 0, game: 'menu',
          x: 0, y: 1, z: 0, yaw: 0, health: 100, team: null,
          input: { f: 0, r: 0, jump: false }
        });
        ws.send(JSON.stringify({ type: 'registered', id: pid, name: clean }));
        return;
      }

      if (!pid || !players.has(pid)) return;
      const p = players.get(pid);

      // 2. ВВОД
      if (d.type === 'input') {
        p.input = {
          f: typeof d.f === 'number' ? Math.max(-1, Math.min(1, d.f)) : 0,
          r: typeof d.r === 'number' ? Math.max(-1, Math.min(1, d.r)) : 0,
          jump: !!d.jump
        };
        if (typeof d.yaw === 'number') p.yaw = d.yaw;
      }

      // 3. СМЕНА ИГРЫ
      if (d.type === 'join' && gameStates[d.gameId]) {
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

      // 4. ЧАТ
      if (d.type === 'chat' && d.msg) {
        if (checkRateLimit(pid)) return;
        const safe = d.msg.substring(0, 120).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        broadcast({ type: 'chat', name: p.name, msg: safe, gameId: p.game });
      }

      // 5. ДЕЙСТВИЕ (Стрельба / Сбор)
      if (d.type === 'action') {
        if (checkRateLimit(pid)) return;

        if (p.game === 'shooter' && p.team) {
          let hit = false;
          gameStates.shooter.players.forEach((other, oid) => {
            if (oid === pid || other.team === p.team) return;
            const dist = Math.hypot(other.x - p.x, other.z - p.z);
            if (dist < 8) {
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

        if (p.game === 'brainrot' && !gameStates.brainrot.artifact.collected) {
          const art = gameStates.brainrot.artifact;
          if (Math.hypot(p.x - art.x, p.z - art.z) < 3) {
            art.collected = true;
            art.holder = pid;
            broadcast({ type: 'artifactStolen', name: p.name });
          }
        }
      }

    } catch (e) { console.error('WS Parse Error:', e); }
  });

  ws.on('close', () => {
    if (pid && players.has(pid)) {
      const p = players.get(pid);
      if (p.game !== 'menu') gameStates[p.game].players.delete(pid);
      players.delete(pid);
      broadcast({ type: 'playerLeft', id: pid });
    }
  });

  // Heartbeat
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
});

// ===== ИГРОВОЙ ЦИКЛ (24 Гц) =====
setInterval(() => {
  players.forEach(p => {
    if (p.ws.readyState !== 1 || p.game === 'menu') return;

    // Физика движения
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    let nx = p.x + (p.input.f * fx + p.input.r * rx) * CONFIG.MOVE_SPEED * (1/CONFIG.TICK_RATE);
    let nz = p.z + (p.input.f * fz + p.input.r * rz) * CONFIG.MOVE_SPEED * (1/CONFIG.TICK_RATE);
    
    // Границы
    const bound = gameStates[p.game]?.bounds?.x || 40;
    nx = Math.max(-bound, Math.min(bound, nx));
    nz = Math.max(-bound, Math.min(bound, nz));
    
    p.x = nx; p.z = nz;
    if (p.input.jump && p.y <= 1.1) { p.y = 3.2; p.input.jump = false; }
    if (p.y > 1) p.y -= CONFIG.GRAVITY * (1/CONFIG.TICK_RATE);
    if (p.y < 1) p.y = 1;

    // Генерация снимка мира
    const nearby = [];
    gameStates[p.game].players.forEach((other, oid) => {
      if (oid !== p.id && Math.hypot(other.x - p.x, other.z - p.z) < 40) {
        nearby.push({ id: oid, name: other.name, x: other.x, y: other.y, z: other.z, yaw: other.yaw, health: other.health, team: other.team });
      }
    });

    p.ws.send(JSON.stringify({
      type: 'snapshot',
      players: nearby,
      health: p.health,
      team: p.team,
      game: p.game,
      scores: p.game === 'shooter' ? { red: gameStates.shooter.red, blue: gameStates.shooter.blue } : null
    }));
  });
}, 1000 / CONFIG.TICK_RATE);

// Heartbeat проверка каждые 20 сек
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 20000);

// Рассылка с фильтрацией по игре
function broadcast(data, excludeId = null, targetGame = null) {
  const msg = JSON.stringify(data);
  players.forEach(p => {
    if (p.id !== excludeId && p.ws.readyState === 1) {
      if (!targetGame || p.game === targetGame) {
        try { p.ws.send(msg); } catch(e) {}
      }
    }
  });
}

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => console.log(`✅ SERVER RUNNING :${PORT}`));

//Graceful shutdown
process.on('SIGINT', () => { console.log('\n🛑 Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => process.exit(0));

/**
 * 🧱 ROBLOX 3D ULTIMATE SERVER v5.0
 * Оптимизирован под слабое железо (512MB RAM / 0.1 CPU)
 * Игры: Brookhaven RP, Team Shooter, Steal a Brainrot, Horror of Cheese
 *
 * Что нового в v5.0:
 *  - Полноценная физика снарядов (выстрелы летят и засчитываются на сервере)
 *  - Кулдаун стрельбы вместо общего rate-limit (стрельба больше не блокирует чат)
 *  - AI-боты во всех играх — даже один игрок может играть и побеждать
 *  - Режим Cheese: крыса-монстр (своя физика/ИИ), сыр (нужно собрать), выход
 *  - Режим Brainrot: артефакт можно украсть и донести до базы для победы
 *  - Снимки мира (snapshots) идут только игрокам (боты не рассылают трафик)
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

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ===== КОНФИГУРАЦИЯ =====
const CONFIG = {
  TICK_RATE: 24,
  GRAVITY: 18,
  MOVE_SPEED: 7.5,
  JUMP_FORCE: 9.5,
  CHAT_COOLDOWN_MS: 1500,
  SHOOT_COOLDOWN_MS: 350,
  PROJECTILE_SPEED: 28,
  HIT_RADIUS: 1.0,
  MAX_NAME_LEN: 16,
  MIN_NAME_LEN: 2,
  NAME_REGEX: /^[a-zA-Z0-9_а-яА-ЯёЁ]+$/
};

const BOT_NAMES = ['xX_Killer_Xx', 'NoobMaster', 'Pro_Gamer', 'Sigma_Boy', 'Tupik073',
  'Kirill228', 'MaxPlay', 'BOT_Vasya', 'DarkLord', 'CheeseHunter'];

const players = new Map();
const bots = [];
const projectiles = []; // активные снаряды (по играм)

const gameStates = {
  brookhaven: { players: new Map(), bounds: 45 },
  shooter: { players: new Map(), red: 0, blue: 0, bounds: 40 },
  brainrot: {
    players: new Map(), bounds: 40,
    artifact: { x: 0, z: 0, heldBy: null, collected: false },
    base: { x: -35, z: -35 }, wins: {}
  },
  cheese: {
    players: new Map(), bounds: 45,
    cheeses: [],          // [{id,x,z,taken}]
    taken: 0, total: 0,
    rat: { x: 30, z: 30, yaw: 0, speed: 5.2, stun: 0 },
    exit: { x: -40, z: -40, open: false },
    escaped: 0, dead: 0
  }
};

// ===== УТИЛИТЫ =====
function sanitizeName(name) {
  return String(name || '').trim().slice(0, CONFIG.MAX_NAME_LEN).replace(/[^\wа-яА-ЯёЁ]/g, '');
}

function dist2(ax, az, bx, bz) { return Math.hypot(bx - ax, bz - az); }

function clampToGame(p) {
  const b = gameStates[p.game]?.bounds || 40;
  p.x = Math.max(-b, Math.min(b, p.x));
  p.z = Math.max(-b, Math.min(b, p.z));
}

function respawnEntity(e, gameId) {
  e.health = 100;
  if (gameId === 'shooter') {
    const side = e.team === 'red' ? -1 : 1;
    e.x = side * (25 + Math.random() * 10);
    e.z = (Math.random() - 0.5) * 30;
  } else {
    e.x = (Math.random() - 0.5) * 10;
    e.z = (Math.random() - 0.5) * 10;
  }
  e.y = 1;
}

function damageEntity(t, dmg, attacker) {
  if (t.escaped || t.health <= 0) return;
  t.health -= dmg;
  sendTo(t, { type: 'hit', dmg });
  if (attacker) sendTo(attacker, { type: 'shootResult', hit: true, killed: t.health <= 0 && t.game === 'shooter', killer: attacker.name, victim: t.name });
  if (t.health <= 0) {
    if (t.game === 'shooter') {
      const winTeam = attacker?.team || (t.team === 'red' ? 'blue' : 'red');
      t.health = 100; respawnEntity(t, 'shooter');
      gameStates.shooter[winTeam]++;
      broadcast({ type: 'kill', killer: attacker?.name || '?', victim: t.name, scores: { red: gameStates.shooter.red, blue: gameStates.shooter.blue } }, null, 'shooter');
    } else if (t.game === 'cheese') {
      t.health = 0;
      gameStates.cheese.dead++;
      broadcast({ type: 'ratKill', victim: t.name }, null, 'cheese');
      const gs = gameStates.cheese;
      let done = 0;
      gs.players.forEach(q => { if (q.escaped || q.health <= 0) done++; });
      if (done >= gs.players.size) setTimeout(initCheeseRound, 4000);
    } else {
      t.health = 100; respawnEntity(t, t.game);
    }
  }
}

// ===== БОТЫ =====
function makeBot(gameId) {
  const bot = {
    id: 'bot_' + Math.random().toString(36).slice(2, 8),
    isBot: true,
    name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
    game: gameId,
    x: (Math.random() - 0.5) * 30, y: 1, z: (Math.random() - 0.5) * 30,
    yaw: Math.random() * Math.PI * 2,
    health: 100,
    team: gameId === 'shooter' ? (Math.random() > 0.5 ? 'red' : 'blue') : null,
    nextThink: 0, nextShot: 0, tx: 0, tz: 0
  };
  if (gameId === 'shooter') respawnEntity(bot, gameId);
  return bot;
}

function ensureBots() {
  const humans = [...players.values()].filter(p => p.game !== 'menu');
  const desired = Math.min(5, Math.max(2, humans.length + 1));
  for (const g of ['brookhaven', 'shooter', 'brainrot', 'cheese']) {
    const count = bots.filter(b => b.game === g).length;
    if (humans.some(p => p.game === g) && count < desired) {
      const bot = makeBot(g);
      bots.push(bot);
      gameStates[g].players.set(bot.id, bot);
    }
  }
  // удаляем ботов в пустых играх (экономия CPU)
  for (let i = bots.length - 1; i >= 0; i--) {
    const b = bots[i];
    const hasHuman = [...players.values()].some(p => p.game === b.game);
    if (!hasHuman) {
      gameStates[b.game].players.delete(b.id);
      bots.splice(i, 1);
    }
  }
}

function botThink(bot, now) {
  const gs = gameStates[bot.game];
  const targets = [];
  gs.players.forEach((o, oid) => {
    if (oid === bot.id) return;
    if (bot.game === 'shooter' && o.team === bot.team) return;
    targets.push(o);
  });

  if (bot.game === 'shooter') {
    const enemy = targets.find(t => !t.isBot) || targets[0];
    if (enemy) {
      const d = dist2(bot.x, bot.z, enemy.x, enemy.z);
      // вектор взгляда: fx=-sin(yaw), fz=-cos(yaw) → yaw смотрит на врага:
      bot.yaw = Math.atan2(-(enemy.x - bot.x), -(enemy.z - bot.z));
      if (d > 12) { bot.tx = enemy.x; bot.tz = enemy.z; }
      else if (d < 6) { bot.tx = bot.x - (enemy.x - bot.x); bot.tz = bot.z - (enemy.z - bot.z); }
      else { bot.tx = bot.x + Math.cos(now / 900 + bot.x) * 4; bot.tz = bot.z + Math.sin(now / 900 + bot.z) * 4; }
      if (d < 24 && now > bot.nextShot) {
        bot.nextShot = now + CONFIG.SHOOT_COOLDOWN_MS + 250 + Math.random() * 900;
        fireProjectile(bot, enemy);
      }
    } else { bot.tx = (Math.random() - .5) * 60; bot.tz = (Math.random() - .5) * 60; }
  } else if (bot.game === 'brainrot') {
    const art = gs.artifact;
    if (art.heldBy === bot.id) {
      bot.tx = gs.base.x; bot.tz = gs.base.z;
    } else if (!art.collected) {
      bot.tx = art.x; bot.tz = art.z;
    } else {
      const holder = gs.players.get(art.heldBy);
      if (holder) { bot.tx = holder.x; bot.tz = holder.z; }
      else { bot.tx = gs.base.x; bot.tz = gs.base.z; }
    }
    if (!art.collected && dist2(bot.x, bot.z, art.x, art.z) < 2.5 && now > bot.nextShot) {
      bot.nextShot = now + 1500;
      art.collected = true; art.heldBy = bot.id;
      broadcast({ type: 'artifactStolen', name: bot.name }, null, 'brainrot');
    }
  } else if (bot.game === 'cheese') {
    const near = nearestCheese(bot.x, bot.z);
    if (near) { bot.tx = near.x; bot.tz = near.z; }
    else { bot.tx = gs.exit.x; bot.tz = gs.exit.z; }
    // боты «подбирают» сыр, если дошли
    if (near && dist2(bot.x, bot.z, near.x, near.z) < 2) {
      near.taken = true; gs.taken++;
      broadcast({ type: 'worldUpdate', world: buildWorldState('cheese') }, null, 'cheese');
      if (gs.taken >= gs.total && !gs.exit.open) {
        gs.exit.open = true;
        broadcast({ type: 'exitOpened' }, null, 'cheese');
      }
    }
  } else {
    // brookhaven — свободная прогулка
    if (now > bot.nextThink) {
      bot.nextThink = now + 3000 + Math.random() * 4000;
      bot.tx = (Math.random() - .5) * 70; bot.tz = (Math.random() - .5) * 70;
    }
  }
}

function botMove(bot, dt) {
  const d = dist2(bot.x, bot.z, bot.tx, bot.tz);
  if (d < 1.5) return;
  const speed = (bot.game === 'cheese' ? 6 : CONFIG.MOVE_SPEED) * dt;
  bot.x += ((bot.tx - bot.x) / d) * speed;
  bot.z += ((bot.tz - bot.z) / d) * speed;
  clampToGame(bot);
}

// ===== СНАРЯДЫ =====
function fireProjectile(shooter, forcedTarget) {
  let dx, dz;
  if (forcedTarget) {
    dx = forcedTarget.x - shooter.x; dz = forcedTarget.z - shooter.z;
  } else {
    dx = -Math.sin(shooter.yaw); dz = -Math.cos(shooter.yaw);
  }
  const len = Math.hypot(dx, dz) || 1;
  projectiles.push({
    game: shooter.game, owner: shooter.id, team: shooter.team || null,
    x: shooter.x + (dx / len) * 1.2, y: 1.6, z: shooter.z + (dz / len) * 1.2,
    vx: (dx / len) * CONFIG.PROJECTILE_SPEED, vz: (dz / len) * CONFIG.PROJECTILE_SPEED,
    life: 2.2
  });
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.x += pr.vx * dt; pr.z += pr.vz * dt; pr.life -= dt;
    let remove = pr.life <= 0;

    if (pr.game === 'shooter') {
      gameStates.shooter.players.forEach((t, tid) => {
        if (remove || tid === pr.owner) return;
        if (pr.team && t.team === pr.team) return;
        if (dist2(pr.x, pr.z, t.x, t.z) < CONFIG.HIT_RADIUS && Math.abs(t.y - pr.y) < 2) {
          remove = true;
          damageEntity(t, 25, players.get(pr.owner));
        }
      });
    } else if (pr.game === 'cheese') {
      const rat = gameStates.cheese.rat;
      if (dist2(pr.x, pr.z, rat.x, rat.z) < 2.2) {
        remove = true;
        rat.stun = 3.5;
        const attacker = players.get(pr.owner);
        if (attacker) sendTo(attacker, { type: 'shootResult', hit: true });
        broadcast({ type: 'ratStunned', sec: 3.5 }, null, 'cheese');
      }
    }

    if (remove) projectiles.splice(i, 1);
  }
}

// ===== CHEESE: крыса и сыр =====
function initCheeseRound() {
  const gs = gameStates.cheese;
  gs.cheeses = [];
  for (let i = 0; i < 5; i++) {
    gs.cheeses.push({ id: i, x: (Math.random() - .5) * 70, z: (Math.random() - .5) * 70, taken: false });
  }
  gs.total = gs.cheeses.length; gs.taken = 0;
  gs.rat.x = 30; gs.rat.z = 30; gs.rat.stun = 0;
  gs.exit.open = false; gs.escaped = 0; gs.dead = 0;
  gs.players.forEach(p => {
    p.x = (Math.random() - .5) * 12; p.z = (Math.random() - .5) * 12;
    p.y = 1; p.health = 100; p.escaped = false;
  });
}

function nearestCheese(x, z) {
  let best = null, bd = Infinity;
  for (const c of gameStates.cheese.cheeses) {
    if (c.taken) continue;
    const d = dist2(x, z, c.x, c.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function updateRat(dt, now) {
  const gs = gameStates.cheese, rat = gs.rat;
  if (rat.stun > 0) { rat.stun -= dt; return; }
  let target = null, bd = Infinity;
  gs.players.forEach(p => {
    if (p.escaped || p.health <= 0) return;
    const d = dist2(rat.x, rat.z, p.x, p.z);
    // приоритет людям
    if (d < bd && (!target || !p.isBot || target.isBot)) { bd = d; target = p; }
  });
  if (!target) {
    rat.x += Math.sin(now / 2000) * dt * 3;
    rat.z += Math.cos(now / 2400) * dt * 3;
    return;
  }
  const d = bd || 1;
  rat.x += ((target.x - rat.x) / d) * rat.speed * dt;
  rat.z += ((target.z - rat.z) / d) * rat.speed * dt;
  rat.yaw = Math.atan2(-(target.x - rat.x), -(target.z - rat.z));
  if (d < 1.9) {
    if (!rat.lastBite || now - rat.lastBite > 900) {
      rat.lastBite = now;
      damageEntity(target, 40, null);
    }
  } else if (d > 4) {
    rat.lastBite = 0;
  }
}

// ===== BRAINROT: проверка победы =====
function checkBrainrotPickup(p) {
  const gs = gameStates.brainrot;
  const art = gs.artifact;
  if (!art.collected && dist2(p.x, p.z, art.x, art.z) < 2.6) {
    art.collected = true; art.heldBy = p.id;
    broadcast({ type: 'artifactStolen', name: p.name }, null, 'brainrot');
  }
}

function checkBrainrotWin(p) {
  const gs = gameStates.brainrot;
  if (gs.artifact.heldBy === p.id && dist2(p.x, p.z, gs.base.x, gs.base.z) < 5) {
    gs.wins[p.name] = (gs.wins[p.name] || 0) + 1;
    broadcast({ type: 'brainrotWin', name: p.name, wins: gs.wins }, null, 'brainrot');
    gs.artifact.collected = false; gs.artifact.heldBy = null;
    gs.artifact.x = (Math.random() - .5) * 50; gs.artifact.z = (Math.random() - .5) * 50;
  }
}

// ===== ОТПРАВКА =====
function sendTo(entity, obj) {
  if (entity.ws && entity.ws.readyState === 1) {
    try { entity.ws.send(JSON.stringify(obj)); } catch (e) {}
  }
}

function broadcast(data, excludeId = null, targetGame = null) {
  const msg = JSON.stringify(data);
  players.forEach(p => {
    if (p.id !== excludeId && p.ws.readyState === 1) {
      if (!targetGame || p.game === targetGame) {
        try { p.ws.send(msg); } catch (e) {}
      }
    }
  });
}

// ===== WEBSOCKET =====
wss.on('connection', (ws) => {
  let pid = null;

  ws.on('message', (raw) => {
    try {
      const d = JSON.parse(raw);

      // 1. РЕГИСТРАЦИЯ
      if (d.type === 'register') {
        const clean = sanitizeName(d.name || '');
        if (clean.length < CONFIG.MIN_NAME_LEN || !CONFIG.NAME_REGEX.test(clean)) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Ник: 2-16 букв/цифр' }));
          return;
        }
        pid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        players.set(pid, {
          id: pid, ws, name: clean, lastChat: 0, lastShot: 0, game: 'menu',
          x: 0, y: 1, z: 0, yaw: 0, vy: 0, health: 100, team: null, escaped: false,
          input: { f: 0, r: 0, jump: false }
        });
        ws.send(JSON.stringify({ type: 'registered', id: pid, name: clean }));
        return;
      }

      if (!pid || !players.has(pid)) return;
      const p = players.get(pid);

      // 2. ВВОД (плавный, без кулдауна)
      if (d.type === 'input') {
        p.input = {
          f: typeof d.f === 'number' ? Math.max(-1, Math.min(1, d.f)) : 0,
          r: typeof d.r === 'number' ? Math.max(-1, Math.min(1, d.r)) : 0,
          jump: !!d.jump
        };
        if (typeof d.yaw === 'number') p.yaw = d.yaw;
      }

      // 3. ВХОД В ИГРУ
      if (d.type === 'join' && gameStates[d.gameId]) {
        if (p.game !== 'menu') gameStates[p.game].players.delete(pid);
        p.game = d.gameId;
        p.health = 100; p.escaped = false; p.vy = 0;
        p.x = (Math.random() - 0.5) * 10; p.z = (Math.random() - 0.5) * 10; p.y = 1;
        if (d.gameId === 'shooter') {
          p.team = Math.random() > 0.5 ? 'red' : 'blue';
          respawnEntity(p, 'shooter');
        }
        gameStates[d.gameId].players.set(pid, p);
        if (d.gameId === 'cheese') {
          const gsC = gameStates.cheese;
          let allDone = gsC.cheeses.length > 0;
          gsC.players.forEach(q => { if (!q.escaped && q.health > 0) allDone = false; });
          if (gsC.cheeses.length === 0 || (allDone && gsC.exit.open)) initCheeseRound();
        }
        ws.send(JSON.stringify({
          type: 'gameReady', gameId: d.gameId, team: p.team,
          world: buildWorldState(d.gameId)
        }));
      }

      // 4. ЧАТ
      if (d.type === 'chat' && d.msg) {
        const now = Date.now();
        if (now - p.lastChat < CONFIG.CHAT_COOLDOWN_MS) return;
        p.lastChat = now;
        const safe = String(d.msg).substring(0, 120).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        broadcast({ type: 'chat', name: p.name, msg: safe }, null, p.game === 'menu' ? null : p.game);
      }

      // 5. ДЕЙСТВИЯ
      if (d.type === 'action') {
        const now = Date.now();

        if (d.what === 'collect' && p.game === 'cheese') {
          const c = nearestCheese(p.x, p.z);
          if (c && dist2(p.x, p.z, c.x, c.z) < 3) {
            c.taken = true;
            gameStates.cheese.taken++;
            sendTo(p, { type: 'cheeseTaken', taken: gameStates.cheese.taken, total: gameStates.cheese.total });
            broadcast({ type: 'worldUpdate', world: buildWorldState('cheese') }, null, 'cheese');
            if (gameStates.cheese.taken >= gameStates.cheese.total && !gameStates.cheese.exit.open) {
              gameStates.cheese.exit.open = true;
              broadcast({ type: 'exitOpened' }, null, 'cheese');
            }
          }
          return;
        }

        if (d.what === 'escape' && p.game === 'cheese') {
          if (gameStates.cheese.exit.open && !p.escaped &&
              dist2(p.x, p.z, gameStates.cheese.exit.x, gameStates.cheese.exit.z) < 4) {
            p.escaped = true;
            gameStates.cheese.escaped++;
            sendTo(p, { type: 'escaped' });
            broadcast({ type: 'playerEscaped', name: p.name }, null, 'cheese');
            if (gameStates.cheese.escaped + gameStates.cheese.dead >= gameStates.cheese.players.size) {
              setTimeout(initCheeseRound, 4000);
            }
          }
          return;
        }

        if (d.what === 'melee' && p.game === 'shooter') {
          if (now - p.lastShot < 600) return;
          p.lastShot = now;
          let best = null, bd = 4;
          gameStates.shooter.players.forEach((t, tid) => {
            if (tid === pid || t.team === p.team || t.health <= 0) return;
            const dd = dist2(p.x, p.z, t.x, t.z);
            if (dd < bd) { bd = dd; best = t; }
          });
          if (best) damageEntity(best, 50, p);
          return;
        }

        // СТРЕЛЬБА (shooter — по людям, cheese — по крысе)
        if ((d.what === 'shoot' || d.what === undefined) && (p.game === 'shooter' || p.game === 'cheese')) {
          if (now - p.lastShot < CONFIG.SHOOT_COOLDOWN_MS) return;
          p.lastShot = now;
          fireProjectile(p);
          sendTo(p, { type: 'shootFired' });
        }
      }

      // 6. ВЫХОД В МЕНЮ
      if (d.type === 'leave') {
        if (p.game !== 'menu') gameStates[p.game].players.delete(pid);
        p.game = 'menu';
      }

    } catch (e) { console.error('WS Parse Error:', e); }
  });

  ws.on('close', () => {
    if (pid && players.has(pid)) {
      const p = players.get(pid);
      if (p.game !== 'menu') {
        gameStates[p.game].players.delete(pid);
        if (p.game === 'brainrot' && gameStates.brainrot.artifact.heldBy === pid) {
          gameStates.brainrot.artifact.collected = false;
          gameStates.brainrot.artifact.heldBy = null;
        }
      }
      players.delete(pid);
      broadcast({ type: 'playerLeft', id: pid });
    }
  });

  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
});

// ===== СОСТОЯНИЕ МИРА ДЛЯ КЛИЕНТА =====
function buildWorldState(gameId) {
  const gs = gameStates[gameId];
  if (gameId === 'cheese') {
    return {
      cheeses: gs.cheeses.map(c => ({ id: c.id, x: c.x, z: c.z, taken: c.taken })),
      taken: gs.taken, total: gs.total,
      exit: gs.exit,
      rat: { x: gs.rat.x, z: gs.rat.z, yaw: gs.rat.yaw, stunned: gs.rat.stun > 0 }
    };
  }
  if (gameId === 'brainrot') {
    return { artifact: gs.artifact, base: gs.base, wins: gs.wins };
  }
  if (gameId === 'shooter') {
    return { scores: { red: gs.red, blue: gs.blue } };
  }
  return {};
}

// ===== ИГРОВОЙ ЦИКЛ =====
setInterval(() => {
  const dt = 1 / CONFIG.TICK_RATE;
  const now = Date.now();

  ensureBots();

  // --- движение игроков-людей ---
  players.forEach(p => {
    if (p.ws.readyState !== 1 || p.game === 'menu' || p.escaped || p.health <= 0) return;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    p.x += (p.input.f * fx + p.input.r * rx) * CONFIG.MOVE_SPEED * dt;
    p.z += (p.input.f * fz + p.input.r * rz) * CONFIG.MOVE_SPEED * dt;
    clampToGame(p);
    if (p.input.jump && p.y <= 1.05) { p.vy = CONFIG.JUMP_FORCE; p.input.jump = false; }
    p.vy = (p.vy || 0) - CONFIG.GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y < 1) { p.y = 1; p.vy = 0; }

    if (p.game === 'brainrot') { checkBrainrotPickup(p); checkBrainrotWin(p); }
    if (p.game === 'cheese' && !p.escaped && gameStates.cheese.exit.open &&
        dist2(p.x, p.z, gameStates.cheese.exit.x, gameStates.cheese.exit.z) < 4) {
      p.escaped = true;
      gameStates.cheese.escaped++;
      sendTo(p, { type: 'escaped' });
      broadcast({ type: 'playerEscaped', name: p.name }, null, 'cheese');
      const gs = gameStates.cheese;
      let done = 0; gs.players.forEach(q => { if (q.escaped || q.health <= 0) done++; });
      if (done >= gs.players.size) setTimeout(initCheeseRound, 4000);
    }
    // автоподбор сыра при касании
    if (p.game === 'cheese') {
      const c = nearestCheese(p.x, p.z);
      if (c && dist2(p.x, p.z, c.x, c.z) < 2.2) {
        c.taken = true; gameStates.cheese.taken++;
        sendTo(p, { type: 'cheeseTaken', taken: gameStates.cheese.taken, total: gameStates.cheese.total });
        broadcast({ type: 'worldUpdate', world: buildWorldState('cheese') }, null, 'cheese');
        if (gameStates.cheese.taken >= gameStates.cheese.total && !gameStates.cheese.exit.open) {
          gameStates.cheese.exit.open = true;
          broadcast({ type: 'exitOpened' }, null, 'cheese');
        }
      }
    }
  });

  // --- боты ---
  for (const b of bots) {
    if (b.health <= 0) continue;
    if (now > (b.nextThinkTs || 0)) {
      b.nextThinkTs = now + 300;
      botThink(b, now);
    }
    botMove(b, dt);
    if (b.game === 'brainrot') checkBrainrotWin(b);
  }

  // --- снаряды ---
  updateProjectiles(dt);

  // --- крыса ---
  if (gameStates.cheese.players.size > 0) updateRat(dt, now);

  // --- снимки мира только людям ---
  players.forEach(p => {
    if (p.ws.readyState !== 1 || p.game === 'menu') return;
    const gs = gameStates[p.game];
    const nearby = [];
    gs.players.forEach((other, oid) => {
      if (oid === p.id) return;
      if (dist2(other.x, other.z, p.x, p.z) < 60) {
        nearby.push({
          id: oid, name: other.name, x: +other.x.toFixed(2), y: +other.y.toFixed(2),
          z: +other.z.toFixed(2), yaw: other.yaw, health: other.health,
          team: other.team, isBot: !!other.isBot, escaped: !!other.escaped
        });
      }
    });
    const proj = [];
    for (const pr of projectiles) {
      if (pr.game === p.game && dist2(pr.x, pr.z, p.x, p.z) < 60) {
        proj.push([+pr.x.toFixed(2), +pr.y.toFixed(2), +pr.z.toFixed(2)]);
      }
    }
    sendTo(p, {
      type: 'snapshot',
      me: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), health: p.health, escaped: p.escaped },
      players: nearby,
      projectiles: proj,
      game: p.game,
      world: buildWorldState(p.game),
      scores: p.game === 'shooter' ? { red: gs.red, blue: gs.blue } : null
    });
  });
}, 1000 / CONFIG.TICK_RATE);

// Heartbeat
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 20000);

server.listen(PORT, '0.0.0.0', () => console.log(`✅ SERVER RUNNING :${PORT}`));

process.on('SIGINT', () => { console.log('\n🛑 Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => process.exit(0));

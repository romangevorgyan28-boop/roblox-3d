/**
 * 🧱 ROBLOX 3D ULTIMATE SERVER v2.0
 * Поддержка 4 игр • Авторитарная физика • Оптимизация под 60 игроков
 * Зависимости: npm install express ws
 */

'use strict';

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

// ==========================================
// 1. КОНФИГУРАЦИЯ СЕРВЕРА
// ==========================================
const CONFIG = {
  PORT: process.env.PORT || 3000,
  TICK_RATE: 25,                    // Обновлений в секунду
  MAX_PLAYERS: 60,                  // Максимум игроков на сервер
  GAMES: {
    brookhaven: { name: 'Brookhaven RP', type: 'rp', mapSize: 100 },
    shooter:    { name: 'Team Shooter', type: 'fps', mapSize: 80, teams: ['red', 'blue'] },
    brainrot:   { name: 'Steal a Brainrot', type: 'stealth', mapSize: 60, artifactCount: 1 },
    cheese:     { name: 'Horror of Cheese', type: 'maze', mapSize: 50, cheeseCount: 9, enemy: 'rat' }
  },
  PHYSICS: {
    gravity: 20,
    moveSpeed: 7,
    jumpForce: 9,
    friction: 0.9
  },
  NETWORK: {
    viewRadius: 45,                 // Радиус видимости для оптимизации
    maxPayload: 50 * 1024,          // 50KB максимум на сообщение
    heartbeatInterval: 5000         // Проверка связи каждые 5 секунд
  }
};

// ==========================================
// 2. КЛАССЫ ИГРОКА И ИГРЫ
// ==========================================
class Player {
  constructor(id, ws, name, gameId) {
    this.id = id;
    this.ws = ws;
    this.name = name.substring(0, 20);
    this.gameId = gameId;
    
    // Позиция и движение
    this.x = (Math.random() - 0.5) * 20;
    this.y = 1;
    this.z = (Math.random() - 0.5) * 20;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = Math.random() * Math.PI * 2;
    
    // Состояние
    this.onGround = false;
    this.input = { forward: 0, right: 0, jump: false, action: false };
    this.lastInputTime = Date.now();
    
    // Игровые данные (зависят от режима)
    this.team = null;
    this.health = 100;
    this.score = 0;
    this.inventory = [];
    this.hasArtifact = false;           // Для Steal a Brainrot
    this.cheeseCollected = 0;           // Для Horror of Cheese
    this.isCaught = false;              // Для хоррора
    
    // Сетевые метрики
    this.lastSnapshot = { x: this.x, y: this.y, z: this.z, yaw: this.yaw };
    this.lastPing = Date.now();
    this.latency = 0;
  }

  // Обновление физики (авторитарная)
  update(dt, gameConfig) {
    const speed = CONFIG.PHYSICS.moveSpeed;
    const gravity = CONFIG.PHYSICS.gravity;
    const friction = CONFIG.PHYSICS.friction;

    // Векторы направления
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    // Применяем ввод
    this.vx = (this.input.forward * forwardX + this.input.right * rightX) * speed;
    this.vz = (this.input.forward * forwardZ + this.input.right * rightZ) * speed;

    // Трение
    this.vx *= friction;
    this.vz *= friction;

    // Прыжок
    if (this.input.jump && this.onGround) {
      this.vy = CONFIG.PHYSICS.jumpForce;
      this.onGround = false;
    }

    // Гравитация
    this.vy -= gravity * dt;

    // Применение скорости
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;

    // Коллизия с землёй
    if (this.y <= 1) {
      this.y = 1;
      this.vy = 0;
      this.onGround = true;
    }

    // Границы карты
    const halfMap = gameConfig.mapSize / 2;
    this.x = Math.max(-halfMap, Math.min(halfMap, this.x));
    this.z = Math.max(-halfMap, Math.min(halfMap, this.z));

    // Сброс флага прыжка после обработки
    this.input.jump = false;
  }

  // Получение публичных данных для отправки другим игрокам
  getPublicData() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      z: this.z,
      yaw: this.yaw,
      team: this.team,
      health: this.health,
      hasArtifact: this.hasArtifact,
      cheeseCollected: this.cheeseCollected,
      isCaught: this.isCaught
    };
  }
}

class GameState {
  constructor(gameId, config) {
    this.id = gameId;
    this.config = config;
    this.players = new Map();
    this.objects = new Map();       // Артефакты, сыры и т.д.
    this.enemies = new Map();       // ИИ враги (крыса и т.п.)
    this.state = {};                // Счёт, таймеры и т.д.
    
    this.initializeGame();
  }

  initializeGame() {
    if (this.id === 'brainrot') {
      // Спавним артефакт в центре
      this.objects.set('artifact_1', {
        id: 'artifact_1',
        type: 'brainrot',
        x: 0, y: 1, z: 0,
        collected: false,
        collectedBy: null
      });
    }
    
    if (this.id === 'cheese') {
      // Спавним 9 сыров в случайных позициях лабиринта
      for (let i = 1; i <= 9; i++) {
        this.objects.set(`cheese_${i}`, {
          id: `cheese_${i}`,
          type: 'cheese',
          x: (Math.random() - 0.5) * 40,
          y: 1,
          z: (Math.random() - 0.5) * 40,
          collected: false
        });
      }
      
      // Спавним крысу-врага
      this.enemies.set('rat_1', {
        id: 'rat_1',
        type: 'rat',
        x: 0, y: 1, z: 20,
        speed: 4,
        targetPlayer: null,
        caughtPlayer: null
      });
      
      // Инициализируем состояние
      this.state = { cheesesFound: 0, exitUnlocked: false, timeElapsed: 0 };
    }
    
    if (this.id === 'shooter') {
      this.state = { red: 0, blue: 0, roundTime: 300 };
    }
  }

  addPlayer(player) {
    // Назначаем команду для шутера
    if (this.config.teams && !player.team) {
      const teams = this.config.teams;
      const counts = { red: 0, blue: 0 };
      this.players.forEach(p => { if (p.team) counts[p.team]++; });
      player.team = counts.red <= counts.blue ? 'red' : 'blue';
    }
    
    // Спавн в безопасной точке
    this.respawnPlayer(player);
    this.players.set(player.id, player);
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    
    // Если игрок держал артефакт — возвращаем его
    if (this.id === 'brainrot' && player.hasArtifact) {
      const artifact = this.objects.get('artifact_1');
      if (artifact) {
        artifact.collected = false;
        artifact.collectedBy = null;
        artifact.x = (Math.random() - 0.5) * 40;
        artifact.z = (Math.random() - 0.5) * 40;
      }
    }
    
    this.players.delete(playerId);
  }

  respawnPlayer(player) {
    const halfMap = this.config.mapSize / 2;
    
    if (this.id === 'shooter') {
      // Спавн по командам
      if (player.team === 'red') {
        player.x = -halfMap + 10;
        player.z = (Math.random() - 0.5) * 20;
      } else {
        player.x = halfMap - 10;
        player.z = (Math.random() - 0.5) * 20;
      }
    } else if (this.id === 'cheese') {
      // Спавн у входа в лабиринт
      player.x = 0;
      player.z = -halfMap + 5;
    } else {
      // Случайный спавн
      player.x = (Math.random() - 0.5) * 20;
      player.z = (Math.random() - 0.5) * 20;
    }
    
    player.y = 1;
    player.yaw = Math.random() * Math.PI * 2;
    player.vx = 0; player.vy = 0; player.vz = 0;
    player.health = 100;
    player.isCaught = false;
  }

  // Обновление игровых объектов (артефакты, враги и т.д.)
  updateObjects(dt) {
    if (this.id === 'brainrot') {
      // Артефакт просто существует
    }
    
    if (this.id === 'cheese') {
      // Обновляем крысу
      this.enemies.forEach(rat => {
        // Ищем ближайшего игрока для преследования
        let closestPlayer = null;
        let minDist = 30;
        
        this.players.forEach(player => {
          if (player.isCaught) return;
          const dist = Math.hypot(player.x - rat.x, player.z - rat.z);
          if (dist < minDist) {
            minDist = dist;
            closestPlayer = player;
          }
        });
        
        if (closestPlayer) {
          rat.targetPlayer = closestPlayer.id;
          // Движение к игроку
          const dx = closestPlayer.x - rat.x;
          const dz = closestPlayer.z - rat.z;
          const dist = Math.hypot(dx, dz);
          
          if (dist > 1) {
            rat.x += (dx / dist) * rat.speed * dt;
            rat.z += (dz / dist) * rat.speed * dt;
            rat.yaw = Math.atan2(dx, dz);
          }
          
          // Проверка поимки
          if (dist < 1.5) {
            closestPlayer.isCaught = true;
            closestPlayer.health = 0;
            rat.caughtPlayer = closestPlayer.id;
          }
        }
      });
      
      // Обновляем таймер
      this.state.timeElapsed += dt;
      
      // Проверяем победу
      if (this.state.cheesesFound >= 9 && !this.state.exitUnlocked) {
        this.state.exitUnlocked = true;
      }
    }
  }

  // Проверка взаимодействия с объектами
  checkInteraction(player) {
    if (this.id === 'brainrot' && !player.hasArtifact) {
      const artifact = this.objects.get('artifact_1');
      if (artifact && !artifact.collected) {
        const dist = Math.hypot(player.x - artifact.x, player.z - artifact.z);
        if (dist < 3 && player.input.action) {
          artifact.collected = true;
          artifact.collectedBy = player.id;
          player.hasArtifact = true;
          player.score += 100;
          return { type: 'artifact_collected', id: artifact.id };
        }
      }
    }
    
    if (this.id === 'cheese') {
      // Проверка сбора сыра
      this.objects.forEach(cheese => {
        if (cheese.collected) return;
        const dist = Math.hypot(player.x - cheese.x, player.z - cheese.z);
        if (dist < 2 && player.input.action) {
          cheese.collected = true;
          player.cheeseCollected++;
          player.score += 10;
          this.state.cheesesFound++;
          return { type: 'cheese_collected', id: cheese.id, total: player.cheeseCollected };
        }
      });
      
      // Проверка выхода
      if (this.state.exitUnlocked) {
        const exitX = 0, exitZ = CONFIG.GAMES.cheese.mapSize / 2 - 5;
        const dist = Math.hypot(player.x - exitX, player.z - exitZ);
        if (dist < 3 && player.cheeseCollected >= 9) {
          return { type: 'game_won', score: player.score + Math.floor(1000 - this.state.timeElapsed) };
        }
      }
    }
    
    return null;
  }
}

// ==========================================
// 3. ГЛОБАЛЬНОЕ СОСТОЯНИЕ СЕРВЕРА
// ==========================================
const games = new Map();
const players = new Map();
let nextPlayerId = 1;

// Инициализация игр
for (const [id, config] of Object.entries(CONFIG.GAMES)) {
  games.set(id, new GameState(id, config));
}

// ==========================================
// 4. EXPRESS + WEBSOCKET СЕРВЕР
// ==========================================
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ 
  server, 
  maxPayload: CONFIG.NETWORK.maxPayload,
  perMessageDeflate: false 
});

// Раздача статики (клиент)
app.use(express.static(path.join(__dirname, 'public')));

// Обработка новых подключений
wss.on('connection', (ws, req) => {
  // Проверка макс. игроков
  if (players.size >= CONFIG.MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: 'error', code: 'FULL', msg: 'Сервер заполнен' }));
    ws.close(1013);
    return;
  }

  const playerId = nextPlayerId++;
  let currentPlayer = null;

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      
      // Обработка входа в игру
      if (data.type === 'join' && !currentPlayer) {
        const gameId = data.gameId || 'brookhaven';
        const game = games.get(gameId);
        if (!game) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Игра не найдена' }));
          return;
        }
        
        const name = (data.name || `Player_${playerId}`).substring(0, 20);
        currentPlayer = new Player(playerId, ws, name, gameId);
        players.set(playerId, currentPlayer);
        game.addPlayer(currentPlayer);
        
        // Отправляем инициализацию
        ws.send(JSON.stringify({
          type: 'init',
          playerId: currentPlayer.id,
          gameId: currentPlayer.gameId,
          gameConfig: game.config,
          players: Array.from(game.players.values())
            .filter(p => p.id !== currentPlayer.id)
            .map(p => p.getPublicData()),
          objects: Array.from(game.objects.values()),
          state: game.state
        }));
        
        // Сообщаем другим о новом игроке
        game.players.forEach(p => {
          if (p.id !== currentPlayer.id && p.ws.readyState === 1) {
            p.ws.send(JSON.stringify({
              type: 'player_joined',
              player: currentPlayer.getPublicData()
            }));
          }
        });
        
        console.log(`[+] ${currentPlayer.name} joined ${gameId}. Online: ${players.size}`);
        return;
      }
      
      if (!currentPlayer) return;
      const game = games.get(currentPlayer.gameId);
      if (!game) return;
      
      // Обработка ввода
      if (data.type === 'input') {
        currentPlayer.input = {
          forward: typeof data.forward === 'number' ? Math.max(-1, Math.min(1, data.forward)) : 0,
          right: typeof data.right === 'number' ? Math.max(-1, Math.min(1, data.right)) : 0,
          jump: !!data.jump,
          action: !!data.action
        };
        currentPlayer.yaw = typeof data.yaw === 'number' ? data.yaw : currentPlayer.yaw;
        currentPlayer.lastInputTime = Date.now();
      }
      
      // Обработка взаимодействия
      if (data.type === 'action' && currentPlayer.input.action) {
        const result = game.checkInteraction(currentPlayer);
        if (result) {
          ws.send(JSON.stringify(result));
          // Уведомляем других
          game.players.forEach(p => {
            if (p.id !== currentPlayer.id && p.ws.readyState === 1) {
              p.ws.send(JSON.stringify({ type: 'interaction', ...result, playerId: currentPlayer.id }));
            }
          });
        }
      }
      
      // Чат
      if (data.type === 'chat' && data.msg) {
        const msg = data.msg.substring(0, 150);
        game.players.forEach(p => {
          if (p.ws.readyState === 1) {
            p.ws.send(JSON.stringify({ type: 'chat', name: currentPlayer.name, msg }));
          }
        });
      }
      
    } catch (e) {
      // Игнорируем битые пакеты
    }
  });

  ws.on('pong', () => {
    if (currentPlayer) {
      currentPlayer.latency = Date.now() - currentPlayer.lastPing;
      currentPlayer.lastPing = Date.now();
    }
  });

  ws.on('close', () => {
    if (currentPlayer) {
      const game = games.get(currentPlayer.gameId);
      if (game) {
        game.removePlayer(currentPlayer.id);
        game.players.forEach(p => {
          if (p.ws.readyState === 1) {
            p.ws.send(JSON.stringify({ type: 'player_left', playerId: currentPlayer.id }));
          }
        });
      }
      players.delete(currentPlayer.id);
      console.log(`[-] ${currentPlayer.name} left. Online: ${players.size}`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[!] WS Error: ${err.message}`);
    if (currentPlayer) players.delete(currentPlayer.id);
  });

  // Heartbeat
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) {
      ws.ping();
      if (currentPlayer && Date.now() - currentPlayer.lastPing > CONFIG.NETWORK.heartbeatInterval * 2) {
        console.log(`[!] Timeout: ${currentPlayer.name}`);
        ws.terminate();
      }
    }
  }, CONFIG.NETWORK.heartbeatInterval);
});

// ==========================================
// 5. ИГРОВОЙ ЦИКЛ (ОПТИМИЗИРОВАН)
// ==========================================
let lastTick = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;

  games.forEach(game => {
    try {
      // Обновление физики игроков
      game.players.forEach(player => {
        try {
          player.update(dt, game.config);
        } catch (e) {
          console.error(`[!] Physics error ${player.id}: ${e.message}`);
        }
      });
      
      // Обновление объектов и врагов
      game.updateObjects(dt);
      
      // Рассылка снимков состояния (с оптимизацией)
      game.players.forEach(player => {
        if (player.ws.readyState !== 1) return;
        
        // Только видимые игроки
        const visiblePlayers = [];
        game.players.forEach(other => {
          if (other.id === player.id) return;
          const dist = Math.hypot(player.x - other.x, player.z - other.z);
          if (dist < CONFIG.NETWORK.viewRadius) {
            visiblePlayers.push(other.getPublicData());
          }
        });
        
        // Только видимые объекты
        const visibleObjects = [];
        game.objects.forEach(obj => {
          if (obj.type === 'cheese' && obj.collected) return;
          const dist = Math.hypot(player.x - obj.x, player.z - obj.z);
          if (dist < CONFIG.NETWORK.viewRadius) {
            visibleObjects.push(obj);
          }
        });
        
        // Только видимые враги
        const visibleEnemies = [];
        game.enemies.forEach(enemy => {
          const dist = Math.hypot(player.x - enemy.x, player.z - enemy.z);
          if (dist < CONFIG.NETWORK.viewRadius) {
            visibleEnemies.push(enemy);
          }
        });
        
        // Дельта-синхронизация (отправляем только если изменилось)
        const snap = player.getPublicData();
        const hasChanged = 
          Math.abs(snap.x - player.lastSnapshot.x) > 0.05 ||
          Math.abs(snap.y - player.lastSnapshot.y) > 0.05 ||
          Math.abs(snap.z - player.lastSnapshot.z) > 0.05 ||
          Math.abs(snap.yaw - player.lastSnapshot.yaw) > 0.05;
        
        if (hasChanged || visiblePlayers.length > 0 || visibleObjects.length > 0 || now % 1000 < 40) {
          try {
            player.ws.send(JSON.stringify({
              type: 'snapshot',
              players: visiblePlayers,
              objects: visibleObjects,
              enemies: visibleEnemies,
              state: game.state,
              timestamp: now
            }));
            player.lastSnapshot = { x: snap.x, y: snap.y, z: snap.z, yaw: snap.yaw };
          } catch (e) {
            // Ошибка отправки — игрок отключился
          }
        }
      });
      
    } catch (e) {
      console.error(`[!] Game loop error ${game.id}: ${e.message}`);
    }
  });
}, 1000 / CONFIG.TICK_RATE);

// ==========================================
// 6. ЗАПУСК И ОБРАБОТКА ОШИБОК
// ==========================================
function gracefulShutdown() {
  console.log('🛑 Shutting down gracefully...');
  wss.close();
  server.close(() => {
    console.log('✅ Server stopped');
    process.exit(0);
  });
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err.message, err.stack);
  gracefulShutdown();
});

server.listen(CONFIG.PORT, '0.0.0.0', () => {
  console.log(`🚀 ROBLOX 3D ULTIMATE SERVER v2.0`);
  console.log(`📡 Port: ${CONFIG.PORT}`);
  console.log(`🎮 Games: ${Array.from(games.keys()).join(', ')}`);
  console.log(`👥 Max players: ${CONFIG.MAX_PLAYERS}`);
  console.log(`🌐 URL: https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'}`);
});

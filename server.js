const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 128 * 1024 });
const PORT = process.env.PORT || 3000;

// Статистика игроков
const stats = {
  totalPlayers: 0,
  totalJoins: 0,
  currentDate: new Date().toLocaleDateString()
};

// Загрузка статистики из файла
try {
  if (fs.existsSync('stats.json')) {
    const saved = JSON.parse(fs.readFileSync('stats.json', 'utf8'));
    if (saved.currentDate === stats.currentDate) {
      stats.totalPlayers = saved.totalPlayers || 0;
      stats.totalJoins = saved.totalJoins || 0;
    }
  }
} catch (e) {
  console.log('[STATS] Не удалось загрузить статистику');
}

// Сохранение статистики
function saveStats() {
  try {
    fs.writeFileSync('stats.json', JSON.stringify(stats, null, 2));
  } catch (e) {
    console.log('[STATS] Не удалось сохранить');
  }
}

app.use(express.static(__dirname, { maxAge: '1d' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/stats', (req, res) => res.json(stats));

const CONFIG = {
  TICK_RATE: 20,
  GRAVITY: 18,
  MOVE_SPEED: 8.0,
  JUMP_FORCE: 9.0,
  CELL_SIZE: 5.0,
  GRID_SIZE: 19
};

// Генерация лабиринта с проверками
function generateMaze() {
  console.log('[MAZE] Начинаю генерацию...');
  try {
    const size = CONFIG.GRID_SIZE;
    const maze = Array(size).fill(null).map(() => Array(size).fill(1));
    
    // Безопасная зона спавна 3x3
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        maze[y][x] = 0;
      }
    }
    maze[1][1] = 2; // Точка спавна
    
    const stack = [{ x: 3, y: 3 }];
    maze[3][3] = 0;
    
    const directions = [
      { x: 0, y: -2 },
      { x: 0, y: 2 },
      { x: -2, y: 0 },
      { x: 2, y: 0 }
    ];
    
    let iterations = 0;
    const maxIterations = 1000;
    
    while (stack.length > 0 && iterations < maxIterations) {
      iterations++;
      const current = stack[stack.length - 1];
      const neighbors = [];
      
      for (const dir of directions) {
        const newX = current.x + dir.x;
        const newY = current.y + dir.y;
        
        if (newX > 2 && newX < size - 1 && newY > 2 && newY < size - 1 && maze[newY][newX] === 1) {
          neighbors.push({
            x: newX,
            y: newY,
            dx: dir.x / 2,
            dy: dir.y / 2
          });
        }
      }
      
      if (neighbors.length > 0) {
        const chosen = neighbors[Math.floor(Math.random() * neighbors.length)];
        maze[chosen.y][chosen.x] = 0;
        maze[current.y + chosen.dy][current.x + chosen.dx] = 0;
        stack.push({ x: chosen.x, y: chosen.y });
      } else {
        stack.pop();
      }
    }
    
    // Добавляем дополнительные проходы
    for (let i = 0; i < 15; i++) {
      const randX = 2 + Math.floor(Math.random() * (size - 4));
      const randY = 2 + Math.floor(Math.random() * (size - 4));
      if (maze[randY][randX] === 1) {
        maze[randY][randX] = 0;
      }
    }
    
    // Выход
    maze[size - 2][size - 2] = 4;
    if (maze[size - 2][size - 3] === 1) {
      maze[size - 2][size - 3] = 0;
    }
    
    // Сыр
    let cheesePlaced = 0;
    let attempts = 0;
    while (cheesePlaced < 9 && attempts < 200) {
      const randX = 2 + Math.floor(Math.random() * (size - 4));
      const randY = 2 + Math.floor(Math.random() * (size - 4));
      if (maze[randY][randX] === 0) {
        maze[randY][randX] = 3;
        cheesePlaced++;
      }
      attempts++;
    }
    
    console.log('[MAZE] Генерация завершена. Сыров:', cheesePlaced);
    return maze;
  } catch (error) {
    console.error('[MAZE] Ошибка генерации:', error);
    // Возвращаем простой лабиринт
    const fallback = Array(CONFIG.GRID_SIZE).fill(null).map(() => Array(CONFIG.GRID_SIZE).fill(0));
    fallback[1][1] = 2;
    return fallback;
  }
}

console.log('[INIT] Генерация лабиринта...');
const MAZE_MAP = generateMaze();
const EMPTY_SPOTS = [];

for (let y = 0; y < CONFIG.GRID_SIZE; y++) {
  for (let x = 0; x < CONFIG.GRID_SIZE; x++) {
    if (MAZE_MAP[y][x] === 0 && !(x < 3 && y < 3)) {
      EMPTY_SPOTS.push({
        x: (x - CONFIG.GRID_SIZE / 2) * CONFIG.CELL_SIZE,
        z: (y - CONFIG.GRID_SIZE / 2) * CONFIG.CELL_SIZE
      });
    }
  }
}

const players = new Map();
let nextId = 1;

// Игровое состояние
const gameState = {
  walls: [],
  cheeses: [],
  greenZones: [],
  rat: { x: 0, z: 0, speed: 4.5, yaw: 0, targetX: 0, targetZ: 0, lastMove: 0 },
  exit: { x: 0, z: 0, open: false },
  spawn: { x: 0, z: 0 },
  time: 0,
  editorMode: false,
  editorObjects: []
};

// Генерация стен и объектов
function generateGameObjects() {
  gameState.walls = [];
  gameState.cheeses = [];
  gameState.greenZones = [];
  
  for (let y = 0; y < CONFIG.GRID_SIZE; y++) {
    for (let x = 0; x < CONFIG.GRID_SIZE; x++) {
      const cell = MAZE_MAP[y][x];
      const worldX = (x - CONFIG.GRID_SIZE / 2) * CONFIG.CELL_SIZE;
      const worldZ = (y - CONFIG.GRID_SIZE / 2) * CONFIG.CELL_SIZE;
      
      if (cell === 1) {
        gameState.walls.push({
          x: worldX,
          z: worldZ,
          w: CONFIG.CELL_SIZE,
          d: CONFIG.CELL_SIZE,
          h: 6.0
        });
      } else if (cell === 2) {
        gameState.greenZones.push({ x: worldX, z: worldZ });
        gameState.spawn = { x: worldX, z: worldZ };
      } else if (cell === 3) {
        gameState.cheeses.push({
          id: `cheese_${gameState.cheeses.length}`,
          x: worldX,
          z: worldZ,
          collected: false
        });
      } else if (cell === 4) {
        gameState.exit = { x: worldX, z: worldZ, open: false };
      }
    }
  }
  
  // Спавн крысы
  if (EMPTY_SPOTS.length > 0) {
    const spot = EMPTY_SPOTS[Math.floor(Math.random() * EMPTY_SPOTS.length)];
    gameState.rat.x = spot.x;
    gameState.rat.z = spot.z;
  }
}

generateGameObjects();

class Player {
  constructor(id, ws, name) {
    this.id = id;
    this.ws = ws;
    this.name = name.substring(0, 16);
    this.gameId = 'menu';
    this.x = 0;
    this.y = 1;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yaw = 0;
    this.onGround = false;
    this.input = { f: 0, r: 0, jump: false, action: false };
    this.health = 100;
    this.inventory = { cheese: 0 };
    this.isDead = false;
    this.editorMode = false;
    this.editorObjects = [];
  }
  
  reset(gameId) {
    this.gameId = gameId;
    this.x = gameState.spawn.x + (Math.random() - 0.5) * 2;
    this.z = gameState.spawn.z + (Math.random() - 0.5) * 2;
    this.y = 1;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.health = 100;
    this.inventory.cheese = 0;
    this.isDead = false;
    
    // Спавн крысы подальше
    if (EMPTY_SPOTS.length > 0) {
      const spot = EMPTY_SPOTS[Math.floor(Math.random() * EMPTY_SPOTS.length)];
      gameState.rat.x = spot.x;
      gameState.rat.z = spot.z;
    }
  }
  
  getPublic() {
    return {
      id: this.id,
      name: this.name,
      x: this.x,
      y: this.y,
      z: this.z,
      yaw: this.yaw,
      health: this.health,
      gameId: this.gameId,
      anim: (Math.abs(this.input.f) > 0.1 || Math.abs(this.input.r) > 0.1) ? 1 : 0,
      isDead: this.isDead,
      editorMode: this.editorMode
    };
  }
}

wss.on('connection', (ws) => {
  console.log('[WS] Новое подключение');
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);
  
  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      
      if (!data.playerId && data.type === 'register') {
        const id = nextId++;
        const player = new Player(id, ws, data.name || `Player_${id}`);
        players.set(id, player);
        
        // Обновление статистики
        stats.totalPlayers++;
        stats.totalJoins++;
        saveStats();
        
        ws.send(JSON.stringify({
          type: 'registered',
          id: id,
          name: player.name,
          stats: stats
        }));
        
        console.log(`[GAME] Игрок ${player.name} (${id}) подключился. Всего: ${stats.totalPlayers}`);
        return;
      }
      
      const player = players.get(data.playerId);
      if (!player) return;
      
      if (data.type === 'input') {
        player.input = {
          f: Math.max(-1, Math.min(1, data.f || 0)),
          r: Math.max(-1, Math.min(1, data.r || 0)),
          jump: !!data.jump,
          action: !!data.action
        };
        if (typeof data.yaw === 'number') {
          player.yaw = data.yaw;
        }
      }
      
      if (data.type === 'joinGame' && ['brookhaven', 'shooter', 'brainrot', 'cheese', 'editor'].includes(data.gameId)) {
        player.reset(data.gameId);
        
        const existingPlayers = Array.from(players.values())
          .filter(p => p.id !== player.id && p.gameId === data.gameId)
          .map(p => p.getPublic());
        
        ws.send(JSON.stringify({
          type: 'existingPlayers',
          players: existingPlayers,
          stats: stats
        }));
        
        if (data.gameId === 'cheese' || data.gameId === 'editor') {
          ws.send(JSON.stringify({
            type: 'mapData',
            walls: gameState.walls,
            cheeses: gameState.cheeses,
            spawn: gameState.spawn,
            greenZones: gameState.greenZones,
            exit: gameState.exit,
            editorObjects: gameState.editorObjects
          }));
        }
        
        broadcast({
          type: 'playerJoined',
          player: player.getPublic()
        }, player.id, data.gameId);
        
        console.log(`[GAME] ${player.name} вошел в ${data.gameId}`);
      }
      
      if (data.type === 'respawn') {
        player.reset('cheese');
        broadcast({
          type: 'playerJoined',
          player: player.getPublic()
        }, null, 'cheese');
      }
      
      if (data.type === 'editorAction' && player.editorMode) {
        // Обработка действий редактора
        if (data.action === 'addWall') {
          gameState.editorObjects.push({
            type: 'wall',
            x: data.x,
            z: data.z,
            w: 5,
            h: 6,
            d: 5
          });
          broadcast({
            type: 'editorUpdate',
            action: 'addWall',
            object: gameState.editorObjects[gameState.editorObjects.length - 1]
          }, null, 'editor');
        } else if (data.action === 'removeWall') {
          const index = gameState.editorObjects.findIndex(obj => 
            Math.abs(obj.x - data.x) < 3 && Math.abs(obj.z - data.z) < 3
          );
          if (index !== -1) {
            const removed = gameState.editorObjects.splice(index, 1)[0];
            broadcast({
              type: 'editorUpdate',
              action: 'removeWall',
              index: index
            }, null, 'editor');
          }
        }
      }
      
      if (data.type === 'chat' && data.msg) {
        broadcast({
          type: 'chat',
          name: player.name,
          msg: data.msg.substring(0, 120)
        }, null, player.gameId);
      }
      
    } catch (error) {
      console.error('[MSG] Ошибка обработки:', error);
    }
  });
  
  ws.on('close', () => {
    for (const [id, pl] of players) {
      if (pl.ws === ws) {
        players.delete(id);
        broadcast({
          type: 'playerLeft',
          playerId: id,
          gameId: pl.gameId
        }, null, pl.gameId);
        console.log(`[GAME] Игрок ${pl.name} отключился`);
        break;
      }
    }
  });
  
  ws.on('error', (err) => {
    console.error('[WS] Ошибка сокета:', err);
  });
});

function broadcast(data, excludeId = null, targetGameId = null) {
  const msg = JSON.stringify(data);
  players.forEach((player) => {
    if (player.id !== excludeId && 
        player.ws.readyState === 1 && 
        (!targetGameId || player.gameId === targetGameId)) {
      try {
        player.ws.send(msg);
      } catch (e) {
        // Игнорируем ошибки отправки
      }
    }
  });
}

function canMove(x, z) {
  const gridX = Math.floor((x / CONFIG.CELL_SIZE) + CONFIG.GRID_SIZE / 2);
  const gridZ = Math.floor((z / CONFIG.CELL_SIZE) + CONFIG.GRID_SIZE / 2);
  
  if (gridX < 0 || gridX >= CONFIG.GRID_SIZE || gridZ < 0 || gridZ >= CONFIG.GRID_SIZE) {
    return false;
  }
  
  // Проверка стен
  if (MAZE_MAP[gridZ][gridX] === 1) {
    return false;
  }
  
  // Проверка объектов редактора
  for (const obj of gameState.editorObjects) {
    if (obj.type === 'wall') {
      const objLeft = obj.x - obj.w / 2;
      const objRight = obj.x + obj.w / 2;
      const objFront = obj.z - obj.d / 2;
      const objBack = obj.z + obj.d / 2;
      
      if (x > objLeft && x < objRight && z > objFront && z < objBack) {
        return false;
      }
    }
  }
  
  return true;
}

// Игровой цикл
setInterval(() => {
  if (players.size === 0) return;
  
  const dt = 1 / CONFIG.TICK_RATE;
  
  players.forEach((player) => {
    if (player.ws.readyState !== 1 || player.gameId === 'menu' || player.isDead) {
      return;
    }
    
    // Движение игрока
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);
    
    player.vx = (player.input.f * forwardX + player.input.r * rightX) * CONFIG.MOVE_SPEED;
    player.vz = (player.input.f * forwardZ + player.input.r * rightZ) * CONFIG.MOVE_SPEED;
    
    if (player.input.jump && player.onGround) {
      player.vy = CONFIG.JUMP_FORCE;
      player.onGround = false;
    }
    
    player.vy -= CONFIG.GRAVITY * dt;
    
    let newX = player.x + player.vx * dt;
    let newZ = player.z + player.vz * dt;
    let newY = player.y + player.vy * dt;
    
    if (newY <= 1) {
      newY = 1;
      player.vy = 0;
      player.onGround = true;
    }
    
    // Коллизии
    if (player.gameId === 'cheese' || player.gameId === 'editor') {
      if (!canMove(newX, player.z)) {
        newX = player.x;
      }
      if (!canMove(player.x, newZ)) {
        newZ = player.z;
      }
    }
    
    player.x = newX;
    player.z = newZ;
    player.y = newY;
    
    // Логика игры "Сыр"
    if (player.gameId === 'cheese') {
      const rat = gameState.rat;
      const now = Date.now();
      
      // ИИ крысы - всегда идет к ближайшему игроку
      let nearestPlayer = null;
      let minDistance = 999;
      
      players.forEach((other) => {
        if (other.gameId === 'cheese' && !other.isDead) {
          const dist = Math.hypot(other.x - rat.x, other.z - rat.z);
          if (dist < minDistance) {
            minDistance = dist;
            nearestPlayer = other;
          }
        }
      });
      
      if (nearestPlayer) {
        rat.targetX = nearestPlayer.x;
        rat.targetZ = nearestPlayer.z;
      }
      
      // Движение крысы
      const dx = rat.targetX - rat.x;
      const dz = rat.targetZ - rat.z;
      const distance = Math.hypot(dx, dz);
      
      if (distance > 0.5 && now - rat.lastMove > 50) {
        const moveX = (dx / distance) * rat.speed * dt;
        const moveZ = (dz / distance) * rat.speed * dt;
        const newX = rat.x + moveX;
        const newZ = rat.z + moveZ;
        
        if (canMove(newX, newZ)) {
          rat.x = newX;
          rat.z = newZ;
          rat.yaw = Math.atan2(dx, dz);
          rat.lastMove = now;
        }
      }
      
      // Урон от крысы
      if (minDistance < 2.0) {
        player.health -= 100 * dt;
        if (player.health <= 0 && !player.isDead) {
          player.isDead = true;
          player.health = 0;
          
          player.ws.send(JSON.stringify({
            type: 'playerDied',
            x: player.x,
            y: player.y,
            z: player.z,
            name: player.name,
            playerId: player.id
          }));
          
          broadcast({
            type: 'playerDied',
            x: player.x,
            y: player.y,
            z: player.z,
            name: player.name,
            playerId: player.id
          }, null, 'cheese');
        }
      }
      
      // Сбор сыра
      gameState.cheeses.forEach((cheese) => {
        if (!cheese.collected && player.input.action) {
          const dist = Math.hypot(player.x - cheese.x, player.z - cheese.z);
          if (dist < 5.0) {
            cheese.collected = true;
            player.inventory.cheese++;
            
            player.ws.send(JSON.stringify({
              type: 'collectCheese',
              total: player.inventory.cheese
            }));
            
            if (player.inventory.cheese >= 9) {
              gameState.exit.open = true;
            }
          }
        }
      });
      
      // Выход
      if (gameState.exit.open) {
        const dist = Math.hypot(player.x - gameState.exit.x, player.z - gameState.exit.z);
        if (dist < 5.0) {
          player.ws.send(JSON.stringify({
            type: 'win',
            score: Math.floor(1000 - gameState.time)
          }));
        }
      }
    }
    
    // Отправка состояния
    player.ws.send(JSON.stringify({
      type: 'snapshot',
      players: Array.from(players.values())
        .filter(p => p.id !== player.id && p.gameId === player.gameId)
        .map(p => p.getPublic()),
      rat: player.gameId === 'cheese' ? gameState.rat : null,
      exit: player.gameId === 'cheese' ? gameState.exit : null,
      editorObjects: player.editorMode ? gameState.editorObjects : null
    }));
  });
  
  if (gameState) {
    gameState.time += dt;
  }
}, 1000 / CONFIG.TICK_RATE);

// Heartbeat
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

// Обработка ошибок
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Неуловимая ошибка:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[REJECTION] Ошибка промиса:', err);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ СЕРВЕР ЗАПУЩЕН :${PORT}`);
  console.log(`📊 Всего игроков: ${stats.totalPlayers}`);
  console.log(`🎮 Онлайн: ${players.size}`);
});

process.on('SIGINT', () => {
  saveStats();
  console.log('[SHUTDOWN] Сервер остановлен');
  process.exit(0);
});

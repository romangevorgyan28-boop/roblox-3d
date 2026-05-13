/**
 * 🧱 ROBLOX 3D ULTIMATE SERVER
 * Версия: 4.0.0 (Production Ready)
 * Архитектура: Авторитарная, State-Driven, WebSocket + HTTP
 * Функции: Управление комнатами, Авторитарные попадания, Пинг-трекинг,
 *          Очистка соединений, Детальное логирование, Инструкции по фаерволу
 */

'use strict';

// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================
const CONFIG = {
  PORT: 3000,
  BIND_ADDRESS: '0.0.0.0', // Важно: слушать все интерфейсы для внешнего доступа
  TICK_RATE: 60,
  MAX_PLAYERS_PER_ROOM: 30,
  HEARTBEAT_INTERVAL: 3000,
  HEARTBEAT_TIMEOUT: 10000,
  CLEANUP_INTERVAL: 30000,
  ROOMS: {
    brookhaven: { name: 'Brookhaven RP', max: 40, type: 'rp' },
    obby:       { name: 'Mega Obby',       max: 20, type: 'obby' },
    shooter:    { name: 'Team Shooter',    max: 20, type: 'fps', score: { red: 0, blue: 0 } },
    sandbox:    { name: 'Sandbox',         max: 25, type: 'build' }
  }
};

// ==========================================
// 2. STATE MANAGEMENT
// ==========================================
class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.connections = new Map(); // ws -> playerData
    this.pingTimers = new Map();
    this.initializeDefaultRooms();
  }

  initializeDefaultRooms() {
    for (const [key, config] of Object.entries(CONFIG.ROOMS)) {
      this.rooms.set(key, {
        id: key,
        config: config,
        players: new Map(),
        state: config.type === 'fps' ? { red: 0, blue: 0 } : {}
      });
    }
  }

  getPlayer(ws) {
    return this.connections.get(ws) || null;
  }

  setPlayer(ws, data) {
    this.connections.set(ws, data);
  }

  removePlayer(ws) {
    const player = this.connections.get(ws);
    if (player && player.roomId) {
      const room = this.rooms.get(player.roomId);
      if (room) {
        room.players.delete(player.id);
        this.broadcastToRoom(player.roomId, { type: 'p_leave', id: player.id }, ws);
        if (room.config.type === 'fps') {
          this.broadcastToRoom(player.roomId, { type: 'score', score: room.state });
        }
      }
    }
    this.connections.delete(ws);
    if (this.pingTimers.has(ws)) {
      clearInterval(this.pingTimers.get(ws));
      this.pingTimers.delete(ws);
    }
  }

  joinRoom(ws, roomId, team) {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };
    if (room.players.size >= room.config.max) return { success: false, error: 'Room is full' };

    // Leave previous room if any
    const existing = this.getPlayer(ws);
    if (existing && existing.roomId) {
      const prevRoom = this.rooms.get(existing.roomId);
      if (prevRoom) prevRoom.players.delete(existing.id);
    }

    const player = {
      ws: ws,
      id: 'p_' + Math.random().toString(36).substr(2, 9),
      name: 'Player',
      roomId: roomId,
      team: team || 'none',
      position: { x: 0, y: 1, z: 0 },
      rotation: 0,
      health: 100,
      isAlive: true,
      lastPing: Date.now()
    };

    // Spawn position logic
    if (room.config.type === 'fps') {
      player.position = team === 'red' ? { x: -18, y: 1, z: 0 } : { x: 18, y: 1, z: 0 };
      player.rotation = team === 'red' ? 0 : Math.PI;
    } else {
      player.position = { x: (Math.random() - 0.5) * 16, y: 1, z: (Math.random() - 0.5) * 16 };
      player.rotation = Math.random() * Math.PI * 2;
    }

    this.setPlayer(ws, player);
    room.players.set(player.id, player);

    return { success: true, player, room };
  }

  broadcastToRoom(roomId, data, excludeWs = null) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.players.forEach((player) => {
      if (player.ws !== excludeWs && player.ws.readyState === 1) {
        try { player.ws.send(JSON.stringify(data)); } catch (e) { /* ignore send errors */ }
      }
    });
  }

  broadcastAll(data) {
    this.connections.forEach((player) => {
      if (player.ws.readyState === 1) {
        try { player.ws.send(JSON.stringify(data)); } catch (e) { /* ignore */ }
      }
    });
  }

  updateRoomCounts() {
    const counts = [];
    this.rooms.forEach((room, id) => {
      counts.push({ type: id, players: room.players.size });
    });
    this.broadcastAll({ type: 'rooms', list: counts });
  }

  checkHeartbeats() {
    const now = Date.now();
    this.connections.forEach((player, ws) => {
      if (now - player.lastPing > CONFIG.HEARTBEAT_TIMEOUT) {
        console.log(`[NET] Timeout: ${player.name} (${player.id})`);
        ws.close(4001, 'Ping timeout');
      }
    });
  }

  handleCombat(shooterWs, direction, origin) {
    const shooter = this.getPlayer(shooterWs);
    if (!shooter || shooter.roomId !== 'shooter' || !shooter.isAlive) return null;

    const room = this.rooms.get('shooter');
    let closestTarget = null;
    let minDist = 60;

    room.players.forEach((target) => {
      if (target.ws === shooterWs || target.team === shooter.team || !target.isAlive) return;

      const dx = target.position.x - origin.x;
      const dy = (target.position.y + 1.5) - origin.y;
      const dz = target.position.z - origin.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < minDist) {
        const toTargetX = dx / dist, toTargetY = dy / dist, toTargetZ = dz / dist;
        const dot = direction.x * toTargetX + direction.y * toTargetY + direction.z * toTargetZ;
        if (dot > 0.92) {
          minDist = dist;
          closestTarget = target;
        }
      }
    });

    if (closestTarget) {
      const damage = 25;
      closestTarget.health -= damage;
      
      // Notify target
      if (closestTarget.ws.readyState === 1) {
        closestTarget.ws.send(JSON.stringify({
          type: 'p_hit',
          hp: Math.max(0, closestTarget.health),
          dead: closestTarget.health <= 0
        }));
      }

      this.broadcastToRoom('shooter', { type: 'p_hit_fx', id: closestTarget.id });

      if (closestTarget.health <= 0) {
        closestTarget.isAlive = false;
        room.state[shooter.team === 'red' ? 'red' : 'blue']++;
        this.broadcastToRoom('shooter', {
          type: 'kill',
          kn: shooter.name,
          vn: closestTarget.name,
          score: room.state
        });

        // Respawn after 3 seconds
        setTimeout(() => {
          if (closestTarget.roomId === 'shooter') {
            const spawnPos = closestTarget.team === 'red' ? { x: -18, y: 1, z: 0 } : { x: 18, y: 1, z: 0 };
            const spawnRot = closestTarget.team === 'red' ? 0 : Math.PI;
            closestTarget.position = spawnPos;
            closestTarget.rotation = spawnRot;
            closestTarget.health = 100;
            closestTarget.isAlive = true;
            
            if (closestTarget.ws.readyState === 1) {
              closestTarget.ws.send(JSON.stringify({
                type: 'respawned',
                x: spawnPos.x, y: spawnPos.y, z: spawnPos.z,
                ry: spawnRot, hp: 100
              }));
              this.broadcastToRoom('shooter', {
                type: 'p_move',
                id: closestTarget.id,
                x: spawnPos.x, y: spawnPos.y, z: spawnPos.z,
                ry: spawnRot
              });
            }
          }
        }, 3000);
      }
      return closestTarget;
    }
    return null;
  }

  cleanupInactive() {
    const now = Date.now();
    this.connections.forEach((player, ws) => {
      if (now - player.lastAction > 300000) { // 5 minutes inactive
        console.log(`[SYS] Kicking inactive: ${player.name}`);
        ws.close(4002, 'Inactivity');
      }
    });
  }
}

// ==========================================
// 3. SERVER INITIALIZATION
// ==========================================
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const roomManager = new RoomManager();

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile('index.html', (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Server Error: index.html not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const wss = new WebSocketServer({ 
  server, 
  maxPayload: 2 * 1024 * 1024, 
  perMessageDeflate: true 
});

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || 'unknown';
  console.log(`[NET] New connection from ${ip}`);
  
  // Heartbeat ping interval
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) {
      ws.ping();
    }
  }, CONFIG.HEARTBEAT_INTERVAL);
  roomManager.pingTimers.set(ws, pingInterval);

  ws.on('pong', () => {
    const player = roomManager.getPlayer(ws);
    if (player) player.lastPing = Date.now();
  });

  ws.on('message', (raw) => {
    const player = roomManager.getPlayer(ws);
    if (!player) return;
    player.lastAction = Date.now();

    try {
      const data = JSON.parse(raw);
      
      switch (data.type) {
        case 'set_name':
          player.name = (data.name || 'Player').trim().substring(0, 20);
          break;

        case 'join':
          const joinResult = roomManager.joinRoom(ws, data.room, data.team);
          if (joinResult.success) {
            const { player: p, room } = joinResult;
            const playersList = Array.from(room.players.values()).map(pl => ({
              id: pl.id, name: pl.name, team: pl.team,
              x: pl.position.x, y: pl.position.y, z: pl.position.z,
              ry: pl.rotation, hp: pl.health, alive: pl.isAlive
            }));

            ws.send(JSON.stringify({
              type: 'joined',
              room: { id: room.id, name: room.config.name, team: p.team, state: room.state },
              players: playersList
            }));

            roomManager.broadcastToRoom(room.id, {
              type: 'p_join', id: p.id, name: p.name, team: p.team,
              x: p.position.x, y: p.position.y, z: p.position.z, ry: p.rotation
            }, ws);

            roomManager.updateRoomCounts();
          } else {
            ws.send(JSON.stringify({ type: 'error', msg: joinResult.error }));
          }
          break;

        case 'move':
          if (player.roomId && player.isAlive) {
            player.position.x = data.x;
            player.position.y = data.y;
            player.position.z = data.z;
            player.rotation = data.ry;
            roomManager.broadcastToRoom(player.roomId, {
              type: 'p_move', id: player.id,
              x: player.position.x, y: player.position.y, z: player.position.z,
              ry: player.rotation
            }, ws);
          }
          break;

        case 'shoot':
          if (player.roomId === 'shooter') {
            roomManager.handleCombat(ws, data.dir, data.orig);
          }
          break;

        case 'chat':
          if (player.roomId) {
            const msg = (data.msg || '').trim().substring(0, 200);
            if (msg) {
              roomManager.broadcastToRoom(player.roomId, { type: 'chat', name: player.name, msg });
            }
          }
          break;

        case 'respawn_req':
          // Handled server-side in combat system, but client can request
          if (player.roomId === 'shooter' && !player.isAlive) {
            // Already handled, but fallback:
            player.isAlive = true;
            player.health = 100;
          }
          break;
      }
    } catch (err) {
      console.warn('[NET] Parse error:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[NET] Connection closed');
    roomManager.removePlayer(ws);
    roomManager.updateRoomCounts();
  });

  ws.on('error', (err) => {
    console.error('[NET] WS Error:', err.message);
    roomManager.removePlayer(ws);
  });

  // Send initial room list
  roomManager.updateRoomCounts();
});

// ==========================================
// 4. PERIODIC TASKS
// ==========================================
setInterval(() => roomManager.checkHeartbeats(), 5000);
setInterval(() => roomManager.cleanupInactive(), 60000);

// ==========================================
// 5. START SERVER
// ==========================================
server.listen(CONFIG.PORT, CONFIG.BIND_ADDRESS, () => {
  console.log('✅ СЕРВЕР ЗАПУЩЕН УСПЕШНО');
  console.log(`📂 Локально: http://localhost:${CONFIG.PORT}`);
  console.log(`🌐 Сеть/Телефон: http://<ВАШ_IP>:${CONFIG.PORT}`);
  console.log('⚠️  ВАЖНО: Если ERR_CONNECTION_TIMED_OUT, откройте порт в Windows:');
  console.log(`   netsh advfirewall firewall add rule name="Roblox3D" dir=in action=allow protocol=TCP localport=${CONFIG.PORT}`);
  console.log('📊 Статус комнат обновлён. Ожидание подключений...');
});

process.on('SIGINT', () => {
  console.log('\n🛑 Завершение работы сервера...');
  wss.clients.forEach(ws => ws.close());
  server.close(() => {
    console.log('✅ Сервер остановлен');
    process.exit(0);
  });
});
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ 
  server, 
  maxPayload: 32 * 1024,
  perMessageDeflate: false 
});

const PORT = process.env.PORT || 3000;

// Раздаем статику из корневой папки
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const players = new Map();
let nextId = 1;

wss.on('connection', (ws, req) => {
  const id = nextId++;
  const player = {
    id: id,
    ws: ws,
    x: (Math.random() - 0.5) * 40,
    y: 1,
    z: (Math.random() - 0.5) * 40,
    yaw: Math.random() * Math.PI * 2,
    input: { f: 0, r: 0, jump: false }
  };
  
  players.set(id, player);
  console.log(`[+] Player ${id} connected. Total: ${players.size}`);

  // Отправляем игроку его ID и список других
  const otherPlayers = [];
  players.forEach((p, pid) => {
    if (pid !== id) {
      otherPlayers.push({
        id: p.id,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw
      });
    }
  });

  ws.send(JSON.stringify({
    type: 'init',
    playerId: id,
    players: otherPlayers
  }));

  // Сообщаем остальным о новом игроке
  players.forEach((p, pid) => {
    if (pid !== id && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({
        type: 'playerJoined',
        player: {
          id: player.id,
          x: player.x,
          y: player.y,
          z: player.z,
          yaw: player.yaw
        }
      }));
    }
  });

  // Обработка сообщений
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'move') {
        player.x = data.x;
        player.y = data.y;
        player.z = data.z;
        player.yaw = data.yaw;
      }
    } catch (e) {
      // Игнорируем битые пакеты
    }
  });

  // Отключение
  ws.on('close', () => {
    players.delete(id);
    console.log(`[-] Player ${id} disconnected. Total: ${players.size}`);
    
    // Сообщаем всем
    players.forEach((p) => {
      if (p.ws.readyState === 1) {
        p.ws.send(JSON.stringify({
          type: 'playerLeft',
          playerId: id
        }));
      }
    });
  });

  ws.on('error', (err) => {
    console.error(`[!] Player ${id} error:`, err.message);
    players.delete(id);
  });
});

// Игровой цикл (20 тиков в секунду - достаточно для стабильности)
setInterval(() => {
  const snapshot = {
    type: 'snapshot',
    players: []
  };
  
  players.forEach((p) => {
    if (p.ws.readyState !== 1) return;
    
    // Простая физика
    const speed = 0.12;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    
    p.x += (p.input.f * fx + p.input.r * rx) * speed;
    p.z += (p.input.f * fz + p.input.r * rz) * speed;
    
    // Границы мира
    p.x = Math.max(-50, Math.min(50, p.x));
    p.z = Math.max(-50, Math.min(50, p.z));
    
    // Добавляем в снимок
    snapshot.players.push({
      id: p.id,
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.yaw
    });
  });
  
  // Отправляем всем
  const msg = JSON.stringify(snapshot);
  players.forEach((p) => {
    if (p.ws.readyState === 1) {
      try {
        p.ws.send(msg);
      } catch(e) {}
    }
  });
}, 1000 / 20);

// Heartbeat (проверка живых соединений)
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ SERVER RUNNING on port ${PORT}`);
  console.log(`💾 Optimized for 512MB RAM`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  process.exit(0);
});

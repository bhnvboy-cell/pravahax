const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const users = new Map();

wss.on('connection', (ws) => {
  let userId = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case 'join':
          userId = msg.userId;
          users.set(userId, { ws, username: msg.username });
          console.log(`${msg.username} joined (${userId})`);
          broadcast({ type: 'user-list', users: Array.from(users.entries()).map(([id, u]) => ({ id, username: u.username })) });
          break;

        case 'chat':
          const chatSender = users.get(msg.from);
          broadcast({ type: 'chat', from: msg.from, username: chatSender?.username, message: msg.message, timestamp: Date.now() });
          break;

        case 'call-request':
        case 'call-accept':
        case 'call-reject':
        case 'call-end':
        case 'offer':
        case 'answer':
        case 'ice-candidate':
          const target = users.get(msg.to);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({ ...msg, from: userId, username: users.get(userId)?.username }));
          }
          break;
      }
    } catch (e) {
      console.error('Message parse error:', e);
    }
  });

  ws.on('close', () => {
    if (userId) {
      const user = users.get(userId);
      console.log(`${user?.username || userId} disconnected`);
      users.delete(userId);
      broadcast({ type: 'user-list', users: Array.from(users.entries()).map(([id, u]) => ({ id, username: u.username })) });
    }
  });
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const interfaces = os.networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) localIP = iface.address;
    }
  }
  console.log(`PravahaX running at:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}`);
});

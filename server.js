const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);

const wss = new WebSocket.Server({ noServer: true });
const users = new Map();

function handleMessage(ws, data) {
  let userId = ws._userId;
  try {
    const msg = JSON.parse(data);

    switch (msg.type) {
      case 'join':
        userId = msg.userId;
        ws._userId = userId;
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
}

function handleConnection(ws) {
  ws.on('message', (data) => handleMessage(ws, data));
  ws.on('close', () => {
    if (ws._userId) {
      const user = users.get(ws._userId);
      console.log(`${user?.username || ws._userId} disconnected`);
      users.delete(ws._userId);
      broadcast({ type: 'user-list', users: Array.from(users.entries()).map(([id, u]) => ({ id, username: u.username })) });
    }
  });
}

wss.on('connection', handleConnection);

const interfaces = os.networkInterfaces();
let localIP = 'localhost';
for (const name of Object.keys(interfaces)) {
  for (const iface of interfaces[name]) {
    if (iface.family === 'IPv4' && !iface.internal) localIP = iface.address;
  }
}

if (hasCerts) {
  const httpsServer = https.createServer({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath)
  }, app);
  httpsServer.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
  httpsServer.listen(3001, '0.0.0.0', () => {
    console.log(`PravahaX running at:`);
    console.log(`  Network: https://${localIP}:3001`);
    console.log(`  (Accept the security warning on your phone)`);
  });
}

const httpServer = http.createServer(app);
httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
httpServer.listen(3000, '0.0.0.0', () => {
  if (!hasCerts) {
    console.log(`PravahaX running at:`);
    console.log(`  Local:   http://localhost:3000`);
    console.log(`  Network: http://${localIP}:3000`);
  } else {
    console.log(`  HTTP:    http://${localIP}:3000 (redirects to HTTPS)`);
  }
});

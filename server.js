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

function handleConnection(ws) {
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      switch (msg.type) {
        case 'join':
          ws._userId = msg.userId;
          users.set(msg.userId, { ws, username: msg.username });
          console.log(`${msg.username} joined (${msg.userId})`);
          broadcast({ type: 'user-list', users: Array.from(users.entries()).map(([id, u]) => ({ id, username: u.username })) });
          break;
        case 'chat':
          const s = users.get(msg.from);
          broadcast({ type: 'chat', from: msg.from, username: s?.username, message: msg.message, timestamp: Date.now() });
          break;
        case 'call-request':
        case 'call-accept':
        case 'call-reject':
        case 'call-end':
        case 'offer':
        case 'answer':
        case 'ice-candidate':
          const t = users.get(msg.to);
          if (t && t.ws.readyState === WebSocket.OPEN) {
            t.ws.send(JSON.stringify({ ...msg, from: ws._userId, username: users.get(ws._userId)?.username }));
          }
          break;
      }
    } catch (e) {
      console.error('Message parse error:', e);
    }
  });

  ws.on('close', () => {
    if (ws._userId) {
      const u = users.get(ws._userId);
      console.log(`${u?.username || ws._userId} disconnected`);
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
  httpsServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  httpsServer.listen(3001, '0.0.0.0', () => {
    console.log(`  HTTPS:   https://${localIP}:3001`);
  });
}

const httpServer = http.createServer(app);
httpServer.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
httpServer.listen(3000, '0.0.0.0', () => {
  console.log(`PravahaX running at:`);
  console.log(`  HTTP:    http://${localIP}:3000`);
  if (hasCerts) console.log(`  HTTPS:   https://${localIP}:3001`);
  console.log(`  (Use HTTPS on mobile for camera/mic)`);
});

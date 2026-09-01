const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const config = require('./src/config');
const { setupSecurity } = require('./src/middleware/security');
const { setupWebSocket, setWss, getOnlineUsers, kickUser } = require('./src/services/websocket');
const { healthCheck } = require('./src/routes/health');
const authRoutes = require('./src/routes/auth');
const adminRoutes = require('./src/routes/admin');
const auditLog = require('./src/models/AuditLog');
const userModel = require('./src/models/User');
const logger = require('./src/utils/logger');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

setWss(wss);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
setupSecurity(app);

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.get('/api/health', healthCheck(wss));

app.get('/api/online', (req, res) => {
  res.json({ users: getOnlineUsers() });
});

app.post('/api/admin/kick', (req, res) => {
  const { userId, adminToken } = req.body;
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(adminToken, config.jwtSecret);
    const admin = userModel.findById(decoded.id);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const kicked = kickUser(userId, admin.username);
    if (kicked) {
      auditLog.log('user_kicked', admin.id, { targetId: userId, ip: req.ip });
      res.json({ message: 'User kicked' });
    } else {
      res.status(404).json({ error: 'User not online' });
    }
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

setupWebSocket(wss);

function gracefulShutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully...`);
  wss.clients.forEach((client) => {
    client.send(JSON.stringify({ type: 'server-shutdown', message: 'Server restarting...' }));
    client.close();
  });
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', { reason: String(reason) });
});

const PORT = config.port;
server.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) localIP = iface.address;
    }
  }

  logger.info('PravahaX Enterprise started');
  logger.info(`  Local:   http://localhost:${PORT}`);
  logger.info(`  Network: http://${localIP}:${PORT}`);
  logger.info(`  Health:  http://localhost:${PORT}/api/health`);
  logger.info(`  Admin:   ${config.admin.defaultUsername} / ${config.admin.defaultPassword}`);
});

const logger = require('../utils/logger');

function healthCheck(wss) {
  return (req, res) => {
    const uptime = process.uptime();
    const mem = process.memoryUsage();
    const wsClients = wss ? wss.clients.size : 0;

    res.json({
      status: 'ok',
      version: require('../../package.json').version,
      uptime: Math.floor(uptime),
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
        heap: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
      },
      websocket: {
        connections: wsClients,
      },
      timestamp: new Date().toISOString(),
    });
  };
}

module.exports = { healthCheck };

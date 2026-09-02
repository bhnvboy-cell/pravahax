const jwt = require('jsonwebtoken');
const config = require('../config');
const userModel = require('../models/User');
const messageStore = require('../models/Message');
const auditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

function sanitize(text) {
  if (!text) return '';
  return String(text).replace(/<[^>]*>/g, '').substring(0, 2000);
}

const users = new Map();
const rooms = new Map();

function setupWebSocket(wss) {
  wss.on('connection', (ws, req) => {
    let userId = null;
    let username = null;
    let role = null;

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    logger.info('WebSocket connection from ' + ip);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);

        switch (msg.type) {
          case 'auth':
            try {
              const decoded = jwt.verify(msg.token, config.jwtSecret);
              const user = userModel.findById(decoded.id);
              if (!user || user.status === 'banned') {
                ws.send(JSON.stringify({ type: 'auth-error', error: 'Invalid or banned account' }));
                ws.close();
                return;
              }
              userId = user.id;
              username = user.username;
              role = user.role;
              users.set(userId, { ws, username, role, connectedAt: new Date().toISOString(), ip });
              logger.info(`User authenticated: ${username} (${role})`);
              ws.send(JSON.stringify({ type: 'auth-success', user: userModel.toSafe(user) }));
              const history = messageStore.getRecent(200);
              ws.send(JSON.stringify({ type: 'message-history', messages: history }));
              broadcastUserList();
            } catch (e) {
              ws.send(JSON.stringify({ type: 'auth-error', error: 'Invalid token' }));
              ws.close();
            }
            break;

          case 'chat':
            if (!userId) return;
            const saved = messageStore.save({
              from: userId,
              username,
              message: sanitize(msg.message),
              timestamp: Date.now(),
            });
            broadcast({
              type: 'chat',
              id: saved.id,
              from: userId,
              username,
              message: saved.message,
              timestamp: saved.timestamp,
            });
            break;

          case 'call-request':
          case 'call-accept':
          case 'call-reject':
          case 'call-end':
          case 'offer':
          case 'answer':
          case 'ice-candidate':
            if (!userId) return;
            const target = users.get(msg.to);
            if (target && target.ws.readyState === 1) {
              target.ws.send(JSON.stringify({ ...msg, from: userId, username }));
            }
            break;

          case 'admin-broadcast':
            if (role !== 'admin') return;
            const bcast = messageStore.save({
              from: 'system',
              username: '[Admin Broadcast]',
              message: sanitize(msg.message),
              timestamp: Date.now(),
            });
            broadcast({
              type: 'admin-message',
              id: bcast.id,
              from: 'system',
              username: '[Admin Broadcast]',
              message: bcast.message,
              timestamp: bcast.timestamp,
            });
            logger.info(`Admin broadcast by ${username}: ${msg.message}`);
            break;

          case 'admin-kick':
            if (role !== 'admin') return;
            const kickTarget = users.get(msg.userId);
            if (kickTarget) {
              kickTarget.ws.send(JSON.stringify({ type: 'kicked', by: username }));
              kickTarget.ws.close();
              auditLog.log('user_kicked', userId, { targetId: msg.userId, targetUsername: kickTarget.username, ip });
              logger.info(`User kicked: ${kickTarget.username} by ${username}`);
            }
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;

          case 'room-create':
            if (!userId) return;
            const roomId = 'room-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
            rooms.set(roomId, { creator: userId, members: new Set([userId]), name: msg.name || (username + "'s call") });
            ws.send(JSON.stringify({ type: 'room-created', roomId, members: [userId] }));
            logger.info(`Room created: ${roomId} by ${username}`);
            break;

          case 'room-invite':
            if (!userId || !msg.roomId || !msg.userIds) return;
            const room = rooms.get(msg.roomId);
            if (!room || room.creator !== userId) return;
            msg.userIds.forEach(uid => {
              room.members.add(uid);
              const target = users.get(uid);
              if (target && target.ws.readyState === 1) {
                target.ws.send(JSON.stringify({ type: 'room-invite', roomId: msg.roomId, from: userId, username, roomName: room.name }));
              }
            });
            ws.send(JSON.stringify({ type: 'room-updated', roomId: msg.roomId, members: Array.from(room.members) }));
            break;

          case 'room-join':
            if (!userId || !msg.roomId) return;
            const joinRoom = rooms.get(msg.roomId);
            if (!joinRoom) return ws.send(JSON.stringify({ type: 'room-error', error: 'Room not found' }));
            const wasMember = joinRoom.members.has(userId);
            joinRoom.members.add(userId);
            joinRoom.members.forEach(uid => {
              if (uid !== userId) {
                const member = users.get(uid);
                if (member && member.ws.readyState === 1) {
                  member.ws.send(JSON.stringify({ type: 'room-user-joined', roomId: msg.roomId, userId, username }));
                }
              }
            });
            ws.send(JSON.stringify({ type: 'room-joined', roomId: msg.roomId, members: Array.from(joinRoom.members), roomName: joinRoom.name }));
            break;

          case 'room-leave':
          case 'room-end':
            if (!userId || !msg.roomId) return;
            const leaveRoom = rooms.get(msg.roomId);
            if (!leaveRoom) return;
            const isEnd = msg.type === 'room-end' && leaveRoom.creator === userId;
            leaveRoom.members.delete(userId);
            leaveRoom.members.forEach(uid => {
              const member = users.get(uid);
              if (member && member.ws.readyState === 1) {
                member.ws.send(JSON.stringify({ type: isEnd ? 'room-ended' : 'room-user-left', roomId: msg.roomId, userId, username }));
              }
            });
            if (leaveRoom.members.size === 0 || isEnd) {
              rooms.delete(msg.roomId);
            }
            break;

          case 'room-signal':
            if (!userId || !msg.roomId || !msg.to || !msg.signal) return;
            const sigTarget = users.get(msg.to);
            if (sigTarget && sigTarget.ws.readyState === 1) {
              sigTarget.ws.send(JSON.stringify({ type: 'room-signal', roomId: msg.roomId, from: userId, username, signal: msg.signal }));
            }
            break;
        }
      } catch (e) {
        logger.error('WebSocket message error', { error: e.message });
      }
    });

    ws.on('close', () => {
      if (userId) {
        users.delete(userId);
        logger.info(`User disconnected: ${username}`);
        broadcastUserList();
      }
    });

    ws.on('error', (err) => {
      logger.error('WebSocket error', { error: err.message, userId });
    });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(data);
  });
}

function broadcastUserList() {
  if (!wss) return;
  const list = Array.from(users.entries()).map(([id, u]) => ({
    id, username: u.username, role: u.role, connectedAt: u.connectedAt,
  }));
  const data = JSON.stringify({ type: 'user-list', users: list });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(data);
  });
}

function getOnlineUsers() {
  return Array.from(users.entries()).map(([id, u]) => ({
    id, username: u.username, role: u.role, ip: u.ip, connectedAt: u.connectedAt,
  }));
}

function kickUser(targetId, adminUsername) {
  const target = users.get(targetId);
  if (target) {
    target.ws.send(JSON.stringify({ type: 'kicked', by: adminUsername }));
    target.ws.close();
    return true;
  }
  return false;
}

let wss;
function setWss(instance) { wss = instance; }

module.exports = { setupWebSocket, broadcast, broadcastUserList, getOnlineUsers, kickUser, setWss, users };

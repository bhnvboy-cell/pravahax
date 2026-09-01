const express = require('express');
const userModel = require('../models/User');
const auditLog = require('../models/AuditLog');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

router.use(authenticate);
router.use(authorize('admin'));

router.get('/users', (req, res) => {
  const users = userModel.findAll().map(u => userModel.toSafe(u));
  res.json({ users });
});

router.get('/audit', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const logs = auditLog.getRecent(limit);
  res.json({ logs });
});

router.get('/audit/:userId', (req, res) => {
  const logs = auditLog.getByUser(req.params.userId);
  res.json({ logs });
});

router.put('/users/:id/role', (req, res) => {
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot change your own role' });
  }

  const updated = role === 'admin' ? userModel.promoteUser(req.params.id) : userModel.demoteUser(req.params.id);
  if (!updated) return res.status(404).json({ error: 'User not found' });

  auditLog.log('role_changed', req.user.id, { targetId: req.params.id, newRole: role, ip: req.ip });
  logger.info(`Role changed: ${updated.username} -> ${role} by ${req.user.username}`);
  res.json({ user: userModel.toSafe(updated) });
});

router.put('/users/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'banned'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot change your own status' });
  }

  const updated = status === 'banned' ? userModel.banUser(req.params.id) : userModel.unbanUser(req.params.id);
  if (!updated) return res.status(404).json({ error: 'User not found' });

  auditLog.log('status_changed', req.user.id, { targetId: req.params.id, targetUsername: updated.username, newStatus: status, ip: req.ip });
  logger.info(`User ${status}: ${updated.username} by ${req.user.username}`);
  res.json({ user: userModel.toSafe(updated) });
});

router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }

  const user = userModel.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Cannot delete admin' });

  userModel.delete(req.params.id);
  auditLog.log('user_deleted', req.user.id, { targetUsername: user.username, ip: req.ip });
  logger.info(`User deleted: ${user.username} by ${req.user.username}`);
  res.json({ message: 'User deleted' });
});

router.get('/stats', (req, res) => {
  const users = userModel.findAll();
  const logs = auditLog.findAll();
  res.json({
    totalUsers: users.length,
    activeUsers: users.filter(u => u.status === 'active').length,
    bannedUsers: users.filter(u => u.status === 'banned').length,
    adminUsers: users.filter(u => u.role === 'admin').length,
    totalAuditLogs: logs.length,
    recentLogins: logs.filter(l => l.action === 'login_success').length,
  });
});

module.exports = router;

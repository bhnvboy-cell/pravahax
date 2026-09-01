const express = require('express');
const userModel = require('../models/User');
const auditLog = require('../models/AuditLog');
const { authenticate, generateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be 3-20 characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const result = await userModel.create({ username, email, password });
    if (result.error) return res.status(409).json({ error: result.error });

    const token = generateToken(result);
    auditLog.log('user_registered', result.id, { username: result.username, ip: req.ip });
    logger.info(`New user registered: ${result.username}`);
    res.status(201).json({ user: result, token });
  } catch (err) {
    logger.error('Registration error', { error: err.message });
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = userModel.authenticate(username, password);
    if (result.error) {
      auditLog.log('login_failed', null, { username, ip: req.ip });
      return res.status(401).json({ error: result.error });
    }

    const token = generateToken(result.user);
    auditLog.log('login_success', result.user.id, { username: result.user.username, ip: req.ip });
    logger.info(`User logged in: ${result.user.username}`);
    res.json({ user: result.user, token });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

router.put('/me/password', authenticate, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }

    const user = userModel.findById(req.user.id);
    const bcrypt = require('bcryptjs');
    if (!bcrypt.compareSync(currentPassword, user.password)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    userModel.changePassword(req.user.id, newPassword);
    auditLog.log('password_changed', req.user.id, { ip: req.ip });
    res.json({ message: 'Password updated' });
  } catch (err) {
    logger.error('Password change error', { error: err.message });
    res.status(500).json({ error: 'Password change failed' });
  }
});

module.exports = router;

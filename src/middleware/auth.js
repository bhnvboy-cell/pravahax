const jwt = require('jsonwebtoken');
const config = require('../config');
const userModel = require('../models/User');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(header.split(' ')[1], config.jwtSecret);
    const user = userModel.findById(decoded.id);
    if (!user || user.status === 'banned') {
      return res.status(401).json({ error: 'Invalid or banned account' });
    }
    req.user = userModel.toSafe(user);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

function generateToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

module.exports = { authenticate, authorize, generateToken };

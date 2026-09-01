const JsonStore = require('./JsonStore');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');

class UserModel extends JsonStore {
  constructor() {
    super('users.json');
    this._ensureAdmin();
  }

  _ensureAdmin() {
    const admin = this.findOne({ username: config.admin.defaultUsername });
    if (!admin) {
      this.insert({
        id: uuidv4(),
        username: config.admin.defaultUsername,
        email: `${config.admin.defaultUsername}@pravahax.local`,
        password: bcrypt.hashSync(config.admin.defaultPassword, config.bcryptRounds),
        role: 'admin',
        status: 'active',
        createdAt: new Date().toISOString(),
      });
      logger.info('Default admin account created');
    }
  }

  create(data) {
    const existing = this.findOne({ username: data.username }) || this.findOne({ email: data.email });
    if (existing) return { error: 'Username or email already exists' };

    const user = {
      id: uuidv4(),
      username: data.username,
      email: data.email || `${data.username}@pravahax.local`,
      password: bcrypt.hashSync(data.password, config.bcryptRounds),
      role: data.role || 'user',
      status: 'active',
      lastLogin: null,
      loginCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.insert(user);
    logger.info(`User created: ${user.username} (role: ${user.role})`);
    const { password, ...safe } = user;
    return safe;
  }

  authenticate(username, password) {
    const user = this.findOne({ username });
    if (!user) return { error: 'Invalid credentials' };
    if (user.status === 'banned') return { error: 'Account is banned' };
    if (!bcrypt.compareSync(password, user.password)) return { error: 'Invalid credentials' };

    this.update(user.id, {
      lastLogin: new Date().toISOString(),
      loginCount: (user.loginCount || 0) + 1,
    });

    const { password: _, ...safe } = user;
    return { user: safe };
  }

  toSafe(user) {
    if (!user) return null;
    const { password, ...safe } = user;
    return safe;
  }

  banUser(id) {
    return this.update(id, { status: 'banned' });
  }

  unbanUser(id) {
    return this.update(id, { status: 'active' });
  }

  promoteUser(id) {
    return this.update(id, { role: 'admin' });
  }

  demoteUser(id) {
    return this.update(id, { role: 'user' });
  }

  changePassword(id, newPassword) {
    return this.update(id, { password: bcrypt.hashSync(newPassword, config.bcryptRounds) });
  }
}

module.exports = new UserModel();

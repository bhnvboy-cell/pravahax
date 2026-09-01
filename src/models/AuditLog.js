const JsonStore = require('./JsonStore');
const { v4: uuidv4 } = require('uuid');

class AuditLog extends JsonStore {
  constructor() {
    super('audit.json');
  }

  log(action, userId, details = {}) {
    return this.insert({
      id: uuidv4(),
      action,
      userId,
      details,
      ip: details.ip || 'unknown',
      timestamp: new Date().toISOString(),
    });
  }

  getRecent(limit = 50) {
    return this.findAll().slice(-limit).reverse();
  }

  getByUser(userId) {
    return this.findAll({ userId }).reverse();
  }
}

module.exports = new AuditLog();

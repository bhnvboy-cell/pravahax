const JsonStore = require('./JsonStore');
const { v4: uuidv4 } = require('uuid');

class MessageStore extends JsonStore {
  constructor() {
    super('messages.json');
  }

  save(msg) {
    const entry = {
      id: uuidv4(),
      from: msg.from,
      username: msg.username,
      message: msg.message,
      timestamp: msg.timestamp || Date.now(),
    };
    this.insert(entry);
    return entry;
  }

  getRecent(limit = 100) {
    return this.findAll().slice(-limit);
  }

  clearOld(keepDays = 7) {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    const all = this.findAll();
    const kept = all.filter(m => m.timestamp > cutoff);
    this._write(kept);
  }
}

module.exports = new MessageStore();

const fs = require('fs');
const path = require('path');
const config = require('../config');

if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });

class JsonStore {
  constructor(filename) {
    this.filePath = path.join(config.dataDir, filename);
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, '[]');
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return [];
    }
  }

  _write(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  findAll(filter) {
    const data = this._read();
    if (!filter) return data;
    return data.filter(item => Object.entries(filter).every(([k, v]) => item[k] === v));
  }

  findById(id) {
    return this._read().find(item => item.id === id) || null;
  }

  findOne(filter) {
    return this._read().find(item => Object.entries(filter).every(([k, v]) => item[k] === v)) || null;
  }

  insert(item) {
    const data = this._read();
    data.push(item);
    this._write(data);
    return item;
  }

  update(id, updates) {
    const data = this._read();
    const idx = data.findIndex(item => item.id === id);
    if (idx === -1) return null;
    data[idx] = { ...data[idx], ...updates, updatedAt: new Date().toISOString() };
    this._write(data);
    return data[idx];
  }

  delete(id) {
    const data = this._read();
    const filtered = data.filter(item => item.id !== id);
    if (filtered.length === data.length) return false;
    this._write(filtered);
    return true;
  }
}

module.exports = JsonStore;

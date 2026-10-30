const os = require('os');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

let db = null;

/**
 * 获取数据库实例
 * @returns {sqlite3.Database}
 */
function getDatabase() {
  if (db) {
    return db;
  }
  const dbPath = path.join(os.homedir(), 'kys', 'data.db');
  console.log("dbPath: ", dbPath);
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('数据库连接失败:', err.message);
      throw err;
    }
    console.log('数据库连接成功');
  });

  // 开启外键约束
  db.run('PRAGMA foreign_keys = ON');

  return db;
}

/**
 * 初始化数据库表结构
 */
function initDatabase() {
  const db = getDatabase();

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS material (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          create_time DATETIME NOT NULL DEFAULT (datetime('now', '+8 hours')),
          card TEXT NOT NULL,
          month TEXT NOT NULL,
          year TEXT NOT NULL,
          cvv TEXT,
          name TEXT,
          address TEXT,
          city TEXT,
          state TEXT,
          zip TEXT,
          country TEXT,
          extra TEXT,
          amount INTEGER DEFAULT 0,
          status INTEGER DEFAULT 0,
          device TEXT,
          note TEXT
        )
      `, (err) => {
        if (err) reject(err);
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS device (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          create_time DATETIME NOT NULL DEFAULT (datetime('now', '+8 hours')),
          symbol TEXT NOT NULL,
          account TEXT,
          amount REAL,
          count INTEGER NOT NULL DEFAULT 0,
          status INTEGER NOT NULL DEFAULT 1,
          note TEXT
        )
      `, (err) => {
        if (err) reject(err);
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          create_time DATETIME NOT NULL DEFAULT (datetime('now', '+8 hours')),
          card TEXT NOT NULL,
          month TEXT,
          day TEXT,
          cvv TEXT,
          year TEXT,
          extra TEXT,
          amount INTEGER DEFAULT 0,
          status INTEGER DEFAULT 3,
          device TEXT,
          note TEXT
        )
      `, (err) => {
        if (err) {
          reject(err);
        }
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS config (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          value TEXT,
          create_time DATETIME NOT NULL DEFAULT (datetime('now', '+8 hours'))
        )
      `, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });
}

/**
 * 关闭数据库连接
 */
function closeDatabase() {
  if (db) {
    db.close((err) => {
      if (err) {
        console.error('数据库关闭失败:', err.message);
      } else {
        console.log('数据库连接已关闭');
        db = null;
      }
    });
  }
}

module.exports = {
  getDatabase,
  initDatabase,
  closeDatabase
};


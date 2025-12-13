const { getDatabase } = require('./database');

class Config {
  constructor() {
    this.db = getDatabase();
  }

  /**
   * 保存或更新配置
   * @param {string} key - 配置键
   * @param {string} value - 配置值
   * @returns {Promise<boolean>}
   */
  set(key, value) {
    return new Promise((resolve, reject) => {
      if (!key) {
        return reject(new Error('配置键不能为空'));
      }

      const sql = `
        INSERT INTO config (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = ?
      `;
      
      const params = [key, value, value];

      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * 获取配置值
   * @param {string} key - 配置键
   * @returns {Promise<string|null>}
   */
  get(key) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT value FROM config WHERE key = ?';
      
      this.db.get(sql, [key], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? row.value : null);
        }
      });
    });
  }

  /**
   * 获取所有配置
   * @returns {Promise<Object>} 配置对象（key-value形式）
   */
  config() {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT key, value FROM config';
      
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const config = {};
          rows.forEach(row => {
            config[row.key] = row.value;
          });
          resolve(config);
        }
      });
    });
  }

  /**
   * 批量保存配置
   * @param {Object} configs - 配置对象（key-value形式）
   * @returns {Promise<boolean>}
   */
  setMultiple(configs) {
    return new Promise((resolve, reject) => {
      if (!configs || typeof configs !== 'object') {
        return reject(new Error('配置必须是对象'));
      }

      const keys = Object.keys(configs);
      if (keys.length === 0) {
        return resolve(true);
      }

      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');

        let hasError = false;
        let completed = 0;

        keys.forEach(key => {
          const sql = `
            INSERT INTO config (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?
          `;
          const params = [key, configs[key], configs[key]];

          this.db.run(sql, params, function(err) {
            if (err) {
              hasError = true;
            }
            
            completed++;
            
            if (completed === keys.length) {
              if (hasError) {
                this.db.run('ROLLBACK', () => {
                  reject(new Error('保存配置失败'));
                });
              } else {
                this.db.run('COMMIT', (err) => {
                  if (err) {
                    reject(err);
                  } else {
                    resolve(true);
                  }
                });
              }
            }
          }.bind(this));
        });
      });
    });
  }

  /**
   * 删除配置
   * @param {string} key - 配置键
   * @returns {Promise<boolean>}
   */
  delete(key) {
    return new Promise((resolve, reject) => {
      const sql = 'DELETE FROM config WHERE key = ?';
      
      this.db.run(sql, [key], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }
}

module.exports = new Config();


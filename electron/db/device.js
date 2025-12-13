const _ = require('lodash');
const { getDatabase } = require('./database');

class Device {
  constructor() {
    this.db = getDatabase();
  }

  /**
   * 新增设备
   * @param {Object} data - 设备数据
   * @param {string} data.symbol - 标识（必填）
   * @param {string} data.account - 账户
   * @param {number} data.amount - 金额
   * @param {number} data.status - 状态（1运行中、2已停止、3异常，必填）
   * @param {string} data.note - 说明
   * @returns {Promise<number>} 新增记录的ID
   */
  create(data) {
    return new Promise((resolve, reject) => {
      if (!data.symbol) {
        return reject(new Error('标识为必填字段'));
      }

      const sql = `
        INSERT INTO device (symbol, account, amount, status, note)
        VALUES (?, ?, ?, ?, ?)
      `;
      
      const params = [
        data.symbol,
        data.account || null,
        data.amount || null,
        data.status || 2,
        data.note || null
      ];

      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  /**
   * 删除设备
   * @param {number} id - 设备ID
   * @returns {Promise<boolean>}
   */
  delete(id) {
    return new Promise((resolve, reject) => {
      const sql = 'DELETE FROM device WHERE id = ?';
      
      this.db.run(sql, [id], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  /**
   * 更新设备
   * @param {number} id - 设备ID
   * @param {Object} data - 要更新的数据
   * @returns {Promise<boolean>}
   */
  update(id, data) {
    return new Promise((resolve, reject) => {
      const fields = [];
      const params = [];

      if (data.symbol) {
        fields.push('symbol = ?');
        params.push(data.symbol);
      }
      if (data.account) {
        fields.push('account = ?');
        params.push(data.account);
      }
      if (data.amount) {
        fields.push('amount = ?');
        params.push(data.amount);
      }
      if (!_.isNil(data.count)) {
        fields.push('count = ?');
        params.push(data.count);
      }
      if (!_.isNil(data.status)) {
        fields.push('status = ?');
        params.push(data.status);
      }
      if (!_.isNil(data.note)) {
        fields.push('note = ?');
        params.push(data.note);
      }

      if (fields.length === 0) {
        return reject(new Error('没有要更新的字段'));
      }

      params.push(id);
      const sql = `UPDATE device SET ${fields.join(', ')} WHERE id = ?`;

      this.db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  /**
   * 根据ID查询设备
   * @param {number} id - 设备ID
   * @returns {Promise<Object|null>}
   */
  get(id) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM device WHERE id = ?';
      
      this.db.get(sql, [id], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    });
  }

  /**
   * 查询所有设备（按create_time从小到大排序）
   * @returns {Promise<Array>}
   */
  list() {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM device ORDER BY create_time ASC';
      
      this.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * 获取设备总数
   * @returns {Promise<number>}
   */
  count() {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT COUNT(*) as total FROM device';
      
      this.db.get(sql, [], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.total);
        }
      });
    });
  }
}

module.exports = new Device();
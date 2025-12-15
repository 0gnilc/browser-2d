const _ = require('lodash');
const { getDatabase } = require('./database');

class Material {
  constructor() {
    this.db = getDatabase();
  }

  /**
   * 新增料
   * @param {Object} data - 料数据
   * @param {string} data.card - 卡号（必填）
   * @param {string} data.month - 月（必填）
   * @param {string} data.day - 日（必填）
   * @param {string} data.cvv - CVV
   * @param {string} data.year - 年
   * @param {string} data.extra - 额外数据
   * @param {number} data.amount - 金额
   * @param {number} data.status - 状态（0待处理、1处理中、2成功、3失败、43D验证、5余额不足、6其他）
   * @param {string} data.device - 设备
   * @param {string} data.note - 说明
   * @returns {Promise<number>} 新增记录的ID
   */
  create(data) {
    return new Promise((resolve, reject) => {
      if (!data.card) {
        return reject(new Error('卡号为必填字段'));
      }
      if (!data.month) {
        return reject(new Error('月为必填字段'));
      }
      if (!data.day) {
        return reject(new Error('日为必填字段'));
      }

      const existsSql = 'SELECT * FROM material WHERE card = ? AND month = ? AND day = ?';
      this.db.get(existsSql, [data.card, data.month, data.day], (err, row) => {
        if (err) {
          return reject(err);
        }
        if (row) {
          return reject(new Error('已存在，自动过滤'));
        }

        const sql = `
          INSERT INTO material (card, month, day, cvv, year, extra, status, device, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [
          data.card,
          data.month,
          data.day || null,
          data.cvv || null,
          data.year,
          data.extra || null,
          data.status || 0,
          data.device || null,
          data.note || null
        ];

        this.db.run(sql, params, function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID);
          }
        });
      });
    });
  }
  /**
   * 删除料
   * @param {number} id - 料ID
   * @returns {Promise<boolean>}
   */
  delete(id) {
    return new Promise((resolve, reject) => {
      const sql = 'DELETE FROM material WHERE id = ?';

      this.db.run(sql, [id], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  /**
   * 清空
   * @returns {Promise<boolean>}
   */
  clear() {
    return new Promise((resolve, reject) => {
      const sql = 'DELETE FROM material';
      this.db.run(sql, [], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  /**
   * 更新料
   * @param {number} id - 料ID
   * @param {Object} data - 要更新的数据
   * @returns {Promise<boolean>}
   */
  update(id, data = {}) {
    return new Promise((resolve, reject) => {
      const fields = [];
      const params = [];

      if (data.card) {
        fields.push('card = ?');
        params.push(data.card);
      }
      if (data.month) {
        fields.push('month = ?');
        params.push(data.month);
      }
      if (data.day) {
        fields.push('day = ?');
        params.push(data.day);
      }
      if (data.cvv) {
        fields.push('cvv = ?');
        params.push(data.cvv);
      }
      if (data.year) {
        fields.push('year = ?');
        params.push(data.year);
      }
      if (data.extra) {
        fields.push('extra = ?');
        params.push(data.extra);
      }
      if (!_.isNil(data.amount)) {
        fields.push('amount = ?');
        params.push(data.amount);
      }
      if (!_.isNil(data.status)) {
        fields.push('status = ?');
        params.push(data.status);
      }
      if (!_.isNil(data.device)) {
        fields.push('device = ?');
        params.push(data.device);
      }
      if (!_.isNil(data.note)) {
        fields.push('note = ?');
        params.push(data.note);
      }

      if (fields.length === 0) {
        return reject(new Error('没有要更新的字段'));
      }

      params.push(id);
      const sql = `UPDATE material SET ${fields.join(', ')} WHERE id = ?`;

      this.db.run(sql, params, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  /**
   * 重置
   * @param {number} id - 料ID
   */
  reset(id) {
    return this.update(id, { status: 0, device: '', note: '' })
  }

  /**
 * 重置所有
 */
  resetAll() {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE material SET status = 0 WHERE status = 1`;

      this.db.run(sql, [], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  /**
   * 根据ID查询料
   * @param {number} id - 料ID
   * @returns {Promise<Object|null>}
   */
  get(id) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM material WHERE id = ?';

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
   * 弹出料
   * @param {number} status - 状态（0待处理、1处理中、2成功、3失败、43D验证、5余额不足、6其他）
   * @returns {Promise<Object|null>}
   */
  pop(status = 0) {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE material 
        SET status = 1 
        WHERE id = (
          SELECT id FROM material 
          WHERE status = ?
          ORDER BY create_time ASC 
          LIMIT 1
        )
        RETURNING *
      `;

      this.db.get(sql, [status], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    });
  }

  /**
   * 查询所有料（按create_time从小到大排序）
   * @returns {Promise<Array>}
   */
  list() {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM material ORDER BY create_time ASC';

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
   * 分页查询料（按create_time从小到大排序）
   * @param {number} page - 页码（从1开始）
   * @param {number} pageSize - 每页数量
   * @returns {Promise<Object>} { list: Array, total: number, page: number, pageSize: number }
   */
  page(params = {}) {
    return new Promise((resolve, reject) => {
      const { page = 1, pageSize = 10, card, status } = params;
      const offset = (page - 1) * pageSize;

      const conditions = [];
      const values = [];

      if (card) {
        conditions.push('card = ?');
        values.push(card);
      }

      if (status) {
        conditions.push('status = ?');
        values.push(status);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // 查询总数
      this.db.get(`SELECT COUNT(*) as total FROM material ${where}`, values, (err, countRow) => {
        if (err) {
          return reject(err);
        }

        const total = countRow.total;

        // 查询分页数据
        const sql = `SELECT * FROM material ${where} ORDER BY create_time ASC LIMIT ? OFFSET ?`;

        this.db.all(sql, [...values, pageSize, offset], (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve({
              list: rows || [],
              total: total,
              page: page,
              pageSize: pageSize
            });
          }
        });
      });
    });
  }

  /**
   * 获取料总数
   * @returns {Promise<number>}
   */
  count() {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT COUNT(*) as total FROM material';

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

module.exports = new Material();


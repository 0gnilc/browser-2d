const _ = require('lodash');
const { getDatabase } = require('./database');

class History {
  constructor() {
    this.db = getDatabase();
  }

  /**
   * 新增料历史记录
   * @param {Object} data - 料历史数据
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
      // 验证必填字段
      if (!data.card) {
        return reject(new Error('卡号为必填字段'));
      }

      const sql = `
        INSERT INTO history (card, month, day, cvv, year, extra, status, amount, device, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        data.card,
        data.month || null,
        data.day || null,
        data.cvv || null,
        data.year || null,
        data.extra || null,
        data.status || 0,
        data.amount || 0,
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
  }

  /**
   * 删除料历史记录
   * @param {number} id - 料历史ID
   * @returns {Promise<boolean>}
   */
  delete(id) {
    return new Promise((resolve, reject) => {
      const sql = 'DELETE FROM history WHERE id = ?';

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
      const sql = 'DELETE FROM history';
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
   * 根据ID查询料历史记录
   * @param {number} id - 料历史ID
   * @returns {Promise<Object|null>}
   */
  get(id) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM history WHERE id = ?';

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
 * 根据卡号查询料历史记录
 * @param {string} card - 卡号
 * @returns {Promise<Object|null>}
 */
  getByCard(card) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM history WHERE card = ? ORDER BY create_time DESC LIMIT 1';

      this.db.get(sql, [card], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    });
  }

  /**
   * 条件查询料历史记录（支持卡号、时间区间、状态、note模糊查询）
   * @param {Object} params - 查询参数
   * @param {string} params.card - 卡号（精确匹配）
   * @param {string} params.startTime - 开始时间
   * @param {string} params.endTime - 结束时间
   * @param {number} params.status - 状态
   * @param {string} params.note - 说明（模糊匹配）
   * @returns {Promise<Array>}
   */
  list(params = {}) {
    return new Promise((resolve, reject) => {
      const { card, createTime, status, note } = params;
      const conditions = [];
      const values = [];

      if (card) {
        conditions.push('card = ?');
        values.push(card);
      }

      if (_.isArray(createTime)) {
        if (createTime[0]) {
          conditions.push('create_time >= ?');
          values.push(createTime[0]);
        }
        if (createTime[1]) {
          conditions.push('create_time <= ?');
          values.push(createTime[1]);
        }
      }

      if (status) {
        conditions.push('status = ?');
        values.push(status);
      }

      if (note) {
        conditions.push('note LIKE ?');
        values.push(`%${note}%`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `SELECT *, create_time AS createTime FROM history ${where} ORDER BY create_time ASC`;
      this.db.all(sql, values, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * 分页查询料历史记录（支持卡号、时间区间、状态、note模糊查询）
   * @param {Object} params - 查询参数
   * @param {string} params.card - 卡号（精确匹配）
   * @param {string} params.startTime - 开始时间
   * @param {string} params.endTime - 结束时间
   * @param {number} params.status - 状态
   * @param {string} params.note - 说明（模糊匹配）
   * @param {number} params.page - 页码（从1开始）
   * @param {number} params.pageSize - 每页数量
   * @returns {Promise<Object>} { list: Array, total: number, page: number, pageSize: number }
   */
  page(params = {}) {
    return new Promise((resolve, reject) => {
      const { page = 1, pageSize = 10, card, status, createTime, note } = params;
      const offset = (page - 1) * pageSize;

      const conditions = [];
      const values = [];

      if (card) {
        conditions.push('card = ?');
        values.push(card);
      }

      if (_.isArray(createTime)) {
        if (createTime[0]) {
          conditions.push('create_time >= ?');
          values.push(createTime[0]);
        }
        if (createTime[1]) {
          conditions.push('create_time <= ?');
          values.push(createTime[1]);
        }
      }

      if (status) {
        conditions.push('status = ?');
        values.push(status);
      }

      if (note) {
        conditions.push('note LIKE ?');
        values.push(`%${note}%`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // 查询总数
      this.db.get(`SELECT COUNT(*) as total FROM history ${where}`, values, (err, countRow) => {
        if (err) {
          return reject(err);
        }

        const total = countRow.total;

        const sql = `
          SELECT *, create_time as createTime FROM history 
          ${where} 
          ORDER BY create_time ASC 
          LIMIT ? OFFSET ?
        `;

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
   * 获取料历史总数
   * @param {Object} params - 查询参数（可选）
   * @returns {Promise<number>}
   */
  count(params = {}) {
    return new Promise((resolve, reject) => {
      const conditions = [];
      const values = [];

      // 构建查询条件
      if (params.card) {
        conditions.push('card = ?');
        values.push(params.card);
      }

      if (params.startTime) {
        conditions.push('create_time >= ?');
        values.push(params.startTime);
      }

      if (params.endTime) {
        conditions.push('create_time <= ?');
        values.push(params.endTime);
      }

      if (params.status !== undefined && params.status !== null) {
        conditions.push('status = ?');
        values.push(params.status);
      }

      if (params.note) {
        conditions.push('note LIKE ?');
        values.push(`%${params.note}%`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `SELECT COUNT(*) as total FROM history ${where}`;

      this.db.get(sql, values, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.total);
        }
      });
    });
  }
}

module.exports = new History();


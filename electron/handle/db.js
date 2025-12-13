const { ipcMain } = require('electron');
const { Material, Device, History, Config } = require('../db');

function init() {
  ipcMain.handle('material:create', async (event, data) => {
    try {
      return { success: true, data: await Material.create(data) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('material:delete', async (event, id) => {
    try {
      return { success: true, data: await Material.delete(id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('material:clear', async () => {
    try {
      return { success: true, data: await Material.clear() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('material:update', async (event, id, data) => {
    try {
      return { success: true, data: await Material.update(id, data) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('material:reset', async (event, id) => {
    try {
      return { success: true, data: await Material.reset(id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('material:get', async (event, id) => {
    try {
      return { success: true, data: await Material.get(id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('material:list', async () => {
    try {
      return { success: true, data: await Material.list() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('material:page', async (event, page, pageSize) => {
    try {
      return { success: true, data: await Material.page(page, pageSize) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('material:count', async () => {
    try {
      return { success: true, data: await Material.count() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('device:create', async (event, data) => {
    try {
      return { success: true, data: await Device.create(data) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('device:delete', async (event, id) => {
    try {
      return { success: true, data: await Device.delete(id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('device:update', async (event, id, data) => {
    try {
      return { success: true, data: await Device.update(id, data) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('device:get', async (event, id) => {
    try {
      return { success: true, data: await Device.get(id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('device:list', async (event, params) => {
    try {
      return { success: true, data: await Device.list() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('device:count', async () => {
    try {
      return { success: true, data: await Device.count() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('history:create', async (event, data) => {
    try {
      return { success: true, data: await History.create(data) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('history:delete', async (event, id) => {
    try {
      return { success: true, data: await History.delete(id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('history:clear', async () => {
    try {
      return { success: true, data: await History.clear() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('history:get', async (event, id) => {
    try {
      return { success: true, data: await History.get(id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  ipcMain.handle('history:list', async (event, params) => {
    try {
      return { success: true, data: await History.list(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('history:page', async (event, params) => {
    try {
      return { success: true, data: await History.page(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('config:set', async (event, key, value) => {
    try {
      return { success: true, data: await Config.set(key, value) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('config:get', async (event, key) => {
    try {
      return { success: true, data: await Config.get(key) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('config:config', async () => {
    try {
      return { success: true, data: await Config.config() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('config:setMultiple', async (event, configs) => {
    try {
      return { success: true, data: await Config.setMultiple(configs) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('config:delete', async (event, key) => {
    try {
      return { success: true, data: await Config.delete(key) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  init
};


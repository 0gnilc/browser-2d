const { ipcMain } = require('electron');
const { start, stop, startAll, stopAll } = require('../work/index.js');

function init() {
  ipcMain.handle('work:start', (_, deviceId) => {
    return start(deviceId)
  });

  ipcMain.handle('work:stop',  (_, deviceId) => {
    return stop(deviceId)
  });
  
  ipcMain.handle('work:startAll', () => {
    return startAll()
  });

  ipcMain.handle('work:stopAll', () => {
    return stopAll()
  });
}

module.exports = {
  init
};


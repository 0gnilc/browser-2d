const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const { initIpc } = require('./handle/index.js');
const { initDatabase, closeDatabase, preProcessData } = require('./db');
const { clear: clearWork } = require('./work/index.js');
const Material = require('./db/material');

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.webContents.openDevTools()
  win.loadFile('dist/index.html')
}

initIpc();

app.whenReady().then(async () => {
  try {
    await initDatabase();
    console.log('数据库初始化成功');
  } catch (error) {
    console.error('数据库初始化失败:', error);
  }
  try {
    await clearWork();
  } catch (error) {
    console.error(error);
  }
  try {
    await preProcessData();
  } catch (error) {
    console.error(error);
  }
  createWindow()
})

app.on('will-quit', () => {
  closeDatabase();
  clearWork();
})
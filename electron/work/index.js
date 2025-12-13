const path = require('path');
const { webContents } = require('electron');
const { Worker } = require('worker_threads');
const Device = require('../db/device');

const workers = new Map();

const start = (deviceId) => {
  return new Promise((resolve, reject) => {
    try {
      const device = Device.get(deviceId);
      if (device) {
        const worker = new Worker(path.join(__dirname, './worker.js'), {
          workerData: { deviceId },
        });
        worker.on('message', (message) => {
          const { type, data } = message;
          if (type == 'started') {
            Device.update(deviceId, { status: 1 });
            resolve("start success:" + deviceId);
          } else if (type == 'stopped') {
            Device.update(deviceId, { status: 2 }, { note: data });
            emitDeviceReload();
          } else if (type == 'material:reload') {
            emitMaterialReload();
          }
        });
        worker.on('error', (error) => {
          console.error(error);
          Device.update(deviceId, { status: 3, note: error.message });
          emitDeviceReload();
        });
        worker.on('exit', (code) => {
          console.error("exit: ", code);
          Device.update(deviceId, { status: 2 });
          emitDeviceReload();
        });
        // 保存实例
        workers.set(deviceId, worker);

      } else {
        reject(new Error("设备不存在: " + deviceId));
      }
    } catch (error) {
      console.error(error);
      reject(error);
    }
  })
}

const stop = (deviceId) => {
  return new Promise((resolve, reject) => {
    const worker = workers.get(deviceId);
    if (worker) {
      worker.on('message', (message) => {
        const { type } = message;
        if (type == 'stopped') {
          Device.update(deviceId, { status: 2 });
          workers.delete(deviceId);
          resolve("stop success:" + deviceId);
        }
      });
      worker.postMessage({ type: 'stop' });
    } else {
      Device.update(deviceId, { status: 2 });
      emitDeviceReload();
      reject(new Error("设备未启动: " + deviceId));
    }
  })
}

const startAll = async () => {
  const devices = await Device.list();
  return Promise.all(devices.map(device => start(device.id)));
}

const stopAll = async () => {
  return Promise.all(workers.keys().map(deviceId => stop(deviceId)));
}

const clear = async () => {
  await stopAll();
  const devices = await Device.list();
  return Promise.all(devices.filter(device => device.status == 1)
    .map(device => Device.update(device.id, { status: 2 })));
}

const emitDeviceReload = () => {
  webContents.getAllWebContents().forEach(wc => {
    if (!wc.isDestroyed()) {
      wc.send('device:reload');
    }
  });
}

const emitMaterialReload = () => {
  webContents.getAllWebContents().forEach(wc => {
    if (!wc.isDestroyed()) {
      wc.send('material:reload');
    }
  });
}

module.exports = {
  start,
  stop,
  startAll,
  stopAll,
  clear
}
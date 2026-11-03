import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function hiddenMain(directory: string, lostStartReply = false) {
  const desktop = resolve('apps/desktop');
  const bootstrap = join(directory, 'hidden-main.cjs');
  await writeFile(
    bootstrap,
    `const electron = require('electron');
electron.app.getAppPath = () => ${JSON.stringify(desktop)};
electron.app.setPath('logs', ${JSON.stringify(directory)});
electron.dialog.showErrorBox = () => electron.app.exit(1);
${
  lostStartReply
    ? `let failedReads = 0;
const handle = electron.ipcMain.handle.bind(electron.ipcMain);
electron.ipcMain.handle = (channel, listener) => handle(channel, async (...args) => {
  if (channel === 'browser2d:application:workTasks.start') {
    failedReads = 2;
    return { ok: false, error: { code: 'UNAVAILABLE', message: 'Controlled response loss' } };
  }
  if (failedReads && ['browser2d:application:browsers.list', 'browser2d:application:workTasks.list'].includes(channel)) {
    failedReads--;
    return { ok: false, error: { code: 'UNAVAILABLE', message: 'Controlled refresh loss' } };
  }
  return listener(...args);
});`
    : ''
}
class HiddenBrowserWindow extends electron.BrowserWindow {
  constructor(options) {
    super({
      ...options,
      show: false,
      webPreferences: { ...options.webPreferences, offscreen: process.platform !== 'darwin' },
    });
  }
}
const Module = require('node:module');
const load = Module._load;
Module._load = function(request, ...args) {
  const value = load.call(this, request, ...args);
  return request === 'electron' ? { ...value, BrowserWindow: HiddenBrowserWindow } : value;
};
require(${JSON.stringify(join(desktop, 'dist/main/index.cjs'))});
`,
  );
  return bootstrap;
}

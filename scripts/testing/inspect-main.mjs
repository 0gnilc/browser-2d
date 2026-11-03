import { join } from 'node:path';

export function inspectionMainSource(desktop, control) {
  return `const electron = require('electron');
const { existsSync } = require('node:fs');
electron.app.getAppPath = () => ${JSON.stringify(desktop)};
electron.dialog.showErrorBox = () => electron.app.exit(1);
const exit = electron.app.exit.bind(electron.app);
electron.app.exit = (code) => exit(existsSync(${JSON.stringify(join(control, 'fail-stop'))}) ? 23 : code);
class HiddenBrowserWindow extends electron.BrowserWindow {
  constructor(options) { super({ ...options, show: false }); }
}
const Module = require('node:module');
const load = Module._load;
Module._load = function(request, ...args) {
  const value = load.call(this, request, ...args);
  return request === 'electron' ? { ...value, BrowserWindow: HiddenBrowserWindow } : value;
};
require(${JSON.stringify(join(desktop, 'dist/main/index.cjs'))});
`;
}

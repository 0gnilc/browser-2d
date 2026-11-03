import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const desktop = resolve('apps/desktop');
const require = createRequire(join(desktop, 'package.json'));

test('private verification failure exits with a redacted report and no native dialog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-release-'));
  const bootstrap = join(directory, 'main.cjs');
  const diagnostics = join(directory, 'diagnostics.json');
  await writeFile(
    bootstrap,
    `const electron = require('electron');
const { writeFileSync } = require('node:fs');
const diagnostics = { dialogs: [], visibility: [] };
const record = () => writeFileSync(${JSON.stringify(diagnostics)}, JSON.stringify(diagnostics));
electron.app.getAppPath = () => ${JSON.stringify(desktop)};
electron.app.setPath('logs', ${JSON.stringify(directory)});
electron.dialog.showErrorBox = (...args) => { diagnostics.dialogs.push(args); record(); };
const NativeBrowserWindow = electron.BrowserWindow;
class HiddenBrowserWindow extends NativeBrowserWindow {
  constructor(options) {
    diagnostics.visibility.push(options.show);
    record();
    super({ ...options, show: false });
    this.webContents.executeJavaScript = async () => {
      throw new Error('Deliberate private assertion: secret-test-value');
    };
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
  const child = spawn(
    require('electron'),
    [bootstrap, `--verify-workbench=${join(directory, 'report.json')}`],
    {
      env: { ...process.env, BROWSER2D_DATA_DIR: directory },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.on('data', (data: Buffer) => {
    stderr += data.toString();
  });
  try {
    await expect.poll(() => child.exitCode, { timeout: 30_000 }).toBe(1);
    const observed: unknown = JSON.parse(await readFile(diagnostics, 'utf8'));
    expect(observed).toEqual({ dialogs: [], visibility: [false] });
    const text = await readFile(join(directory, 'report.json'), 'utf8');
    expect(JSON.parse(text)).toMatchObject({ result: 'FAILED', exitCode: 1 });
    expect(text).not.toContain('secret-test-value');
    expect(stderr).not.toContain('secret-test-value');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

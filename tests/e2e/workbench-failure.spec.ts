import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const desktop = resolve('apps/desktop');
const require = createRequire(join(desktop, 'package.json'));

for (const mode of ['verification', 'startup', 'invalid-directory'] as const) {
  const verification = mode !== 'startup';
  test(
    mode === 'invalid-directory'
      ? 'private verification rejects an unguarded directory without a native dialog'
      : verification
        ? 'private verification failure exits with a redacted report and no native dialog'
        : 'interactive startup failure remains visible and localized',
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), mode === 'invalid-directory' ? 'browser-2d-ui-' : 'browser-2d-release-'),
      );
      const bootstrap = join(directory, 'main.cjs');
      const diagnostics = join(directory, 'diagnostics.json');
      await writeFile(
        bootstrap,
        `const electron = require('electron');
const { writeFileSync } = require('node:fs');
const diagnostics = { dialogs: [], visibility: [] };
const record = () => writeFileSync(${JSON.stringify(diagnostics)}, JSON.stringify(diagnostics));
record();
electron.app.getAppPath = () => ${JSON.stringify(desktop)};
electron.app.setPath('logs', ${JSON.stringify(directory)});
electron.dialog.showErrorBox = (...args) => { diagnostics.dialogs.push(args); record(); };
const NativeBrowserWindow = electron.BrowserWindow;
class HiddenBrowserWindow extends NativeBrowserWindow {
  constructor(options) {
    diagnostics.visibility.push(options.show);
    record();
    if (!${verification}) throw new Error('Deliberate startup failure: secret-test-value');
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
        [
          bootstrap,
          ...(verification ? [`--verify-workbench=${join(directory, 'report.json')}`] : []),
        ],
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
        if (mode === 'invalid-directory') {
          expect(observed).toEqual({ dialogs: [], visibility: [] });
          await expect(readFile(join(directory, 'data', 'app.sqlite'))).rejects.toMatchObject({
            code: 'ENOENT',
          });
          await expect(readFile(join(directory, 'report.json'))).rejects.toMatchObject({
            code: 'ENOENT',
          });
        } else if (verification) {
          expect(observed).toEqual({ dialogs: [], visibility: [false] });
          const text = await readFile(join(directory, 'report.json'), 'utf8');
          expect(JSON.parse(text)).toMatchObject({ result: 'FAILED', exitCode: 1 });
          expect(text).not.toContain('secret-test-value');
        } else {
          expect(observed).toEqual({
            dialogs: [['应用启动失败', expect.stringContaining('请查看日志后重试')]],
            visibility: [true],
          });
          expect(JSON.stringify(observed)).not.toContain('secret-test-value');
        }
        expect(stderr).not.toContain('secret-test-value');
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit');
          child.kill('SIGTERM');
          await exited;
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}

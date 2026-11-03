import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
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

for (const [target, hardlink] of [
  ['report.json', false],
  ['data', false],
  ['data/app.sqlite', false],
  ['data/app.sqlite-wal', false],
  ['data/app.sqlite-shm', false],
  ['data/app.sqlite-journal', false],
  ['data/worker-owners', false],
  ['data/execution-owners', false],
  ['credentials.enc', false],
  ['report.json', true],
  ['data/app.sqlite', true],
] as const) {
  test(`private verification rejects linked ${target}${hardlink ? ' (hardlink)' : ''} before DataService ownership or writes`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browser-2d-release-'));
    const victim = await mkdtemp(join(tmpdir(), 'browser-2d-victim-'));
    const diagnostics = join(directory, 'diagnostics.json');
    const bootstrap = join(directory, 'main.cjs');
    const victimDatabase = join(victim, 'app.sqlite');
    try {
      const database = new DatabaseSync(victimDatabase);
      database.exec(
        "CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('owned scratch only')",
      );
      database.close();
      const sentinel = join(victim, 'sentinel');
      await writeFile(sentinel, 'owned scratch sentinel');
      const before = await readFile(victimDatabase);
      await mkdir(join(directory, 'data'));
      const isDirectory = ['data', 'data/worker-owners', 'data/execution-owners'].includes(target);
      const source = isDirectory
        ? victim
        : target === 'data/app.sqlite'
          ? victimDatabase
          : sentinel;
      const destination = join(directory, target);
      if (target === 'data') await rm(destination, { recursive: true });
      if (isDirectory)
        await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir');
      else if (hardlink || process.platform === 'win32') await link(source, destination);
      else await symlink(source, destination, 'file');
      await writeFile(
        bootstrap,
        `const electron = require('electron');
const { writeFileSync } = require('node:fs');
const diagnostics = { dialogs: [], windows: 0, forks: 0 };
const record = () => writeFileSync(${JSON.stringify(diagnostics)}, JSON.stringify(diagnostics));
record();
electron.app.getAppPath = () => ${JSON.stringify(desktop)};
electron.app.setPath('logs', ${JSON.stringify(directory)});
electron.dialog.showErrorBox = (...args) => { diagnostics.dialogs.push(args); record(); };
const fork = electron.utilityProcess.fork;
electron.utilityProcess.fork = (...args) => { diagnostics.forks++; record(); return fork(...args); };
class HiddenBrowserWindow extends electron.BrowserWindow {
  constructor(options) {
    diagnostics.windows++;
    record();
    super({ ...options, show: false });
    this.webContents.executeJavaScript = async () => { throw new Error('Deliberate private assertion'); };
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
          stdio: 'ignore',
        },
      );
      try {
        await expect.poll(() => child.exitCode, { timeout: 30_000 }).toBe(1);
        expect.soft(await readFile(sentinel, 'utf8')).toBe('owned scratch sentinel');
        const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
        expect.soft(hash(await readFile(victimDatabase))).toBe(hash(before));
        expect.soft((await readdir(victim)).sort()).toEqual(['app.sqlite', 'sentinel']);
        expect
          .soft(JSON.parse(await readFile(diagnostics, 'utf8')))
          .toEqual({ dialogs: [], windows: 0, forks: 0 });
        if (target !== 'report.json')
          await expect(readFile(join(directory, 'report.json'))).rejects.toMatchObject({
            code: 'ENOENT',
          });
        if (!isDirectory)
          await expect(readFile(join(directory, 'data', 'worker-owners'))).rejects.toMatchObject({
            code: 'ENOENT',
          });
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit');
          child.kill('SIGTERM');
          await exited;
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(victim, { recursive: true, force: true });
    }
  });
}

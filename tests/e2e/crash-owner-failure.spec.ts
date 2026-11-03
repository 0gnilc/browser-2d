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

for (const [target, hardlink] of [
  ['.', false],
  ['app.sqlite', false],
  ['app.sqlite-wal', false],
  ['app.sqlite-shm', false],
  ['app.sqlite-journal', false],
  ['data-service-owners', false],
  ['execution-owners', false],
  ['provider-session.json', false],
  ['crashed.json', false],
  ['app.sqlite', true],
] as const) {
  test(`crash verification rejects linked ${target}${hardlink ? ' (hardlink)' : ''} before ownership or writes`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browser-2d-process-'));
    const victim = await mkdtemp(join(tmpdir(), 'browser-2d-victim-'));
    const root = join(directory, 'crash-pre-fork-intent');
    const diagnostics = join(directory, 'diagnostics.json');
    const bootstrap = join(directory, 'main.cjs');
    try {
      const victimDatabase = join(victim, 'app.sqlite');
      const database = new DatabaseSync(victimDatabase);
      database.exec('PRAGMA user_version = 0');
      database.close();
      const sentinel = join(victim, 'sentinel');
      await writeFile(sentinel, 'owned scratch sentinel');
      const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
      const before = hash(await readFile(victimDatabase));
      await mkdir(root);
      const isDirectory = ['.', 'data-service-owners', 'execution-owners'].includes(target);
      const source = isDirectory ? victim : target === 'app.sqlite' ? victimDatabase : sentinel;
      const destination = join(root, target);
      if (target === '.') await rm(root, { recursive: true });
      if (isDirectory)
        await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir');
      else if (hardlink || process.platform === 'win32') await link(source, destination);
      else await symlink(source, destination, 'file');
      await writeFile(
        bootstrap,
        `const electron = require('electron');
const { writeFileSync } = require('node:fs');
const diagnostics = { dialogs: [], windows: 0, forks: 0, pids: [] };
const record = () => writeFileSync(${JSON.stringify(diagnostics)}, JSON.stringify(diagnostics));
record();
electron.app.getAppPath = () => ${JSON.stringify(desktop)};
electron.app.setPath('logs', ${JSON.stringify(directory)});
electron.dialog.showErrorBox = (...args) => { diagnostics.dialogs.push(args); record(); };
const fork = electron.utilityProcess.fork;
electron.utilityProcess.fork = (...args) => {
  diagnostics.forks++; record();
  const child = fork(...args);
  child.on('spawn', () => { diagnostics.pids.push(child.pid); record(); });
  return child;
};
class HiddenBrowserWindow extends electron.BrowserWindow {
  constructor(options) { diagnostics.windows++; record(); super({ ...options, show: false }); }
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
          `--verify-task-owner=${JSON.stringify({ directory: root, point: 'pre-fork-intent' })}`,
        ],
        {
          env: { ...process.env, BROWSER2D_DATA_DIR: directory },
          stdio: 'ignore',
        },
      );
      try {
        await expect
          .poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 30_000 })
          .toBe(true);
        expect.soft(child.exitCode).toBe(1);
        const observed = JSON.parse(await readFile(diagnostics, 'utf8'));
        for (const pid of observed.pids) {
          await expect
            .poll(
              () => {
                try {
                  process.kill(pid, 0);
                  return false;
                } catch (error) {
                  if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
                    return true;
                  throw error;
                }
              },
              { timeout: 30_000 },
            )
            .toBe(true);
        }
        expect.soft(observed).toEqual({ dialogs: [], windows: 0, forks: 0, pids: [] });
        expect.soft(await readFile(sentinel, 'utf8')).toBe('owned scratch sentinel');
        expect.soft(hash(await readFile(victimDatabase))).toBe(before);
        expect.soft((await readdir(victim)).sort()).toEqual(['app.sqlite', 'sentinel']);
        if (target !== 'data-service-owners')
          await expect(readdir(join(root, 'data-service-owners'))).rejects.toMatchObject({
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

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import assert from 'node:assert/strict';

const desktop = resolve('apps/desktop');
const require = createRequire(join(desktop, 'package.json'));

const scenarios = [
  ...(
    [
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
    ] as const
  ).map(([target, hardlink]) => ({
    route: 'crash',
    target,
    hardlink,
  })),
  ...[
    '.',
    'proof.sqlite',
    'proof.sqlite-journal',
    'application',
    'application/app.sqlite',
    'application/data-service-owners',
    'data-service-crash',
    'crash-post-release-pre-unlink',
    'report.json',
  ].map((target) => ({ route: 'process', target, hardlink: false })),
  ...[
    '.',
    'data',
    'data/app.sqlite',
    'data/execution-owners',
    'credentials.enc',
    'report.json',
  ].map((target) => ({ route: 'adspower', target, hardlink: false })),
];
for (const { route, target, hardlink } of scenarios) {
  test(`${route} verification rejects linked ${target}${hardlink ? ' (hardlink)' : ''} before ownership or writes`, async () => {
    const directory = await mkdtemp(
      join(tmpdir(), route === 'adspower' ? 'browser-2d-adspower-' : 'browser-2d-process-'),
    );
    const victim = await mkdtemp(join(tmpdir(), 'browser-2d-victim-'));
    const root =
      route === 'crash'
        ? join(directory, 'crash-pre-fork-intent')
        : target === '.'
          ? join(tmpdir(), `${basename(directory)}-linked`)
          : directory;
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
      await mkdir(root, { recursive: true });
      if (target.includes('/')) await mkdir(join(root, target, '..'), { recursive: true });
      const isDirectory =
        [
          '.',
          'data',
          'application',
          'data-service-crash',
          'crash-post-release-pre-unlink',
        ].includes(target) || target.endsWith('owners');
      const source = isDirectory ? victim : target.endsWith('.sqlite') ? victimDatabase : sentinel;
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
const diagnostics = { dialogs: [], windows: 0, forks: 0, pids: [], execFiles: 0 };
const record = () => writeFileSync(${JSON.stringify(diagnostics)}, JSON.stringify(diagnostics));
record();
electron.app.getAppPath = () => ${JSON.stringify(desktop)};
electron.app.setPath('logs', ${JSON.stringify(directory)});
electron.dialog.showErrorBox = (...args) => { diagnostics.dialogs.push(args); record(); };
require('node:child_process').execFile = () => { diagnostics.execFiles++; record(); throw new Error('External commands are forbidden in storage rejection tests'); };
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
      const argument =
        route === 'crash'
          ? `--verify-task-owner=${JSON.stringify({ directory: root, point: 'pre-fork-intent' })}`
          : route === 'process'
            ? `--verify-task-processes=${join(root, 'report.json')}`
            : `--verify-adspower=${JSON.stringify({ reportPath: join(root, 'report.json'), apiBaseUrl: 'http://127.0.0.1:50325', profiles: ['owned-test-a', 'owned-test-b'], credentialService: 'io.github.0gnilc.browser2d.development.adspower', credentialAccount: 'browser-2d-development' })}`;
      const child = spawn(require('electron'), [bootstrap, argument], {
        env: { ...process.env, BROWSER2D_DATA_DIR: directory },
        stdio: 'ignore',
      });
      try {
        await expect
          .poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 30_000 })
          .toBe(true);
        expect.soft(child.exitCode).toBe(1);
        const observed: unknown = JSON.parse(await readFile(diagnostics, 'utf8'));
        assert(
          observed &&
            typeof observed === 'object' &&
            'pids' in observed &&
            Array.isArray(observed.pids),
        );
        for (const pid of observed.pids) {
          assert(typeof pid === 'number');
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
        expect
          .soft(observed)
          .toEqual({ dialogs: [], windows: 0, forks: 0, pids: [], execFiles: 0 });
        expect.soft(await readFile(sentinel, 'utf8')).toBe('owned scratch sentinel');
        expect.soft(hash(await readFile(victimDatabase))).toBe(before);
        expect.soft((await readdir(victim)).sort()).toEqual(['app.sqlite', 'sentinel']);
        if (route === 'crash' && target !== 'data-service-owners')
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
      if (route !== 'crash' && target === '.') await rm(root, { force: true });
      await rm(directory, { recursive: true, force: true });
      await rm(victim, { recursive: true, force: true });
    }
  });
}

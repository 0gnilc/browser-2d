import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { chromium, expect, test, type Browser } from '@playwright/test';
import { runnerImport } from 'vite';
import { workerOwnerSchema } from '../../packages/contracts/src/host';
import type { Device } from '../../packages/contracts/src/public';

function absent(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return true;
    throw error;
  }
}

async function terminate(pid: number) {
  if (absent(pid)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
  }
  await expect.poll(() => absent(pid), { timeout: 5000 }).toBe(true);
}

function development(args: string[], directory: string) {
  const child = spawn(process.execPath, args, {
    cwd: resolve('.'),
    env: { ...process.env, BROWSER2D_DATA_DIR: directory },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let exited = false;
  child.stdout.on('data', (data: Buffer) => (output += data.toString()));
  child.stderr.on('data', (data: Buffer) => (output += data.toString()));
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
    child.once('error', (error) => (output += `\n${error.message}\n`));
    child.once('close', (code, signal) => {
      exited = true;
      done({ code, signal });
    });
  });
  return {
    child,
    output: () => stripVTControlCharacters(output),
    async close(mode: 'stdin' | 'terminate') {
      if (!exited) {
        if (mode === 'stdin') child.stdin.write('stop\n');
        else child.kill();
      }
      try {
        await expect.poll(() => exited, { timeout: 22_000 }).toBe(true);
        return await exit;
      } finally {
        if (!exited) {
          child.kill('SIGKILL');
          await expect
            .poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 5000 })
            .toBe(true);
        }
      }
    },
  };
}

async function reachable(url: string) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

test('dev:ui serves fixture-only routes in Chrome and shuts down its server', async ({
  browserName: _browserName,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-ui-entry-'));
  const dev = development(['scripts/dev-ui.mjs'], directory);
  const workerRequire = createRequire(resolve('apps/worker/package.json'));
  let browser: Browser | undefined;
  let stopped = false;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.BROWSER2D_CHROME_EXECUTABLE ||
        (await workerRequire('puppeteer-core').executablePath('chrome')),
    });
    let url = '';
    await expect
      .poll(
        async () => {
          url = dev.output().match(/http:\/\/(?:localhost|127\.0\.0\.1):\d+\//)?.[0] ?? '';
          return !!url && (await reachable(url));
        },
        { timeout: 20_000, message: 'dev:ui did not serve its printed URL' },
      )
      .toBe(true);
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(url);
    await expect(page.getByTestId('controlled-mode')).toContainText(
      '界面预览 · 调度与业务功能不可用',
    );
    await expect(page.getByTestId('connection-status')).toHaveAttribute(
      'data-state',
      'unavailable',
    );
    await expect(page.getByTestId('worker-pid')).toHaveText('—');
    await expect(page.getByTestId('devices-error')).toContainText('UNAVAILABLE');
    await expect(page.getByTestId('start-run')).toBeDisabled();
    await page.getByTestId('refresh').click();
    await expect(page.getByRole('alert').filter({ hasText: '未连接调度器' })).toBeVisible();
    expect(
      await page.evaluate(async () => {
        const moduleUrl = '/src/fixture.ts';
        const fixture: typeof import('../../apps/ui/src/fixture') = await import(moduleUrl);
        return fixture.createFixtureBridge().work.getSnapshot();
      }),
    ).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    for (const route of ['devices', 'materials', 'history', 'settings']) {
      await page.getByTestId(`nav-${route}`).click();
      await expect(page.getByTestId('business-error')).toContainText('UNAVAILABLE');
      await expect(page.getByTestId('business-error')).toContainText('不连接业务数据库');
      await expect(page.getByTestId('connection-status')).toHaveAttribute(
        'data-state',
        'unavailable',
      );
    }
    expect(
      await page.evaluate(() => ({
        bridge: typeof window.browser2d,
        node: typeof Reflect.get(window, 'require'),
        process: typeof Reflect.get(window, 'process'),
      })),
    ).toMatchObject({ bridge: 'undefined', node: 'undefined', process: 'undefined' });
    expect(await page.evaluate(() => navigator.userAgent)).not.toContain('Electron');
    expect(pageErrors).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
    await dev.close('terminate');
    stopped = true;
    if (!dev.child.pid) throw new Error('dev:ui never received a PID');
    expect(absent(dev.child.pid)).toBe(true);
    await expect.poll(() => reachable(url), { timeout: 5000 }).toBe(false);
  } finally {
    try {
      await browser?.close();
    } finally {
      try {
        if (!stopped) await dev.close('terminate');
      } finally {
        await testInfo.attach('dev-ui-output', { body: dev.output(), contentType: 'text/plain' });
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
});

test('dev:worker starts without a window, drains on stdin stop and cold restarts the same database', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(150_000);
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-worker-entry-'));
  const owners = join(directory, 'worker-owners');
  let previousPid: number | undefined;
  let previousHash: string | undefined;
  let retainedDevice: Device | undefined;
  try {
    const { module: storage } = await runnerImport<
      typeof import('../../apps/worker/src/storage/open-business-store')
    >(resolve('apps/worker/src/storage/open-business-store.ts'), { configFile: false });
    for (let attempt = 1; attempt <= 2; attempt++) {
      const dev = development(['scripts/dev.mjs', '--worker-only', '--inspect-ui'], directory);
      let stopped = false;
      let owner: ReturnType<typeof workerOwnerSchema.parse> | undefined;
      try {
        await expect
          .poll(() => dev.output(), { timeout: 60_000 })
          .toMatch(/Worker ready\s+\{\s*pid:\s*\d+\s*\}/);
        const names = await readdir(owners);
        expect(names).toHaveLength(1);
        const name = names[0];
        if (!name) throw new Error('Ready worker has no owner record');
        owner = workerOwnerSchema.parse(JSON.parse(await readFile(join(owners, name), 'utf8')));
        const pid = owner.pid;
        if (!pid) throw new Error('Ready worker has no authorized PID');
        expect(Number(dev.output().match(/Worker ready\s+\{\s*pid:\s*(\d+)\s*\}/)?.[1])).toBe(pid);
        expect(absent(pid)).toBe(false);
        expect(absent(owner.hostPid)).toBe(false);
        expect(pid).not.toBe(previousPid);
        expect(pid).not.toBe(owner.hostPid);
        expect(owner.hostPid).not.toBe(dev.child.pid);
        let endpoint = '';
        await expect
          .poll(
            async () => {
              const port = (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split(
                '\n',
              )[0];
              endpoint = `http://127.0.0.1:${port}`;
              return reachable(`${endpoint}/json/version`);
            },
            { timeout: 10_000 },
          )
          .toBe(true);
        const response = await fetch(`${endpoint}/json/list`);
        expect(response.ok).toBe(true);
        const targets: unknown = await response.json();
        expect(targets).toEqual([]);
        expect(dev.output()).not.toMatch(/Local:\s+http:/);
        expect(await dev.close('stdin')).toEqual({ code: 0, signal: null });
        stopped = true;
        expect(absent(pid)).toBe(true);
        expect(absent(owner.hostPid)).toBe(true);
        if (!dev.child.pid) throw new Error('dev:worker never received a coordinator PID');
        expect(absent(dev.child.pid)).toBe(true);
        expect(await readdir(owners)).toEqual([]);
        await expect.poll(() => reachable(`${endpoint}/json/version`)).toBe(false);
        const { store } = await storage.openBusinessStore({
          path: join(directory, 'data.db'),
          nativeBinding: process.env.BROWSER2D_NATIVE_BINDING,
          confirmLegacy: async () => false,
          prepareLegacy: async () => {
            throw new Error('The development database must not contain legacy credentials');
          },
        });
        try {
          if (attempt === 1) {
            expect(store.devices.list()).toEqual({ ok: true, value: [] });
            const created = store.devices.create({
              symbol: `retention-${randomUUID()}`,
              account: 'synthetic-retention-account',
              amount: 123.45,
              count: 7,
              status: 2,
              note: 'Must survive the real dev:worker cold restart',
            });
            expect(created.ok).toBe(true);
            if (!created.ok) throw new Error(created.error.message);
            retainedDevice = created.value;
          }
          expect(store.devices.list()).toEqual({ ok: true, value: [retainedDevice] });
        } finally {
          store.close();
        }
        const database = await readFile(join(directory, 'data.db'));
        expect(database.subarray(0, 16).toString()).toBe('SQLite format 3\0');
        const hash = createHash('sha256').update(database).digest('hex');
        if (previousHash) expect(hash).toBe(previousHash);
        previousHash = hash;
        previousPid = pid;
      } finally {
        try {
          if (!stopped) await dev.close('stdin');
        } finally {
          const remaining = await readdir(owners).catch((error: unknown) => {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
            throw error;
          });
          const records = owner ? [owner] : [];
          for (const name of remaining) {
            records.push(
              workerOwnerSchema.parse(JSON.parse(await readFile(join(owners, name), 'utf8'))),
            );
          }
          for (const record of records) {
            for (const pid of [record.pid, record.hostPid]) {
              if (pid) await terminate(pid);
            }
          }
          await testInfo.attach(`dev-worker-output-${attempt}`, {
            body: dev.output(),
            contentType: 'text/plain',
          });
        }
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { chromium, expect, test, type Browser } from '@playwright/test';
import { absent } from './development-helper';

const require = createRequire(resolve('apps/backend/package.json'));

test('standalone UI uses the unavailable desktop boundary and preserves a rejected draft', async () => {
  const child = spawn(process.execPath, ['scripts/dev/dev-ui.mjs'], {
    env: { ...process.env, FORCE_COLOR: '1', NO_COLOR: undefined },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });
  child.stderr.on('data', (data: Buffer) => {
    output += data.toString();
  });
  const exited = once(child, 'exit');
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.BROWSER2D_CHROME_EXECUTABLE ||
        (await require('puppeteer-core').executablePath('chrome')),
      headless: true,
    });
    await expect
      .poll(() => stripVTControlCharacters(output))
      .toMatch(/http:\/\/127\.0\.0\.1:\d+\//);
    const url = stripVTControlCharacters(output).match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
    if (!url) throw new Error('Standalone UI URL missing');
    const page = await browser.newPage();
    await page.goto(url);
    await expect(page.getByTestId('connection-status')).toHaveAttribute(
      'data-state',
      'unavailable',
    );
    expect(await page.evaluate(() => typeof window.browser2d)).toBe('undefined');
    await page.getByTestId('browser-add').click();
    await page.getByLabel('环境 ID', { exact: true }).fill('standalone-unavailable');
    await page.getByTestId('browser-save').click();
    await expect(page.getByRole('alert').last()).toBeVisible();
    await expect(page.getByLabel('环境 ID', { exact: true })).toHaveValue('standalone-unavailable');
  } finally {
    await browser?.close();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  }
});

test('standalone backend starts DataService and exits it before its coordinator', async () => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-backend-only-'));
  const child = spawn(process.execPath, ['scripts/dev/dev.mjs', '--backend-only'], {
    env: { ...process.env, BROWSER2D_DATA_DIR: directory },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });
  child.stderr.on('data', (data: Buffer) => {
    output += data.toString();
  });
  const exited = once(child, 'exit');
  const closed = once(child, 'close');
  let pid: number | undefined;
  const failures: unknown[] = [];
  try {
    await expect
      .poll(
        async () => {
          try {
            const folder = join(directory, 'data', 'data-service-owners');
            const files = await readdir(folder);
            const file = files[0];
            if (!file) return false;
            const entry: unknown = JSON.parse(await readFile(join(folder, file), 'utf8'));
            if (
              !entry ||
              typeof entry !== 'object' ||
              !('pid' in entry) ||
              typeof entry.pid !== 'number'
            )
              return false;
            pid = entry.pid;
            return !absent(pid);
          } catch {
            return false;
          }
        },
        { timeout: 45_000, message: 'Standalone DataService never started' },
      )
      .toBe(true);
    const dataPid = pid;
    if (!dataPid) throw new Error('Standalone DataService PID missing');
    child.stdin.write('stop\n');
    const [code] = await exited;
    expect(code, output).toBe(0);
    expect(absent(dataPid)).toBe(true);
    expect(await readdir(join(directory, 'data', 'data-service-owners'))).toHaveLength(0);
  } catch (error) {
    failures.push(error);
  }
  try {
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.write('stop\n');
      await exited;
    }
    await closed;
    if (pid) expect(absent(pid), 'Standalone DataService must exit before cleanup').toBe(true);
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Standalone backend and cleanup failed');
});

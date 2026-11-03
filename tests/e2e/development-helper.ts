import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, type Browser, type TestInfo } from '@playwright/test';

export function absent(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return true;
    throw error;
  }
}
export async function developer(
  testInfo: TestInfo,
  sourcePath = 'apps/worker/src/work/controlled-driver.ts',
) {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-dev-restart-'));
  const source = resolve(sourcePath);
  const original = await readFile(source, 'utf8');
  const child = spawn(process.execPath, ['scripts/dev.mjs', '--inspect-ui'], {
    cwd: resolve('.'),
    env: { ...process.env, BROWSER2D_DATA_DIR: directory, BROWSER2D_EXECUTION: 'controlled' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });
  child.stderr.on('data', (data: Buffer) => {
    output += data.toString();
  });
  const exit = new Promise<number | null>((done, reject) => {
    child.once('exit', (code, signal) => {
      output += `\nCoordinator exited ${code ?? signal}\n`;
      done(code);
    });
    child.once('error', reject);
  });
  const browsers: Browser[] = [];
  async function page(previousPort?: string) {
    let port = '';
    await expect
      .poll(
        async () => {
          try {
            port =
              (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0] ?? '';
            if (!port || port === previousPort) return false;
            return (
              await fetch(`http://127.0.0.1:${port}/json/version`, {
                signal: AbortSignal.timeout(1000),
              })
            ).ok;
          } catch {
            return false;
          }
        },
        { timeout: 45_000, message: 'Development debugger never became ready' },
      )
      .toBe(true);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    browsers.push(browser);
    const context = browser.contexts()[0];
    if (!context) throw new Error('Development browser context missing');
    const page = context.pages()[0] ?? (await context.waitForEvent('page'));
    await page.waitForURL((url) => url.protocol === 'http:' && url.hostname === '127.0.0.1', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-state', 'connected', {
      timeout: 10_000,
    });
    return { page, port };
  }
  return {
    directory,
    source,
    original,
    page,
    output: () => output,
    async close() {
      child.stdin.write('stop\n');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          exit,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              child.kill();
              reject(new Error('Development coordinator did not exit'));
            }, 22_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        for (const browser of browsers) await browser.close().catch(() => undefined);
        if ((await readFile(source, 'utf8')) !== original) await writeFile(source, original);
        await testInfo.attach('development-output', { body: output, contentType: 'text/plain' });
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

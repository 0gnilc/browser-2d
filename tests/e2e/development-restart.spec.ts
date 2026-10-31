import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test, type Browser, type TestInfo } from '@playwright/test';

function absent(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return true;
    throw error;
  }
}
async function developer(
  testInfo: TestInfo,
  sourcePath = 'apps/worker/src/work/controlled-driver.ts',
) {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-dev-restart-'));
  const source = resolve(sourcePath);
  const original = await readFile(source, 'utf8');
  const child = spawn(process.execPath, ['scripts/dev.mjs', '--inspect-ui'], {
    cwd: resolve('.'),
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

test('real source rebuild preserves the old worker on build failure and replaces only after clean exit', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const dev = await developer(testInfo);
  let closed = false;
  try {
    const first = await dev.page();
    const oldPid = Number(await first.page.getByTestId('worker-pid').textContent());
    await writeFile(dev.source, `${dev.original}\nconst = invalid syntax;\n`);
    await expect.poll(() => dev.output(), { timeout: 30_000 }).toContain('exited 1');
    expect(absent(oldPid)).toBe(false);
    await expect(first.page.getByTestId('worker-pid')).toHaveText(String(oldPid));
    await first.page.getByTestId('create-fixture-device').click();
    await expect(first.page.getByTestId('start-run')).toBeEnabled();
    await first.page.getByTestId('start-run').click();
    await expect(first.page.getByTestId('run-table')).toContainText('运行中');
    await writeFile(dev.source, dev.original);
    const replacement = await dev.page(first.port);
    expect(absent(oldPid)).toBe(true);
    expect(Number(await replacement.page.getByTestId('worker-pid').textContent())).not.toBe(oldPid);
    const state = await replacement.page.evaluate(async () => window.browser2d?.work.getSnapshot());
    expect(state?.ok && state.value.runs.length).toBe(1);
    expect(
      state?.ok && state.value.runs.every((run) => ['completed', 'cancelled'].includes(run.state)),
    ).toBe(true);
    expect(state?.ok && state.value.resources).toEqual([]);
    expect(await dev.close()).toBe(0);
    closed = true;
  } finally {
    if (!closed) await dev.close();
  }
});

test('development restart refuses to replace an unresponsive predecessor after forced shutdown', async ({
  browserName: _browserName,
}, testInfo) => {
  test.skip(
    process.platform === 'win32',
    'Portable uncooperative execution is covered in scheduler.spec; this case suspends the entire POSIX worker',
  );
  test.setTimeout(120_000);
  const dev = await developer(testInfo);
  let pid: number | undefined;
  let closed = false;
  try {
    const initial = await dev.page();
    pid = Number(await initial.page.getByTestId('worker-pid').textContent());
    process.kill(pid, 'SIGSTOP');
    await writeFile(dev.source, `${dev.original}\n`);
    await expect
      .poll(() => dev.output(), { timeout: 30_000 })
      .toContain('Development shutdown exited 1');
    expect(absent(pid)).toBe(true);
    const port = (await readFile(join(dev.directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    expect(port).toBe(initial.port);
    expect(await readdir(join(dev.directory, 'worker-owners'))).toEqual([]);
    expect(await dev.close()).toBe(1);
    closed = true;
  } finally {
    if (pid && !absent(pid)) process.kill(pid, 'SIGKILL');
    if (!closed) await dev.close();
  }
});

test('shared TypeScript preset changes restart only after the previous worker exits', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const dev = await developer(testInfo, 'internal/tsconfig/base.json');
  let closed = false;
  try {
    const first = await dev.page();
    const previousPid = Number(await first.page.getByTestId('worker-pid').textContent());
    await writeFile(dev.source, `${dev.original}\n`);
    const replacement = await dev.page(first.port);
    expect(absent(previousPid)).toBe(true);
    expect(Number(await replacement.page.getByTestId('worker-pid').textContent())).not.toBe(
      previousPid,
    );
    expect(await dev.close()).toBe(0);
    closed = true;
  } finally {
    if (!closed) await dev.close();
  }
});

test('renderer preset changes reach the live page after coordinated restart', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const dev = await developer(testInfo, 'internal/build-config/index.mjs');
  let closed = false;
  try {
    const first = await dev.page();
    const previousPid = Number(await first.page.getByTestId('worker-pid').textContent());
    await expect(first.page.locator('meta[name="development-config-proof"]')).toHaveCount(0);
    expect(dev.original).toContain('plugins: [vue()]');
    await writeFile(
      dev.source,
      dev.original.replace(
        'plugins: [vue()]',
        `plugins: [vue(), {
      name: 'development-config-proof',
      transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'development-config-proof', content: 'changed' }, injectTo: 'head' }],
    }]`,
      ),
    );
    const replacement = await dev.page(first.port);
    await expect(replacement.page.locator('meta[name="development-config-proof"]')).toHaveAttribute(
      'content',
      'changed',
    );
    expect(absent(previousPid)).toBe(true);
    expect(Number(await replacement.page.getByTestId('worker-pid').textContent())).not.toBe(
      previousPid,
    );
    expect(await dev.close()).toBe(0);
    closed = true;
  } finally {
    if (!closed) await dev.close();
  }
});

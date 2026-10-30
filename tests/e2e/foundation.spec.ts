import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const desktop = resolve('apps/desktop');
const require = createRequire(join(desktop, 'package.json'));

function terminateFixtureProcess(pid: number | undefined) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
  }
}

test('UI, isolated preload, real worker, SQLite persistence and graceful shutdown', async ({
  browserName: _browserName,
}, testInfo) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'browser-2d-e2e-'));
  const launch = () =>
    electron.launch({
      executablePath: require('electron'),
      args: [desktop],
      env: { ...process.env, BROWSER2D_DATA_DIR: dataDir },
    });
  let application = await launch();
  try {
    const page = await application.firstWindow();
    await expect(page.getByTestId('start-run')).toBeEnabled();
    expect(
      await page.evaluate(() => ({
        node: typeof globalThis.require,
        process: typeof globalThis.process,
      })),
    ).toEqual({ node: 'undefined', process: 'undefined' });
    const untrusted = await application.evaluate(
      async ({ BrowserWindow }, preload) => {
        const trusted = BrowserWindow.getAllWindows()[0];
        if (!trusted) throw new Error('Main window missing');
        const other = new BrowserWindow({
          show: false,
          webPreferences: {
            preload,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        await other.loadURL('data:text/html,untrusted');
        const result: unknown = await other.webContents.executeJavaScript(
          'window.browser2d.getSnapshot()',
        );
        other.destroy();
        return result;
      },
      join(desktop, 'dist/preload/index.cjs'),
    );
    expect(untrusted).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'Untrusted application frame' },
    });
    await page.getByTestId('device-id').fill(`fixture-${randomUUID()}`);
    await page.getByTestId('duration-ms').fill('30000');
    await page.getByTestId('start-run').click();
    await expect(page.getByTestId('run-table')).toContainText('运行中');
    await page.locator('[data-testid^="cancel-"]').first().click();
    await expect(page.getByTestId('run-table')).toContainText('已取消');
    const before = await page.evaluate(async () => {
      if (!window.browser2d) throw new Error('Preload API missing');
      return window.browser2d.getSnapshot();
    });
    expect(before.ok).toBe(true);
    await page.getByTestId('start-run').click();
    await expect(page.locator('[data-testid^="cancel-"]').first()).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('foundation.png'), fullPage: true });
    const launchedProcess = application.process();
    const exited = application.waitForEvent('close');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await exited;
    expect(launchedProcess.exitCode).toBe(0);
    application = await launch();
    const reopened = await application.firstWindow();
    await expect(reopened.getByTestId('run-table')).toContainText('已取消');
    const after = await reopened.evaluate(async () => {
      if (!window.browser2d) throw new Error('Preload API missing');
      return window.browser2d.getSnapshot();
    });
    expect(after.ok && after.value.runs.length).toBe(2);
    expect(after.ok && after.value.runs.every((run) => run.state === 'cancelled')).toBe(true);
  } finally {
    await application.close().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('worker crash fails shutdown and recovery never resumes the interrupted task', async ({
  browserName: _browserName,
}) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'browser-2d-e2e-'));
  const launch = () =>
    electron.launch({
      executablePath: require('electron'),
      args: [desktop],
      env: { ...process.env, BROWSER2D_DATA_DIR: dataDir },
    });
  let application = await launch();
  try {
    const page = await application.firstWindow();
    await expect(page.getByTestId('start-run')).toBeEnabled();
    await page.getByTestId('duration-ms').fill('30000');
    await page.getByTestId('start-run').click();
    await expect(page.getByTestId('run-table')).toContainText('运行中');
    const pid = Number(await page.getByTestId('worker-pid').textContent());
    await application.evaluate((_, workerPid) => {
      process.kill(workerPid, 'SIGKILL');
    }, pid);
    await page.getByTestId('refresh').click();
    await expect(page.getByTestId('connection-status')).toHaveAttribute(
      'data-state',
      'unavailable',
    );
    const launchedProcess = application.process();
    const exited = application.waitForEvent('close');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await exited;
    expect(launchedProcess.exitCode).toBe(1);
    application = await launch();
    const recovered = await application.firstWindow();
    await expect(recovered.getByTestId('run-table')).toContainText('已中断');
    await expect(recovered.locator('[data-state="running"]')).toHaveCount(0);
  } finally {
    await application.close().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('unresponsive worker cannot be reported as a clean shutdown', async ({
  browserName: _browserName,
}) => {
  test.skip(
    process.platform === 'win32',
    'Windows has no POSIX stop signal; crash recovery is covered separately',
  );
  test.setTimeout(25_000);
  const dataDir = await mkdtemp(join(tmpdir(), 'browser-2d-e2e-'));
  const application = await electron.launch({
    executablePath: require('electron'),
    args: [desktop],
    env: { ...process.env, BROWSER2D_DATA_DIR: dataDir },
  });
  let workerPid: number | undefined;
  try {
    const page = await application.firstWindow();
    await expect(page.getByTestId('start-run')).toBeEnabled();
    const pid = Number(await page.getByTestId('worker-pid').textContent());
    workerPid = pid;
    await application.evaluate((_, pid) => {
      process.kill(pid, 'SIGSTOP');
    }, workerPid);
    const launchedProcess = application.process();
    const exited = application.waitForEvent('close');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await exited;
    expect(launchedProcess.exitCode).toBe(1);
    try {
      process.kill(pid, 0);
      throw new Error('Worker still exists');
    } catch (error) {
      expect(error).toMatchObject({ code: 'ESRCH' });
    }
  } finally {
    terminateFixtureProcess(workerPid);
    await application.close().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  }
});

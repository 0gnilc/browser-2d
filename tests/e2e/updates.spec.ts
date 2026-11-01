import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
const desktop = resolve('apps/desktop');
const require = createRequire(join(desktop, 'package.json'));
test('update API stays manual and disabled in development and rejects untrusted frames', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-updates-e2e-'));
  const application = await electron.launch({
    executablePath: require('electron'),
    args: [desktop],
    env: { ...process.env, BROWSER2D_DATA_DIR: directory, BROWSER2D_EXECUTION: 'controlled' },
  });
  try {
    const page = await application.firstWindow();
    const observed = await page.evaluate(async () => {
      const api = window.browser2d;
      if (!api) throw new Error('Preload missing');
      const state = await api.updates.getState();
      const checked = await api.updates.check();
      const downloaded = await api.updates.download();
      const installed = await api.updates.install();
      return {
        state,
        checked,
        downloaded,
        installed,
        methods: Object.keys(api.updates).sort(),
        node: typeof globalThis.require,
        process: typeof globalThis.process,
      };
    });
    expect(observed.state).toMatchObject({
      ok: true,
      value: { status: 'unavailable', reason: 'development', revision: 0 },
    });
    for (const result of [observed.checked, observed.downloaded, observed.installed])
      expect(result).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    expect(observed.methods).toEqual(['check', 'download', 'getState', 'install', 'subscribe']);
    expect(observed.node).toBe('undefined');
    expect(observed.process).toBe('undefined');
    const untrusted = await application.evaluate(
      async ({ BrowserWindow }, preload) => {
        const other = new BrowserWindow({
          show: false,
          webPreferences: {
            preload,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        try {
          await other.loadURL('data:text/html,untrusted');
          return await other.webContents.executeJavaScript(
            'Promise.all([window.browser2d.updates.getState(), window.browser2d.updates.check(), window.browser2d.updates.download(), window.browser2d.updates.install()])',
          );
        } finally {
          other.destroy();
        }
      },
      join(desktop, 'dist/preload/index.cjs'),
    );
    for (const result of untrusted)
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});

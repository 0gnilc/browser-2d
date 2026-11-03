import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { app, BrowserWindow, utilityProcess } from 'electron';
import { z } from 'zod';
import type { Browser2dApi } from '@browser-2d/contracts/public';
import type { SessionFingerprint } from '@browser-2d/contracts/host';
import type { BrowserPlatform } from '../main/browser-platforms/adspower';
import { superviseTask, type TaskOptions } from '../main/task-supervisor';
import { isolatedProcessEnvironment } from '../main/isolated-process-environment';

declare global {
  interface Window {
    browser2d?: Browser2dApi;
  }
}

export async function workbenchVerification(reportPath: string, dataDir: string) {
  const directory = await realpath(dirname(resolve(reportPath)));
  const suffix = relative(await realpath(tmpdir()), directory);
  const segments = suffix.split(/[\\/]/);
  assert(!isAbsolute(suffix) && !segments.includes('..'));
  assert(
    (segments.length === 1 && suffix.startsWith('browser-2d-release-')) ||
      (segments.length === 2 &&
        segments[0]?.startsWith('browser-2d-default-') &&
        segments[1] === app.getName() &&
        !process.env.BROWSER2D_DATA_DIR),
  );
  assert.equal(basename(reportPath), 'report.json');
  assert.equal(await realpath(dataDir), directory);
  const require = createRequire(join(app.getAppPath(), 'package.json'));
  const entry = join(
    dirname(require.resolve('@browser-2d/backend/browser-worker')),
    'verification/card-worker.cjs',
  );
  const sessions = new Map<string, SessionFingerprint>();
  const platform: BrowserPlatform = {
    inspect: async (id) =>
      sessions.has(id)
        ? { kind: 'active', endpoint: sessions.get(id)?.endpoint ?? null }
        : { kind: 'inactive' },
    async start(id) {
      const nonce = randomUUID();
      const session = {
        endpoint: `ws://127.0.0.1:1/devtools/browser/${nonce}`,
        browserTargetId: nonce,
      };
      sessions.set(id, session);
      return { kind: 'opened', session };
    },
    async closeOwned({ profileId, session }) {
      assert.equal(sessions.get(profileId)?.endpoint, session.endpoint);
      sessions.delete(profileId);
      return { kind: 'closed', session };
    },
  };
  let outcome: unknown;
  let workerEntry = '';
  return {
    dataEntry: join(dirname(entry), 'application-data-service.cjs'),
    connection: async () => ({
      apiBaseUrl: 'http://127.0.0.1:1',
      apiKey: 'private-workbench-fixture',
    }),
    platform: () => platform,
    spawn(task: TaskOptions) {
      const child = utilityProcess.fork(entry, ['hold'], {
        env: isolatedProcessEnvironment('verification'),
      });
      return superviseTask(child, entry, task);
    },
    async run(window: BrowserWindow, backendEntry: string) {
      workerEntry = backendEntry;
      const result: unknown = await window.webContents.executeJavaScript(
        `(${rendererVerification.toString()})()`,
      );
      outcome = z
        .strictObject({
          initialBrowsers: z.number().int().nonnegative(),
          initialCards: z.number().int().nonnegative(),
          nodeIsolation: z.literal(true),
          rawCard: z.literal(true),
          persisted: z.literal(true),
          taskPath: z.literal(true),
          queued: z.literal(true),
          inputLocked: z.literal(true),
          sidebarCollapsed: z.boolean(),
        })
        .parse(result);
      const foreign = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: join(__dirname, '../preload/index.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      try {
        await foreign.loadURL('data:text/html,foreign');
        const denied: unknown = await foreign.webContents.executeJavaScript(
          'window.browser2d.browsers.list()',
        );
        assert(
          z
            .object({ ok: z.literal(false), error: z.object({ code: z.literal('INVALID_INPUT') }) })
            .safeParse(denied).success,
        );
      } finally {
        foreign.destroy();
      }
    },
    async report(exitCode: number) {
      const verified = exitCode === 0 && !!outcome && sessions.size === 0;
      await writeFile(
        reportPath,
        JSON.stringify(
          {
            result: verified ? 'VERIFIED' : 'FAILED',
            appName: app.getName(),
            appVersion: app.getVersion(),
            packaged: app.isPackaged,
            platform: process.platform,
            arch: process.arch,
            versions: process.versions,
            userData: app.getPath('userData'),
            appData: app.getPath('appData'),
            dataOverride: Boolean(process.env.BROWSER2D_DATA_DIR),
            dataPath: join(dataDir, 'data', 'app.sqlite'),
            rendererUrl: 'app://ui/index.html',
            workerEntry,
            ...(verified
              ? { workerExited: true }
              : { failure: 'Workbench verification or cleanup did not complete' }),
            exitCode: verified ? 0 : 1,
            checks: outcome,
          },
          null,
          2,
        ),
      );
      assert(exitCode !== 0 || verified, 'Workbench verification or cleanup did not complete');
    },
  };
}

async function rendererVerification() {
  const api = window.browser2d;
  if (!api) throw new Error('Preload missing');
  function check(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
  }
  async function until(checkValue: () => boolean | Promise<boolean>) {
    const deadline = Date.now() + 15_000;
    while (!(await checkValue())) {
      if (Date.now() > deadline) throw new Error('Workbench condition timed out');
      await new Promise((done) => setTimeout(done, 20));
    }
  }
  function click(selector: string) {
    const element = document.querySelector(selector);
    check(element instanceof HTMLElement, `Missing ${selector}`);
    element.click();
  }
  function input(selector: string, value: string) {
    const element = document.querySelector(selector);
    check(
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement,
      `Missing ${selector}`,
    );
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
  check(
    typeof globalThis.require === 'undefined' && typeof globalThis.process === 'undefined',
    'Renderer Node isolation',
  );
  const initial = await api.browsers.list();
  const cards = await api.cards.list({ page: 1, pageSize: 20 });
  check(initial.ok && cards.ok, 'Initial reads');
  check(
    initial.value.every(
      (browser) =>
        browser.provider === 'adspower' &&
        /^verify-\d+(?:-queued)?$/.test(browser.profileId) &&
        ['Installed Browser', 'Queued Browser'].includes(browser.name),
    ),
    'Workbench requires synthetic Browsers',
  );
  for (const existing of cards.value.items)
    check((await api.cards.remove({ id: existing.id })).ok, 'Prior verification Card cleanup');
  await until(
    () =>
      document.querySelector('[data-testid="connection-status"]')?.getAttribute('data-state') ===
      'connected',
  );
  click('[data-testid="browser-add"]');
  await until(() => !!document.querySelector('#browser-profile'));
  const profileId = `verify-${initial.value.length}`;
  input('#browser-profile', profileId);
  input('#browser-name', 'Installed Browser');
  input('#browser-account', 'full account input');
  input('#browser-amount', '12.34');
  click('[data-testid="browser-save"]');
  await until(async () => {
    const result = await api.browsers.list();
    return result.ok && result.value.some((row) => row.profileId === profileId);
  });
  click('[data-testid="nav-cards"]');
  await until(() => !!document.querySelector('[data-testid="card-import-open"]'));
  click('[data-testid="card-import-open"]');
  await until(() => !!document.querySelector('#card-import-text'));
  const number = `000${cards.value.total} 1234-5678`;
  input(
    '#card-import-text',
    ` ${number} | 01 | 29 | 007 | 姓名 |  1 Main St  | Lagos | LA | 0010 | NG | extra `,
  );
  await new Promise((done) => setTimeout(done, 0));
  click('[data-testid="card-import-submit"]');
  await until(() => document.body.textContent?.includes('已插入 1') ?? false);
  const imported = await api.cards.list({ page: 1, pageSize: 100, search: number });
  check(imported.ok && imported.value.items.length === 1, 'Raw Card persisted');
  const card = imported.value.items[0];
  check(
    card &&
      card.number === number &&
      card.securityCode === '007' &&
      card.billingAddress === '1 Main St' &&
      card.cardholderName === '姓名',
    'Raw Card fields',
  );
  input('#card-import-text', '');
  await new Promise((done) => setTimeout(done, 0));
  const close = Array.from(document.querySelectorAll('.el-drawer button')).find(
    (button) => button.textContent?.trim() === '关闭',
  );
  check(close instanceof HTMLElement, 'Import close');
  close.click();
  await until(() => !document.querySelector('#card-import-text'));
  const browsers = await api.browsers.list();
  check(browsers.ok, 'Browser saved');
  const browser = browsers.value.find((row) => row.profileId === profileId);
  check(
    browser && browser.account === 'full account input' && browser.amount === '12.34',
    'Complete Browser input',
  );
  const settings = await api.settings.get();
  check(settings.ok, 'Settings read');
  click('[data-testid="nav-settings"]');
  await until(() => !!document.querySelector('#settings-concurrency'));
  input('#settings-concurrency', '1');
  document
    .querySelector('#settings-concurrency')
    ?.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((done) => setTimeout(done, 0));
  click('[data-testid="settings-save"]');
  await until(async () => {
    const result = await api.settings.get();
    return (
      result.ok &&
      result.value.revision > settings.value.revision &&
      result.value.values.maxConcurrentTasks === 1
    );
  });
  const second = await api.browsers.create({
    provider: 'adspower',
    profileId: `${profileId}-queued`,
    name: 'Queued Browser',
    account: '',
    amount: '0.00',
    notes: '',
  });
  check(second.ok, 'Second Browser');
  click('[data-testid="nav-browsers"]');
  await until(() => !!document.querySelector('[data-testid="browsers-table"]'));
  const start = await api.workTasks.start({ browserId: browser.id });
  check(start.ok, 'Task start');
  await until(async () => {
    const result = await api.cards.list({ page: 1, pageSize: 100, search: number });
    const current = result.ok && result.value.items[0];
    return (
      !!current &&
      current.status === 'processing' &&
      current.inputLocked &&
      current.amount === '1.00'
    );
  });
  const queued = await api.workTasks.start({ browserId: second.value.id });
  check(queued.ok && queued.value.state === 'queued', 'Task queue');
  const stopQueued = await api.workTasks.stop({ browserId: second.value.id });
  check(stopQueued.ok, 'Stop queued');
  const stop = await api.workTasks.stop({ browserId: browser.id });
  check(stop.ok, 'Task stop');
  await until(async () => {
    const result = await api.workTasks.list();
    return result.ok && result.value.length === 0;
  });
  const after = await api.cards.list({ page: 1, pageSize: 100, search: number });
  check(
    after.ok &&
      after.value.items[0]?.status === 'pending' &&
      after.value.items[0].inputLocked &&
      after.value.items[0].amount === '1.00',
    'Stop preserves committed values and input lock',
  );
  click('[data-testid="sidebar-toggle"]');
  await until(async () => {
    const result = await api.settings.get();
    return (
      result.ok && result.value.values.sidebarCollapsed !== settings.value.values.sidebarCollapsed
    );
  });
  return {
    initialBrowsers: initial.value.length,
    initialCards: cards.value.total,
    nodeIsolation: true,
    rawCard: true,
    persisted: true,
    taskPath: true,
    queued: true,
    inputLocked: true,
    sidebarCollapsed: !settings.value.values.sidebarCollapsed,
  };
}

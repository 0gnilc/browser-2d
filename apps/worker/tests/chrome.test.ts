import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer, { Browser, type BrowserContext, type Target } from 'puppeteer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { secretRefSchema } from '@browser-2d/contracts/host';
import type { Result, SettingsValues } from '@browser-2d/contracts/public';
import { createChromeDriver } from '../src/browser/chrome-driver';
import { openBusinessStore } from '../src/storage/open-business-store';
import { createWorkService } from '../src/work/service';

const executablePath =
  process.env.BROWSER2D_CHROME_EXECUTABLE ?? (await puppeteer.executablePath('chrome'));
const cleanups: (() => Promise<void>)[] = [];
const poll = { timeout: 15_000, interval: 50 };

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

async function localPages() {
  const visits: string[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? '/';
    visits.push(path);
    if (path === '/hang' || path === '/json/version') return;
    if (path === '/redirect') {
      response.writeHead(302, { Location: 'http://192.0.2.1:9/never-load' });
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Local Chrome probe</title><main>Local probe ready</main>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Local fixture has no port');
  return { origin: `http://127.0.0.1:${address.port}`, visits };
}

async function chrome() {
  await access(executablePath, constants.X_OK);
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-chrome-harness-'));
  let browser: Browser;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      userDataDir: directory,
      args: ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  cleanups.push(async () => {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  });
  const endpoint = new URL(browser.wsEndpoint());
  return { browser, endpoint: `http://127.0.0.1:${endpoint.port}` };
}

async function subject({
  browser,
  pageCount = 2,
  url,
  durationMs = 20_000,
  executionTimeoutMs = 30_000,
}: {
  browser: SettingsValues['browser'];
  pageCount?: number;
  url: string;
  durationMs?: number;
  executionTimeoutMs?: number;
}) {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-chrome-work-'));
  const database = await openBusinessStore({
    path: join(directory, 'data.db'),
    execution: 'chrome',
    confirmLegacy: async () => true,
    prepareLegacy: async () => secretRefSchema.parse(randomUUID()),
    verifyCredential: async () => undefined,
  });
  function configure(patch: Partial<SettingsValues>) {
    const settings = value(database.store.settings.get());
    return value(
      database.store.settings.commit({
        values: {
          browser: settings.browser,
          pageCount: settings.pageCount,
          viewportWidth: settings.viewportWidth,
          viewportHeight: settings.viewportHeight,
          ...patch,
        },
        expectedRevision: settings.revision,
      }),
    );
  }
  configure({ browser, pageCount, viewportWidth: 800, viewportHeight: 600 });
  const root = join(directory, 'chrome-sessions');
  const service = createWorkService({
    repository: database.work,
    driver: createChromeDriver({ root, journal: database.work.chrome, probe: { url, durationMs } }),
    publish: () => undefined,
    policy: { executionTimeoutMs, cleanupTimeoutMs: 10_000, cleanupAttempts: 3 },
  });
  const observers: Browser[] = [];
  cleanups.push(async () => {
    try {
      await service.stop();
    } finally {
      await Promise.all(
        observers.map(async (observer) => {
          if (observer.connected) await observer.close();
        }),
      );
      database.store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  return {
    root,
    database,
    service,
    configure,
    observers,
    start(symbol: string) {
      const deviceId = value(database.store.devices.create({ symbol })).id;
      const runId = value(service.start({ commandId: randomUUID(), deviceId })).runId;
      return { deviceId, runId };
    },
    cancel(runId: string) {
      return value(service.cancel({ commandId: randomUUID(), runId }));
    },
    state(runId: string) {
      return service.snapshot().runs.find((run) => run.id === runId)?.state;
    },
  };
}

async function workContexts(browser: Browser) {
  const observer = await puppeteer.connect({
    browserWSEndpoint: browser.wsEndpoint(),
    defaultViewport: null,
  });
  cleanups.push(async () => {
    await observer.disconnect();
  });
  return observer.browserContexts().filter((context) => context.id !== undefined);
}

async function loadedContexts(browser: Browser, count: number) {
  const session = await browser.target().createCDPSession();
  try {
    await expect
      .poll(async () => {
        const { browserContextIds } = await session.send('Target.getBrowserContexts');
        const { targetInfos } = await session.send('Target.getTargets');
        return targetInfos.filter(
          (target) =>
            target.type === 'page' &&
            target.browserContextId !== undefined &&
            browserContextIds.includes(target.browserContextId) &&
            target.url.startsWith('http://127.0.0.1:'),
        ).length;
      }, poll)
      .toBe(count);
  } finally {
    await session.detach();
  }
  return workContexts(browser);
}

async function viewport(context: BrowserContext) {
  const [page] = await context.pages();
  if (!page) throw new Error('Chrome work context has no page');
  return z
    .object({ width: z.number(), height: z.number() })
    .parse(await page.evaluate('({ width: innerWidth, height: innerHeight })'));
}

async function portFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return portFiles(path);
        return entry.name === 'DevToolsActivePort' ? [path] : [];
      }),
    )
  ).flat();
}

async function ownedObserver(root: string) {
  await expect.poll(async () => (await portFiles(root)).length, poll).toBe(1);
  const [path] = await portFiles(root);
  if (!path) throw new Error('Owned Chrome discovery file missing');
  const [port, websocketPath] = (await readFile(path, 'utf8')).trim().split('\n');
  if (!port || !websocketPath) throw new Error('Owned Chrome discovery file invalid');
  const browser = await puppeteer.connect({
    browserWSEndpoint: `ws://127.0.0.1:${port}${websocketPath}`,
    defaultViewport: null,
  });
  const session = await browser.target().createCDPSession();
  const { arguments: args } = await session.send('Browser.getBrowserCommandLine');
  expect(args).toContain(`--user-data-dir=${dirname(path)}`);
  const { processInfo } = await session.send('SystemInfo.getProcessInfo');
  await session.detach();
  const processInfoBrowser = processInfo.find((entry) => entry.type === 'browser');
  if (!processInfoBrowser) throw new Error('Chrome browser process identity missing');
  return { browser, pid: processInfoBrowser.id };
}

afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Chrome test cleanup failed');
});

describe('real Chrome execution with local pages', () => {
  it('keeps the borrowed default page, cookies, storage and business rows unchanged', async () => {
    const fixture = await localPages();
    const harness = await chrome();
    const sentinel = await harness.browser.newPage();
    await sentinel.goto(`${fixture.origin}/sentinel`);
    await sentinel.evaluate(() => localStorage.setItem('sentinel', 'preserve-me'));
    await sentinel.evaluate("document.cookie = 'sentinel=preserve-me; path=/'");
    const worker = await subject({
      browser: { mode: 'connect', endpoint: harness.endpoint },
      url: `${fixture.origin}/probe`,
    });
    const material = value(
      worker.database.store.materials.create({
        card: '4000000000000002',
        month: '12',
        year: '2030',
        cvv: '123',
      }),
    );
    const beforeMaterials = value(worker.database.store.materials.page());
    const beforeHistory = value(worker.database.store.history.page());
    const { runId } = worker.start('borrowed');
    const contexts = await loadedContexts(harness.browser, 2);
    expect(contexts).toHaveLength(1);
    const context = contexts[0];
    if (!context) throw new Error('Chrome work context missing');
    expect(await viewport(context)).toEqual({ width: 800, height: 600 });
    expect((await context.cookies()).find((cookie) => cookie.name === 'sentinel')).toBeUndefined();
    worker.cancel(runId);
    await expect.poll(() => worker.state(runId), poll).toBe('cancelled');
    expect(worker.service.snapshot().resources).toEqual([]);
    expect(await workContexts(harness.browser)).toEqual([]);
    expect(harness.browser.connected).toBe(true);
    expect(sentinel.isClosed()).toBe(false);
    expect(await sentinel.evaluate(() => localStorage.getItem('sentinel'))).toBe('preserve-me');
    expect(
      (await harness.browser.defaultBrowserContext().cookies()).find(
        (cookie) => cookie.name === 'sentinel',
      )?.value,
    ).toBe('preserve-me');
    expect(value(worker.database.store.materials.page())).toEqual(beforeMaterials);
    expect(value(worker.database.store.history.page())).toEqual(beforeHistory);
    expect(value(worker.database.store.materials.page()).items[0]?.id).toBe(material.id);
  }, 30_000);

  it('reserves two devices and four actual pages and freezes a queued run settings', async () => {
    const fixture = await localPages();
    const harness = await chrome();
    const replacement = await chrome();
    const worker = await subject({
      browser: { mode: 'connect', endpoint: harness.endpoint },
      url: `${fixture.origin}/probe`,
    });
    const first = worker.start('first');
    const second = worker.start('second');
    const third = worker.start('third');
    await loadedContexts(harness.browser, 4);
    expect(await workContexts(harness.browser)).toHaveLength(2);
    expect(worker.state(first.runId)).toBe('running');
    expect(worker.state(second.runId)).toBe('running');
    expect(worker.state(third.runId)).toBe('queued');
    const frozen = worker.service.snapshot().runs.find((run) => run.id === third.runId)?.config;
    worker.configure({
      browser: { mode: 'connect', endpoint: replacement.endpoint },
      pageCount: 1,
      viewportWidth: 1024,
      viewportHeight: 768,
    });
    worker.cancel(first.runId);
    await expect.poll(() => worker.state(first.runId), poll).toBe('cancelled');
    await expect.poll(() => worker.state(third.runId), poll).toBe('running');
    const contexts = await loadedContexts(harness.browser, 4);
    expect(await workContexts(replacement.browser)).toEqual([]);
    expect(worker.service.snapshot().runs.find((run) => run.id === third.runId)?.config).toEqual(
      frozen,
    );
    expect(await Promise.all(contexts.map(viewport))).toEqual([
      { width: 800, height: 600 },
      { width: 800, height: 600 },
    ]);
    worker.cancel(second.runId);
    worker.cancel(third.runId);
    await expect.poll(() => worker.service.snapshot().resources.length, poll).toBe(0);
    const publicState = JSON.stringify(worker.service.snapshot());
    expect(publicState).not.toContain(harness.endpoint);
    expect(publicState).not.toContain(replacement.endpoint);
  }, 40_000);

  it('isolates a closed work page from the other device and leaves the borrowed browser alive', async () => {
    const fixture = await localPages();
    const harness = await chrome();
    const worker = await subject({
      browser: { mode: 'connect', endpoint: harness.endpoint },
      url: `${fixture.origin}/probe`,
    });
    const first = worker.start('fails');
    const [firstContext] = await loadedContexts(harness.browser, 2);
    if (!firstContext) throw new Error('First work context missing');
    const second = worker.start('survives');
    await loadedContexts(harness.browser, 4);
    const [page] = await firstContext.pages();
    if (!page) throw new Error('Work page missing');
    await page.close();
    await expect.poll(() => worker.state(first.runId), poll).toBe('failed');
    expect(worker.state(second.runId)).toBe('running');
    const [survivor] = await loadedContexts(harness.browser, 2);
    if (!survivor) throw new Error('Surviving work context missing');
    expect(await viewport(survivor)).toEqual({ width: 800, height: 600 });
    expect(harness.browser.connected).toBe(true);
    worker.cancel(second.runId);
    await expect.poll(() => worker.state(second.runId), poll).toBe('cancelled');
  }, 30_000);

  it.each(['timeout', 'cancel'])(
    'cleans a borrowed context after %s during local navigation',
    async (mode) => {
      const fixture = await localPages();
      const harness = await chrome();
      const worker = await subject({
        browser: { mode: 'connect', endpoint: harness.endpoint },
        pageCount: 1,
        url: `${fixture.origin}/hang`,
        executionTimeoutMs: mode === 'timeout' ? 2000 : 30_000,
      });
      const { runId } = worker.start(mode);
      await expect.poll(() => fixture.visits.includes('/hang'), poll).toBe(true);
      if (mode === 'cancel') worker.cancel(runId);
      await expect
        .poll(() => worker.state(runId), poll)
        .toBe(mode === 'cancel' ? 'cancelled' : 'failed');
      expect(worker.service.snapshot().resources).toEqual([]);
      expect(await workContexts(harness.browser)).toEqual([]);
      expect(harness.browser.connected).toBe(true);
    },
    30_000,
  );

  it('cancels before a newly created page target is published', async () => {
    const fixture = await localPages();
    const harness = await chrome();
    const worker = await subject({
      browser: { mode: 'connect', endpoint: harness.endpoint },
      pageCount: 1,
      url: `${fixture.origin}/probe`,
    });
    const waitForTarget = Browser.prototype.waitForTarget;
    const targetWait = vi
      .spyOn(Browser.prototype, 'waitForTarget')
      .mockImplementationOnce(function (this: Browser, predicate, options) {
        worker.cancel(runId);
        return waitForTarget.call(this, predicate, { ...options, timeout: 5000 });
      });
    const { runId } = worker.start('cancel-target-publication');
    try {
      await expect.poll(() => worker.state(runId), { timeout: 2000 }).toBe('cancelled');
      expect(targetWait).toHaveBeenCalled();
      expect(worker.service.snapshot().resources).toEqual([]);
      expect(await workContexts(harness.browser)).toEqual([]);
      expect(harness.browser.connected).toBe(true);
    } finally {
      targetWait.mockRestore();
    }
  }, 15_000);

  it('blocks a local page redirect before Chrome can request an external origin', async () => {
    const fixture = await localPages();
    const harness = await chrome();
    const failures: { url: string; error: string | undefined }[] = [];
    const observations: Promise<void>[] = [];
    const observe = (target: Target) => {
      observations.push(
        (async () => {
          const page = await target.page();
          page?.on('requestfailed', (request) => {
            failures.push({ url: request.url(), error: request.failure()?.errorText });
          });
        })(),
      );
    };
    harness.browser.on('targetcreated', observe);
    cleanups.push(async () => {
      harness.browser.off('targetcreated', observe);
      await Promise.all(observations);
    });
    const worker = await subject({
      browser: { mode: 'connect', endpoint: harness.endpoint },
      pageCount: 1,
      url: `${fixture.origin}/redirect`,
    });
    const { runId } = worker.start('redirect-is-blocked');
    await expect.poll(() => fixture.visits.includes('/redirect'), poll).toBe(true);
    await expect.poll(() => worker.state(runId), poll).toBe('failed');
    expect(failures).toContainEqual({
      url: 'http://192.0.2.1:9/never-load',
      error: 'net::ERR_BLOCKED_BY_CLIENT',
    });
    expect(worker.service.snapshot().resources).toEqual([]);
    expect(await workContexts(harness.browser)).toEqual([]);
    expect(
      (await harness.browser.pages()).some((page) => page.url().startsWith('http://192.0.2.1:')),
    ).toBe(false);
    expect(harness.browser.connected).toBe(true);
  }, 30_000);

  it('cancels a pending endpoint discovery before creating a Chrome context', async () => {
    const fixture = await localPages();
    const harness = await chrome();
    const worker = await subject({
      browser: { mode: 'connect', endpoint: fixture.origin },
      pageCount: 1,
      url: `${fixture.origin}/probe`,
    });
    const { runId } = worker.start('cancel-discovery');
    await expect.poll(() => fixture.visits.includes('/json/version'), poll).toBe(true);
    worker.cancel(runId);
    await expect.poll(() => worker.state(runId), poll).toBe('cancelled');
    expect(worker.service.snapshot().resources).toEqual([]);
    expect(await portFiles(worker.root)).toEqual([]);
    expect(await workContexts(harness.browser)).toEqual([]);
    expect(harness.browser.connected).toBe(true);
    expect(fixture.visits).not.toContain('/probe');
  }, 30_000);

  it('proves the owned Chrome process has exited before releasing its reservation', async () => {
    const fixture = await localPages();
    await access(executablePath, constants.X_OK);
    const worker = await subject({
      browser: { mode: 'launch', executablePath, headless: true },
      url: `${fixture.origin}/probe`,
    });
    const { runId } = worker.start('owned');
    const observer = await ownedObserver(worker.root);
    worker.observers.push(observer.browser);
    await expect
      .poll(() => fixture.visits.filter((path) => path === '/probe').length, poll)
      .toBe(2);
    expect(alive(observer.pid)).toBe(true);
    worker.cancel(runId);
    await expect.poll(() => worker.state(runId), poll).toBe('cancelled');
    expect(alive(observer.pid)).toBe(false);
    expect(worker.service.snapshot().resources).toEqual([]);
    expect(JSON.stringify(worker.service.snapshot())).not.toContain(executablePath);
    await delay(50);
    expect(alive(observer.pid)).toBe(false);
  }, 30_000);
  it('retains capacity when the saved browser identity does not match the live endpoint', async () => {
    const fixture = await localPages();
    const harness = await chrome();
    const other = await chrome();
    const sentinel = await harness.browser.newPage();
    await sentinel.goto(`${fixture.origin}/sentinel`);
    const untouched = await harness.browser.createBrowserContext();
    const page = await untouched.newPage();
    await page.goto(`${fixture.origin}/unrelated`);
    const directory = await mkdtemp(join(tmpdir(), 'browser-2d-chrome-unknown-'));
    const database = await openBusinessStore({
      path: join(directory, 'data.db'),
      execution: 'chrome',
      confirmLegacy: async () => true,
      prepareLegacy: async () => secretRefSchema.parse(randomUUID()),
      verifyCredential: async () => undefined,
    });
    const settings = value(database.store.settings.get());
    value(
      database.store.settings.commit({
        values: {
          browser: { mode: 'connect', endpoint: harness.endpoint },
          viewportWidth: 800,
          viewportHeight: 600,
          pageCount: 4,
        },
        expectedRevision: settings.revision,
      }),
    );
    const deviceId = value(database.store.devices.create({ symbol: 'unknown-owner' })).id;
    const { runId } = value(database.work.start({ commandId: randomUUID(), deviceId }));
    const admitted = database.work.admit();
    if (!admitted) throw new Error('Chrome run was not admitted');
    const operationId = admitted.intent.operationId;
    database.work.chrome.prepare(operationId);
    const browserHash = createHash('sha256')
      .update(new URL(other.browser.wsEndpoint()).pathname)
      .digest('hex');
    database.work.chrome.save(operationId, { mode: 'connect', phase: 'creating', browserHash });
    const contextId = untouched.id;
    if (!contextId) throw new Error('Dedicated test context has no identity');
    database.work.chrome.save(operationId, {
      mode: 'connect',
      phase: 'known',
      browserHash,
      contextId,
    });
    const service = createWorkService({
      repository: database.work,
      driver: createChromeDriver({
        root: join(directory, 'chrome-sessions'),
        journal: database.work.chrome,
      }),
      publish: () => undefined,
      policy: { executionTimeoutMs: 30_000, cleanupTimeoutMs: 10_000, cleanupAttempts: 1 },
    });
    cleanups.push(async () => {
      database.work.chrome.save(operationId, { mode: 'connect', phase: 'released' });
      database.work.resolved(operationId);
      try {
        await service.stop();
      } finally {
        await untouched.close();
        database.store.close();
        await rm(directory, { recursive: true, force: true });
      }
    });
    await expect
      .poll(() => service.snapshot().resources[0]?.failure, poll)
      .toBe('OWNERSHIP_UNCERTAIN');
    expect(service.snapshot().runs.find((run) => run.id === runId)?.state).toBe('interrupted');
    expect(service.snapshot().resources).toMatchObject([{ operationId, pages: 4 }]);
    expect(harness.browser.connected).toBe(true);
    expect(sentinel.isClosed()).toBe(false);
    expect(page.isClosed()).toBe(false);
    expect(await page.title()).toBe('Local Chrome probe');
    const waitingDevice = value(database.store.devices.create({ symbol: 'waiting-on-proof' })).id;
    const waiting = value(service.start({ commandId: randomUUID(), deviceId: waitingDevice }));
    await delay(150);
    expect(service.snapshot().runs.find((run) => run.id === waiting.runId)?.state).toBe('queued');
    expect(await workContexts(harness.browser)).toHaveLength(1);
    expect(await workContexts(other.browser)).toHaveLength(0);
  }, 30_000);
});

it('killing owned Chrome during execution must fail the run', async () => {
  const fixture = await localPages();
  const worker = await subject({
    browser: { mode: 'launch', executablePath, headless: true },
    url: `${fixture.origin}/probe`,
    durationMs: 2000,
  });
  const { runId } = worker.start('crash-owned');
  const observer = await ownedObserver(worker.root);
  worker.observers.push(observer.browser);
  await expect.poll(() => fixture.visits.filter((path) => path === '/probe').length, poll).toBe(2);
  await delay(300);
  process.kill(observer.pid, 'SIGKILL');
  await expect.poll(() => alive(observer.pid), poll).toBe(false);
  await expect.poll(() => worker.service.snapshot().resources.length, poll).toBe(0);
  expect(worker.state(runId)).toBe('failed');
}, 30_000);

it('refuses to close an unrelated Chrome found through a forged owned discovery file', async () => {
  const harness = await chrome();
  const sentinel = await harness.browser.newPage();
  await sentinel.setContent('<title>preserved unrelated Chrome</title>');
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-marker-refusal-'));
  const database = await openBusinessStore({
    path: join(directory, 'data.db'),
    execution: 'chrome',
    confirmLegacy: async () => true,
    prepareLegacy: async () => secretRefSchema.parse(randomUUID()),
  });
  cleanups.push(async () => {
    database.store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const deviceId = value(database.store.devices.create({ symbol: 'marker-refusal' })).id;
  value(database.work.start({ commandId: randomUUID(), deviceId }));
  const admitted = database.work.admit();
  if (!admitted) throw new Error('Missing admission');
  const intent = admitted.intent;
  database.work.chrome.prepare(intent.operationId);
  database.work.chrome.save(intent.operationId, { mode: 'launch', phase: 'attempted' });
  const root = join(directory, 'chrome-sessions');
  const operationDirectory = join(root, intent.operationId);
  await mkdir(operationDirectory, { recursive: true });
  const endpoint = new URL(harness.browser.wsEndpoint());
  await writeFile(
    join(operationDirectory, 'DevToolsActivePort'),
    `${endpoint.port}\n${endpoint.pathname}\n`,
  );
  const driver = createChromeDriver({ root, journal: database.work.chrome });
  expect(await driver.cleanup(intent, AbortSignal.timeout(5000))).toEqual({
    kind: 'blocked',
    reason: 'OWNERSHIP_UNCERTAIN',
  });
  expect(harness.browser.connected).toBe(true);
  expect(await sentinel.title()).toBe('preserved unrelated Chrome');
  expect(database.work.obligations()).toHaveLength(1);
}, 30_000);

it('recovers a verified owned browser that exited before its release was journaled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-closed-recovery-'));
  const database = await openBusinessStore({
    path: join(directory, 'data.db'),
    execution: 'chrome',
    confirmLegacy: async () => true,
    prepareLegacy: async () => secretRefSchema.parse(randomUUID()),
  });
  const settings = value(database.store.settings.get());
  value(
    database.store.settings.commit({
      expectedRevision: settings.revision,
      values: {
        ...settings,
        browser: { mode: 'launch', executablePath, headless: true },
      },
    }),
  );
  const deviceId = value(database.store.devices.create({ symbol: 'closed-before-journal' })).id;
  value(database.work.start({ commandId: randomUUID(), deviceId }));
  const admitted = database.work.admit();
  if (!admitted) throw new Error('Missing admission');
  const root = join(directory, 'chrome-sessions');
  const driver = createChromeDriver({ root, journal: database.work.chrome });
  cleanups.push(async () => {
    await driver.cleanup(admitted.intent, AbortSignal.timeout(7000));
    database.store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const resource = await driver.acquire(admitted.intent, AbortSignal.timeout(15_000));
  database.work.acquired(admitted.intent, resource);
  const observer = await ownedObserver(root);
  await observer.browser.close();
  await expect.poll(() => alive(observer.pid), poll).toBe(false);
  database.work.recover();
  const recovered = createChromeDriver({ root, journal: database.work.chrome });
  expect(await recovered.cleanup(admitted.intent, AbortSignal.timeout(7000))).toEqual({
    kind: 'resolved',
  });
  database.work.resolved(admitted.intent.operationId);
  expect(database.work.snapshot().resources).toEqual([]);
  const remaining = await readdir(root);
  if (remaining.length > 0) {
    const profile = join(root, admitted.intent.operationId);
    const capturedAt = new Date().toISOString();
    const journal = database.work.chrome.get(admitted.intent.operationId);
    try {
      let processes: string[] | { error: string };
      try {
        processes = execFileSync('/bin/ps', ['-axww', '-o', 'pid=,ppid=,lstart=,command='], {
          encoding: 'utf8',
          timeout: 1000,
        })
          .split('\n')
          .filter(
            (line) => line.includes(profile) || line.trimStart().startsWith(`${observer.pid} `),
          );
      } catch (error) {
        processes = { error: String(error) };
      }
      const entries = await Promise.all(
        (await readdir(root, { recursive: true })).map(async (path) => {
          try {
            const stat = await lstat(join(root, path));
            return {
              path,
              size: stat.size,
              mtime: stat.mtime.toISOString(),
              mode: stat.mode,
              directory: stat.isDirectory(),
              symlink: stat.isSymbolicLink(),
            };
          } catch (error) {
            return { path, error: String(error) };
          }
        }),
      );
      const diagnostic = JSON.stringify(
        { capturedAt, root, remaining, journal, browserPid: observer.pid, processes, entries },
        null,
        2,
      );
      console.error(`Chrome profile cleanup failure\n${diagnostic}`);
      const artifacts = fileURLToPath(new URL('../../../artifacts/', import.meta.url));
      await mkdir(artifacts, { recursive: true });
      await writeFile(
        join(artifacts, `chrome-profile-${admitted.intent.operationId}.json`),
        diagnostic,
      );
    } catch (error) {
      console.error('Chrome profile cleanup diagnostic failed', {
        capturedAt,
        root,
        remaining,
        journal,
        error,
      });
    }
  }
  expect(remaining).toEqual([]);
}, 30_000);

import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Result } from '@browser-2d/contracts/public';
import { createChromeDriver } from '../src/browser/chrome-driver';
import { openBusinessStore } from '../src/storage/open-business-store';
import { createWorkService } from '../src/work/service';

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, rm: vi.fn(fs.rm) };
});
const filesystem = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const executablePath =
  process.env.BROWSER2D_CHROME_EXECUTABLE ?? (await puppeteer.executablePath('chrome'));
const poll = { timeout: 15_000, interval: 25 };
let directory: string;
let storage: Awaited<ReturnType<typeof openBusinessStore>>;
const services: ReturnType<typeof createWorkService>[] = [];

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
async function open() {
  return openBusinessStore({
    path: join(directory, 'data.db'),
    execution: 'chrome',
    confirmLegacy: async () => true,
    prepareLegacy: async () => {
      throw new Error('No legacy key expected');
    },
  });
}
function admit() {
  const deviceId = value(storage.store.devices.create({ symbol: randomUUID() })).id;
  value(storage.work.start({ commandId: randomUUID(), deviceId }));
  const admission = storage.work.admit();
  if (!admission) throw new Error('Run was not admitted');
  return admission;
}
function recover(
  driver = createChromeDriver({
    root: join(directory, 'chrome-sessions'),
    journal: storage.work.chrome,
  }),
) {
  const service = createWorkService({
    repository: storage.work,
    driver,
    publish: () => {},
    policy: { executionTimeoutMs: 30_000, cleanupTimeoutMs: 10_000, cleanupAttempts: 1 },
  });
  services.push(service);
  return service;
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'browser-2d-profile-cleanup-'));
  storage = await open();
  const settings = value(storage.store.settings.get());
  value(
    storage.store.settings.commit({
      expectedRevision: settings.revision,
      values: {
        ...settings,
        pageCount: 4,
        browser: { mode: 'launch', executablePath, headless: true },
      },
    }),
  );
});
afterEach(async () => {
  vi.mocked(rm).mockImplementation(filesystem.rm);
  for (const service of services.splice(0)) await service.stop().catch(() => {});
  storage.store.close();
  await filesystem.rm(directory, { recursive: true, force: true });
});

it.each(['prepared', 'attempted', 'attached'])(
  'retains %s launch cleanup failures and retries the partially deleted profile after cold recovery',
  async (phase) => {
    const { intent } = admit();
    const root = join(directory, 'chrome-sessions');
    const profile = join(root, intent.operationId);
    const driver = createChromeDriver({
      root,
      journal: storage.work.chrome,
      checkpoint: async (stage) => {
        if (phase === 'attempted' && stage === 'spawned') throw new Error('Attachment interrupted');
      },
    });
    if (phase === 'prepared') {
      storage.work.chrome.prepare(intent.operationId);
      await mkdir(profile, { recursive: true });
    } else if (phase === 'attempted') {
      await expect(driver.acquire(intent, AbortSignal.timeout(15_000))).rejects.toThrow(
        'Attachment interrupted',
      );
    } else {
      const resource = await driver.acquire(intent, AbortSignal.timeout(15_000));
      storage.work.acquired(intent, resource);
    }
    expect(storage.work.chrome.get(intent.operationId)?.phase).toBe(phase);
    await writeFile(join(profile, 'retained-data'), 'private profile data');
    vi.mocked(rm).mockImplementation(async (path, options) => {
      if (path !== profile) return filesystem.rm(path, options);
      await filesystem.rm(join(profile, 'DevToolsActivePort'), { force: true });
      throw Object.assign(new Error('Profile deletion denied'), { code: 'EACCES' });
    });
    const service = recover(driver);
    await expect.poll(() => service.snapshot().resources[0]?.failure, poll).toBe('CLEANUP_FAILED');
    expect(storage.work.chrome.get(intent.operationId)).toEqual({
      mode: 'launch',
      phase: 'stopped',
    });
    expect(await readFile(join(profile, 'retained-data'), 'utf8')).toBe('private profile data');
    expect(service.snapshot().resources).toMatchObject([
      { operationId: intent.operationId, pages: 4 },
    ]);
    const waitingDevice = value(storage.store.devices.create({ symbol: 'waiting' })).id;
    const waiting = value(service.start({ commandId: randomUUID(), deviceId: waitingDevice }));
    await delay(50);
    expect(service.snapshot().runs.find((run) => run.id === waiting.runId)?.state).toBe('queued');
    value(service.cancel({ commandId: randomUUID(), runId: waiting.runId }));
    await expect(service.stop()).rejects.toThrow('cleanup is incomplete');
    services.splice(services.indexOf(service), 1);
    storage.store.close();
    storage = await open();
    vi.mocked(rm).mockClear();
    vi.mocked(rm).mockImplementation(filesystem.rm);
    const restarted = recover();
    await expect.poll(() => restarted.snapshot().resources.length, poll).toBe(0);
    expect(storage.work.chrome.get(intent.operationId)).toEqual({
      mode: 'launch',
      phase: 'released',
    });
    await expect(filesystem.access(profile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(vi.mocked(rm)).toHaveBeenCalledWith(profile, { recursive: true, force: true });
    expect(restarted.snapshot().runs.find((run) => run.id === intent.runId)?.state).toBe(
      'interrupted',
    );
    await restarted.stop();
  },
  30_000,
);

it('bounds profile removal and keeps its durable cleanup obligation after cancellation', async () => {
  const { intent } = admit();
  storage.work.chrome.prepare(intent.operationId);
  const root = join(directory, 'chrome-sessions');
  const profile = join(root, intent.operationId);
  await mkdir(profile, { recursive: true });
  let finishRemoval = () => {};
  const pending = new Promise<void>((resolve) => {
    finishRemoval = resolve;
  });
  vi.mocked(rm).mockImplementationOnce(() => pending);
  const driver = createChromeDriver({ root, journal: storage.work.chrome });
  const abort = new AbortController();
  const cleanup = driver.cleanup(intent, abort.signal);
  try {
    await expect.poll(() => vi.mocked(rm).mock.calls.some(([path]) => path === profile)).toBe(true);
    abort.abort();
    expect(await Promise.race([cleanup, delay(250, 'deadline missed')])).toEqual({
      kind: 'blocked',
      reason: 'CLEANUP_FAILED',
    });
    expect(storage.work.chrome.get(intent.operationId)).toEqual({
      mode: 'launch',
      phase: 'stopped',
    });
    expect(storage.work.obligations()).toHaveLength(1);
  } finally {
    finishRemoval();
    await cleanup;
  }
  expect(storage.work.chrome.get(intent.operationId)?.phase).toBe('stopped');
  expect(await driver.cleanup(intent, AbortSignal.timeout(1000))).toEqual({ kind: 'resolved' });
});

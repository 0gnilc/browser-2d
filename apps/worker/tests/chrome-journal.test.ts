import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Result } from '@browser-2d/contracts/public';
import { openBusinessStore } from '../src/storage/open-business-store';
import { createChromeDriver } from '../src/browser/chrome-driver';
import { createWorkService } from '../src/work/service';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
let directory: string;
let storage: Awaited<ReturnType<typeof openBusinessStore>>;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'browser-2d-journal-'));
  storage = await openBusinessStore({
    path: join(directory, 'data.db'),
    execution: 'chrome',
    confirmLegacy: async () => true,
    prepareLegacy: async () => {
      throw new Error('No legacy key expected');
    },
  });
});
afterEach(() => {
  storage.store.close();
  rmSync(directory, { recursive: true, force: true });
});
function admit() {
  const deviceId = value(storage.store.devices.create({ symbol: randomUUID() })).id;
  const runId = value(storage.work.start({ commandId: randomUUID(), deviceId })).runId;
  const admission = storage.work.admit();
  if (!admission) throw new Error('Run was not admitted');
  expect(admission.run.id).toBe(runId);
  return admission;
}
function driver() {
  return createChromeDriver({
    root: join(directory, 'chrome-sessions'),
    journal: storage.work.chrome,
  });
}

it('freezes private Chrome selection per run without leaking executable paths or endpoints in public snapshots', () => {
  const initial = value(storage.store.settings.get());
  const firstBrowser = { mode: 'connect' as const, endpoint: 'http://127.0.0.1:12345' };
  value(
    storage.store.settings.commit({
      values: { ...initial, browser: firstBrowser },
      expectedRevision: 0,
    }),
  );
  const first = admit();
  const nextBrowser = {
    mode: 'launch' as const,
    executablePath: '/private/frozen/chrome',
    headless: true,
  };
  value(
    storage.store.settings.commit({
      values: { ...initial, browser: nextBrowser },
      expectedRevision: 1,
    }),
  );
  const second = admit();
  expect(storage.work.chrome.config(first.run.id)).toEqual(firstBrowser);
  expect(storage.work.chrome.config(second.run.id)).toEqual(nextBrowser);
  expect(storage.work.chrome.hasRun(first.run.id)).toBe(true);
  const snapshot = storage.work.snapshot();
  expect(snapshot.execution).toBe('chrome');
  expect(JSON.stringify(snapshot)).not.toContain('12345');
  expect(JSON.stringify(snapshot)).not.toContain('/private/frozen/chrome');
  expect(snapshot.runs.map((run) => run.config.revision).sort()).toEqual([1, 2]);
});

it('detects a missing executable before attempting launch and safely resolves that unattempted operation', async () => {
  const initial = value(storage.store.settings.get());
  value(
    storage.store.settings.commit({
      values: {
        ...initial,
        browser: {
          mode: 'launch',
          executablePath: join(directory, 'missing-chrome'),
          headless: true,
        },
      },
      expectedRevision: 0,
    }),
  );
  const { intent } = admit();
  const chrome = driver();
  await expect(chrome.acquire(intent, AbortSignal.timeout(1000))).rejects.toThrow();
  expect(storage.work.chrome.get(intent.operationId)).toEqual({
    mode: 'launch',
    phase: 'prepared',
  });
  await expect(chrome.cleanup(intent, AbortSignal.timeout(1000))).resolves.toEqual({
    kind: 'resolved',
  });
  expect(storage.work.chrome.get(intent.operationId)).toEqual({
    mode: 'launch',
    phase: 'released',
  });
});

it('never replays a durable attempted launch or treats a missing discovery file as final absence', async () => {
  const { intent } = admit();
  storage.work.chrome.prepare(intent.operationId);
  storage.work.chrome.save(intent.operationId, { mode: 'launch', phase: 'attempted' });
  const chrome = driver();
  await expect(chrome.acquire(intent, AbortSignal.timeout(1000))).rejects.toThrow(
    'cannot be replayed',
  );
  await expect(chrome.cleanup(intent, AbortSignal.timeout(1000))).resolves.toEqual({
    kind: 'blocked',
    reason: 'OWNERSHIP_UNCERTAIN',
  });
  expect(existsSync(join(directory, 'chrome-sessions', intent.operationId))).toBe(false);
  expect(storage.work.chrome.get(intent.operationId)).toEqual({
    mode: 'launch',
    phase: 'attempted',
  });
});

it('retains interrupted work and capacity after an attempted launch with no observable browser', async () => {
  const { intent } = admit();
  storage.work.chrome.prepare(intent.operationId);
  storage.work.chrome.save(intent.operationId, { mode: 'launch', phase: 'attempted' });
  const service = createWorkService({
    repository: storage.work,
    driver: driver(),
    publish: () => {},
    policy: { executionTimeoutMs: 100, cleanupTimeoutMs: 100, cleanupAttempts: 1 },
  });
  try {
    await expect.poll(() => service.snapshot().resources[0]?.failure).toBe('OWNERSHIP_UNCERTAIN');
    expect(service.snapshot().runs[0]?.state).toBe('interrupted');
    expect(service.start({ commandId: randomUUID(), deviceId: intent.deviceId })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    await expect(service.stop()).rejects.toThrow('cleanup is incomplete');
    expect(service.snapshot().resources).toHaveLength(1);
  } finally {
    await service.stop().catch(() => {});
  }
});

it('keeps a lost borrowed context-creation response blocked without searching or touching other contexts', async () => {
  const initial = value(storage.store.settings.get());
  value(
    storage.store.settings.commit({
      values: { ...initial, browser: { mode: 'connect', endpoint: 'http://127.0.0.1:12345' } },
      expectedRevision: 0,
    }),
  );
  const { intent } = admit();
  storage.work.chrome.prepare(intent.operationId);
  storage.work.chrome.save(intent.operationId, {
    mode: 'connect',
    phase: 'creating',
    browserHash: 'a'.repeat(64),
  });
  await expect(driver().cleanup(intent, AbortSignal.timeout(1000))).resolves.toEqual({
    kind: 'blocked',
    reason: 'OWNERSHIP_UNCERTAIN',
  });
  expect(storage.work.chrome.get(intent.operationId)?.phase).toBe('creating');
});

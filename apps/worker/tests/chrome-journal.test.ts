import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Result } from '@browser-2d/contracts/public';
import { openBusinessStore } from '../src/storage/open-business-store';
import type { ChromeState } from '../src/browser/journal';
import { launchContract } from '../src/browser/process';
import { createChromeDriver } from '../src/browser/chrome-driver';
import { createWorkService } from '../src/work/service';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
let directory: string;
let storage: Awaited<ReturnType<typeof openBusinessStore>>;
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
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'browser-2d-journal-'));
  storage = await open();
});
afterEach(() => {
  vi.restoreAllMocks();
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
    version: 2,
    mode: 'launch',
    phase: 'released',
    proof: { kind: 'never-spawned' },
  });
});

it('never replays a durable attempted launch or treats a missing discovery file as final absence', async () => {
  const { intent } = admit();
  storage.work.chrome.prepare(intent.operationId);
  storage.work.chrome.save(intent.operationId, {
    version: 2,
    mode: 'launch',
    phase: 'attempted',
    contract: launchContract(),
  });
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
    version: 2,
    mode: 'launch',
    phase: 'attempted',
    contract: launchContract(),
  });
});

it('retains interrupted work and capacity after an attempted launch with no observable browser', async () => {
  const { intent } = admit();
  storage.work.chrome.prepare(intent.operationId);
  storage.work.chrome.save(intent.operationId, {
    version: 2,
    mode: 'launch',
    phase: 'attempted',
    contract: launchContract(),
  });
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

it.each(['prepared', 'attempted', 'attached', 'stopped', 'released'] as const)(
  'preserves raw legacy %s evidence without inventing a family witness',
  async (phase) => {
    const { intent } = admit();
    storage.work.chrome.prepare(intent.operationId);
    const raw =
      phase === 'attached'
        ? {
            mode: 'launch',
            phase,
            browserHash: 'a'.repeat(64),
            pid: process.pid,
            processIdentity: null,
          }
        : { mode: 'launch', phase };
    storage.store.close();
    const db = new Database(join(directory, 'data.db'));
    try {
      db.prepare('UPDATE chrome_operations SET state = ? WHERE operation_id = ?').run(
        JSON.stringify(raw),
        intent.operationId,
      );
    } finally {
      db.close();
    }
    storage = await open();
    expect(storage.work.chrome.get(intent.operationId)).toEqual(raw);
    const profile = join(directory, 'chrome-sessions', intent.operationId);
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, 'retained-data'), 'private data');
    const kill = vi.spyOn(process, 'kill');
    expect(await driver().cleanup(intent, AbortSignal.timeout(1000))).toEqual(
      phase === 'prepared' || phase === 'released'
        ? { kind: 'resolved' }
        : { kind: 'blocked', reason: 'OWNERSHIP_UNCERTAIN' },
    );
    expect(kill).not.toHaveBeenCalled();
    if (phase === 'prepared') {
      expect(existsSync(profile)).toBe(false);
      expect(storage.work.chrome.get(intent.operationId)).toEqual({
        version: 2,
        mode: 'launch',
        phase: 'released',
        proof: { kind: 'never-spawned' },
      });
    } else {
      expect(readFileSync(join(profile, 'retained-data'), 'utf8')).toBe('private data');
      expect(storage.work.chrome.get(intent.operationId)).toEqual(raw);
      expect(() =>
        storage.work.chrome.save(intent.operationId, {
          version: 2,
          mode: 'launch',
          phase: 'stopped',
          proof: { kind: 'never-spawned' },
        }),
      ).toThrow('Invalid Chrome transition');
    }
  },
);

it.each(['posix-group', 'windows-child'] as const)(
  'retains new %s attempted records without a durable spawn witness',
  async (contract) => {
    const { intent } = admit();
    storage.work.chrome.prepare(intent.operationId);
    storage.work.chrome.save(intent.operationId, {
      version: 2,
      mode: 'launch',
      phase: 'attempted',
      contract,
    });
    expect(await driver().cleanup(intent, AbortSignal.timeout(1000))).toEqual({
      kind: 'blocked',
      reason: 'OWNERSHIP_UNCERTAIN',
    });
    expect(storage.work.chrome.get(intent.operationId)).toEqual({
      version: 2,
      mode: 'launch',
      phase: 'attempted',
      contract,
    });
  },
);

it.skipIf(process.platform === 'win32')(
  'keeps the profile and obligation when its group cannot be observed',
  async () => {
    const { intent } = admit();
    storage.work.chrome.prepare(intent.operationId);
    storage.work.chrome.save(intent.operationId, {
      version: 2,
      mode: 'launch',
      phase: 'attempted',
      contract: 'posix-group',
    });
    storage.work.chrome.save(intent.operationId, {
      version: 2,
      mode: 'launch',
      phase: 'spawned',
      lifetime: { kind: 'posix-group', pgid: 123456 },
    });
    const profile = join(directory, 'chrome-sessions', intent.operationId);
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, 'retained-data'), 'private data');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Denied'), { code: 'EPERM' });
    });
    expect(await driver().cleanup(intent, AbortSignal.timeout(1000))).toEqual({
      kind: 'blocked',
      reason: 'OWNERSHIP_UNCERTAIN',
    });
    expect(readFileSync(join(profile, 'retained-data'), 'utf8')).toBe('private data');
    expect(storage.work.obligations()).toHaveLength(1);
    expect(storage.work.chrome.get(intent.operationId)?.phase).toBe('spawned');
    expect(kill).toHaveBeenCalledExactlyOnceWith(-123456, 0);
  },
);

it.skipIf(process.platform === 'win32')(
  'retains a rejected spawn until its local child proves it never started',
  async () => {
    const executable = join(directory, 'invalid-interpreter');
    writeFileSync(executable, '#!/browser-2d/nonexistent-interpreter\n');
    chmodSync(executable, 0o700);
    const settings = value(storage.store.settings.get());
    value(
      storage.store.settings.commit({
        expectedRevision: settings.revision,
        values: {
          ...settings,
          browser: { mode: 'launch', executablePath: executable, headless: true },
        },
      }),
    );
    const { intent } = admit();
    const chrome = driver();
    await expect(chrome.acquire(intent, AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(storage.work.chrome.get(intent.operationId)).toEqual({
      version: 2,
      mode: 'launch',
      phase: 'attempted',
      contract: 'posix-group',
    });
    expect(await driver().cleanup(intent, AbortSignal.timeout(1000))).toEqual({
      kind: 'blocked',
      reason: 'OWNERSHIP_UNCERTAIN',
    });
    expect(await chrome.cleanup(intent, AbortSignal.timeout(1000))).toEqual({ kind: 'resolved' });
    expect(storage.work.chrome.get(intent.operationId)).toEqual({
      version: 2,
      mode: 'launch',
      phase: 'released',
      proof: { kind: 'never-spawned' },
    });
  },
);

it.each(['posix-group', 'windows-child'] as const)(
  'preserves %s evidence across every durable launch transition',
  (contract) => {
    const lifetime =
      contract === 'posix-group'
        ? { kind: 'posix-group' as const, pgid: 123456 }
        : { kind: 'windows-child' as const, pid: 123456 };
    const otherLifetime =
      contract === 'posix-group'
        ? { kind: 'windows-child' as const, pid: 123456 }
        : { kind: 'posix-group' as const, pgid: 123456 };
    const proof =
      contract === 'posix-group'
        ? { kind: 'posix-group-empty' as const, pgid: 123456 }
        : { kind: 'windows-main-exited' as const, pid: 123456 };
    const otherProof =
      contract === 'posix-group'
        ? { kind: 'windows-main-exited' as const, pid: 123456 }
        : { kind: 'posix-group-empty' as const, pgid: 123456 };
    const changedLifetime =
      contract === 'posix-group'
        ? { kind: 'posix-group' as const, pgid: 654321 }
        : { kind: 'windows-child' as const, pid: 654321 };
    const changedProof =
      contract === 'posix-group'
        ? { kind: 'posix-group-empty' as const, pgid: 654321 }
        : { kind: 'windows-main-exited' as const, pid: 654321 };
    const attempted = {
      version: 2,
      mode: 'launch',
      phase: 'attempted',
      contract,
    } satisfies ChromeState;
    const spawned = {
      version: 2,
      mode: 'launch',
      phase: 'spawned',
      lifetime,
    } satisfies ChromeState;
    const attached = {
      version: 2,
      mode: 'launch',
      phase: 'attached',
      lifetime,
      pid: 123456,
      browserHash: 'a'.repeat(64),
      processIdentity: 'identity',
    } satisfies ChromeState;
    const stopped = { version: 2, mode: 'launch', phase: 'stopped', proof } satisfies ChromeState;
    const released = { version: 2, mode: 'launch', phase: 'released', proof } satisfies ChromeState;
    const { intent } = admit();
    const journal = storage.work.chrome;
    journal.prepare(intent.operationId);
    const reject = (next: ChromeState) => {
      const before = journal.get(intent.operationId);
      expect(() => journal.save(intent.operationId, next)).toThrow('Invalid Chrome transition');
      expect(journal.get(intent.operationId)).toEqual(before);
    };
    reject({ mode: 'launch', phase: 'attempted' });
    reject(stopped);
    journal.save(intent.operationId, attempted);
    reject({ ...spawned, lifetime: otherLifetime });
    reject({ ...stopped, proof: otherProof });
    reject(attached);
    journal.save(intent.operationId, spawned);
    reject({ ...attached, lifetime: changedLifetime });
    reject({ ...attached, lifetime: otherLifetime });
    reject({ ...attached, pid: 654321 });
    reject({
      mode: 'launch',
      phase: 'attached',
      pid: 123456,
      browserHash: 'a'.repeat(64),
      processIdentity: 'identity',
    });
    reject({ ...stopped, proof: changedProof });
    reject({ ...stopped, proof: { kind: 'never-spawned' } });
    journal.save(intent.operationId, attached);
    reject({ ...stopped, proof: otherProof });
    reject({ ...stopped, proof: changedProof });
    journal.save(intent.operationId, stopped);
    reject({ mode: 'launch', phase: 'released' });
    reject({ ...released, proof: changedProof });
    reject({ ...released, proof: otherProof });
    reject({ ...released, proof: { kind: 'never-spawned' } });
    journal.save(intent.operationId, released);
    expect(journal.get(intent.operationId)).toEqual(released);
  },
);

it.each(['posix-group', 'windows-child'] as const)(
  'accepts local %s drain proof when spawned witness publication failed',
  (contract) => {
    const { intent } = admit();
    storage.work.chrome.prepare(intent.operationId);
    storage.work.chrome.save(intent.operationId, {
      version: 2,
      mode: 'launch',
      phase: 'attempted',
      contract,
    });
    const stopped = {
      version: 2,
      mode: 'launch',
      phase: 'stopped',
      proof:
        contract === 'posix-group'
          ? { kind: 'posix-group-empty', pgid: 123456 }
          : { kind: 'windows-main-exited', pid: 123456 },
    } satisfies ChromeState;
    storage.work.chrome.save(intent.operationId, stopped);
    expect(storage.work.chrome.get(intent.operationId)).toEqual(stopped);
  },
);

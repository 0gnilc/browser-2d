import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Result } from '@browser-2d/contracts/public';
import { openBusinessStore } from '../src/storage/open-business-store';
import { createControlledDriver } from '../src/work/controlled-driver';
import { createWorkService, type ControlledDriver } from '../src/work/service';
import type { Acquisition } from '../src/work/repository';

let directory: string;
const opened: Awaited<ReturnType<typeof openBusinessStore>>[] = [];
const services: ReturnType<typeof createWorkService>[] = [];
const gates: (() => void)[] = [];
function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  gates.push(release);
  return { promise, release };
}
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
async function open() {
  const storage = await openBusinessStore({
    path: join(directory, 'data.db'),
    confirmLegacy: async () => true,
    prepareLegacy: async () => {
      throw new Error('Unexpected credential migration');
    },
    verifyCredential: async () => {},
  });
  opened.push(storage);
  return storage;
}
function runtime(
  storage: Awaited<ReturnType<typeof open>>,
  driver?: ControlledDriver,
  policy?: { executionTimeoutMs: number; cleanupTimeoutMs: number; cleanupAttempts: number },
) {
  const actual = driver ?? {
    ...createControlledDriver({ root: join(directory, 'resources') }),
    async execute() {},
  };
  const service = createWorkService({
    repository: storage.work,
    driver: actual,
    publish() {},
    policy,
  });
  services.push(service);
  return service;
}
function device(storage: Awaited<ReturnType<typeof open>>) {
  return value(storage.store.devices.create({ symbol: randomUUID() })).id;
}
function start(service: ReturnType<typeof runtime>, deviceId: number) {
  return value(service.start({ commandId: randomUUID(), deviceId }));
}
async function until(check: () => boolean) {
  await expect.poll(check, { timeout: 3000, interval: 10 }).toBe(true);
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'browser-2d-work-'));
});
afterEach(async () => {
  for (const release of gates.splice(0)) release();
  for (const service of services.splice(0)) await service.stop().catch(() => {});
  for (const storage of opened.splice(0)) storage.store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('durable work commands and resource lifecycle', () => {
  it('replays immutable acceptance/refusal/cancellation across changes and restart, and rejects changed kind/input', async () => {
    const storage = await open();
    const service = runtime(storage);
    const deviceId = device(storage);
    const input = { commandId: randomUUID(), deviceId };
    const receipt = service.start(input);
    const runId = value(receipt).runId;
    const cancel = { commandId: randomUUID(), runId };
    const cancellation = service.cancel(cancel);
    expect(service.start(input)).toEqual(receipt);
    expect(service.cancel(cancel)).toEqual(cancellation);
    expect(service.start({ ...input, deviceId: 999 })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(service.cancel({ commandId: input.commandId, runId })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    const missing = { commandId: randomUUID(), deviceId: 999 };
    const refusal = service.start(missing);
    value(storage.store.devices.delete({ id: deviceId }));
    await service.stop();
    storage.store.close();
    const second = await open();
    const restarted = runtime(second);
    expect(restarted.start(input)).toEqual(receipt);
    expect(restarted.cancel(cancel)).toEqual(cancellation);
    expect(restarted.start(missing)).toEqual(refusal);
    expect(value(restarted.getCommand({ commandId: input.commandId }))).toEqual({
      status: 'recorded',
      receipt,
    });
    expect(value(restarted.getCommand({ commandId: randomUUID() }))).toEqual({ status: 'unknown' });
  });
  it('reserves all pages atomically, holds device mutation and freezes settings at acceptance', async () => {
    const storage = await open();
    const settings = value(storage.store.settings.get());
    value(
      storage.store.settings.commit({
        expectedRevision: 0,
        values: { ...settings, pageCount: 3 },
        credential: { action: 'retain' },
      }),
    );
    const barrier = gate();
    const driver = {
      ...createControlledDriver({ root: join(directory, 'resources') }),
      async execute() {
        await barrier.promise;
      },
    };
    const service = runtime(storage, driver);
    const ids = [device(storage), device(storage), device(storage)];
    const receipts = ids.map((id) => start(service, id));
    await until(() => service.snapshot().runs.some((run) => run.state === 'running'));
    expect(service.snapshot().resources.map((resource) => resource.pages)).toEqual([3]);
    expect(service.snapshot().runs.filter((run) => run.state === 'queued')).toHaveLength(2);
    expect(readdirSync(join(directory, 'resources'))).toHaveLength(1);
    for (const id of ids) {
      expect(storage.store.devices.delete({ id })).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT' },
      });
      expect(storage.store.devices.update({ id, symbol: 'changed' })).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT' },
      });
    }
    value(
      storage.store.settings.commit({
        expectedRevision: 1,
        values: { ...settings, pageCount: 1 },
        credential: { action: 'retain' },
      }),
    );
    expect(
      service
        .snapshot()
        .runs.every((run) => run.config.pageCount === 3 && run.config.revision === 1),
    ).toBe(true);
    const queued = receipts[1];
    if (!queued) throw new Error('Missing queued run');
    service.cancel({ commandId: randomUUID(), runId: queued.runId });
    expect(service.snapshot().runs.find((run) => run.id === queued.runId)?.state).toBe('cancelled');
    barrier.release();
    await until(() =>
      service.snapshot().runs.every((run) => ['completed', 'cancelled'].includes(run.state)),
    );
    expect(readdirSync(join(directory, 'resources'))).toEqual([]);
  });
  it('enforces the two-device limit and durably refuses oversized demand', async () => {
    const storage = await open();
    const barrier = gate();
    const service = runtime(storage, {
      ...createControlledDriver({ root: join(directory, 'resources') }),
      async execute() {
        await barrier.promise;
      },
    });
    for (let index = 0; index < 4; index++) start(service, device(storage));
    await until(
      () => service.snapshot().runs.filter((run) => run.state === 'running').length === 2,
    );
    expect(service.snapshot().resources).toHaveLength(2);
    expect(readdirSync(join(directory, 'resources'))).toHaveLength(2);
    const settings = value(storage.store.settings.get());
    value(
      storage.store.settings.commit({
        expectedRevision: 0,
        values: { ...settings, pageCount: 5 },
        credential: { action: 'retain' },
      }),
    );
    const input = { commandId: randomUUID(), deviceId: device(storage) };
    const refusal = service.start(input);
    expect(refusal).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    value(
      storage.store.settings.commit({
        expectedRevision: 1,
        values: settings,
        credential: { action: 'retain' },
      }),
    );
    expect(service.start(input)).toEqual(refusal);
    barrier.release();
    await until(() => service.snapshot().runs.every((run) => run.state === 'completed'));
  });
  it('records a successful acquisition after cancellation and cleans it without executing', async () => {
    const storage = await open();
    const acquired = gate();
    const actual = createControlledDriver({ root: join(directory, 'resources') });
    let executions = 0;
    const service = runtime(storage, {
      ...actual,
      async acquire(intent) {
        await acquired.promise;
        return actual.acquire(intent, new AbortController().signal);
      },
      async execute() {
        executions += 1;
      },
    });
    const accepted = start(service, device(storage));
    await until(() => service.snapshot().runs[0]?.state === 'starting');
    service.cancel({ commandId: randomUUID(), runId: accepted.runId });
    expect(service.snapshot().runs[0]?.state).toBe('stopping');
    expect(service.snapshot().resources).toHaveLength(1);
    acquired.release();
    await until(() => service.snapshot().runs[0]?.state === 'cancelled');
    expect(executions).toBe(0);
    expect(readdirSync(join(directory, 'resources'))).toEqual([]);
  });
  it('keeps failed cleanup stopping with occupied capacity until a later bounded reconciliation succeeds', async () => {
    const storage = await open();
    const root = join(directory, 'resources');
    const fixture = join(directory, 'fixture');
    const actual = createControlledDriver({
      root,
      fixture: { directory: fixture, scenario: 'cleanup-fails' },
    });
    const service = runtime(storage, { ...actual, async execute() {} });
    const id = device(storage);
    start(service, id);
    await until(() => service.snapshot().resources[0]?.failure === 'CLEANUP_FAILED');
    expect(service.snapshot().runs[0]?.state).toBe('stopping');
    expect(service.start({ commandId: randomUUID(), deviceId: id })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(storage.store.devices.delete({ id })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    writeFileSync(join(fixture, 'allow-cleanup'), '');
    await until(() => service.snapshot().runs[0]?.state === 'completed');
    expect(readdirSync(root)).toEqual([]);
  });
  it('interrupts every previous nonterminal and reconciles a created resource whose result was never recorded', async () => {
    const storage = await open();
    const receipts = Array.from({ length: 4 }, () =>
      value(storage.work.start({ commandId: randomUUID(), deviceId: device(storage) })),
    );
    const admitted = storage.work.admit();
    if (!admitted) throw new Error('Missing admission');
    const actual = createControlledDriver({ root: join(directory, 'resources') });
    await actual.acquire(admitted.intent, new AbortController().signal);
    expect(readdirSync(join(directory, 'resources'))).toHaveLength(1);
    storage.store.close();
    const db = new Database(join(directory, 'data.db'));
    for (const [index, state] of ['queued', 'starting', 'running', 'stopping'].entries())
      db.prepare('UPDATE work_runs SET state = ? WHERE id = ?').run(state, receipts[index]?.runId);
    db.close();
    const recovered = await open();
    let executions = 0;
    const service = runtime(recovered, {
      ...actual,
      async execute() {
        executions += 1;
      },
    });
    await until(() => service.snapshot().resources.length === 0);
    expect(service.snapshot().runs.map((run) => run.state)).toEqual([
      'interrupted',
      'interrupted',
      'interrupted',
      'interrupted',
    ]);
    expect(executions).toBe(0);
    expect(readdirSync(join(directory, 'resources'))).toEqual([]);
    await service.stop();
    recovered.store.close();
    expect(
      runtime(await open())
        .snapshot()
        .runs.every((run) => run.state === 'interrupted'),
    ).toBe(true);
  });
  it('never deletes borrowed resources and retains unknown ownership as an obligation', async () => {
    const storage = await open();
    const actual = createControlledDriver({
      root: join(directory, 'resources'),
      fixture: { directory: join(directory, 'fixture'), scenario: 'borrowed' },
    });
    const service = runtime(storage, { ...actual, async execute() {} });
    start(service, device(storage));
    await until(() => service.snapshot().runs[0]?.state === 'completed');
    expect(readdirSync(join(directory, 'fixture'))).toContain('borrowed-resource');
    await service.stop();
    const unknown = runtime(storage, {
      async acquire(): Promise<Acquisition> {
        throw new Error('Uncertain acquisition');
      },
      async execute() {},
      async reconcile() {
        return { kind: 'unknown' };
      },
      async release() {
        throw new Error('Must not release unknown');
      },
    });
    start(unknown, device(storage));
    await until(() => unknown.snapshot().resources[0]?.failure === 'OWNERSHIP_UNCERTAIN');
    expect(unknown.snapshot().runs[0]?.state).toBe('stopping');
  });
  it('times out execution durably without releasing capacity before an abort-ignoring operation settles', async () => {
    const storage = await open();
    const barrier = gate();
    let released = 0;
    const actual = createControlledDriver({ root: join(directory, 'resources') });
    const service = runtime(
      storage,
      {
        ...actual,
        async execute() {
          await barrier.promise;
        },
        async release(resource, signal) {
          released += 1;
          await actual.release(resource, signal);
        },
      },
      { executionTimeoutMs: 20, cleanupTimeoutMs: 100, cleanupAttempts: 3 },
    );
    start(service, device(storage));
    await until(() => service.snapshot().runs[0]?.outcome === 'failed');
    expect(service.snapshot().runs[0]?.state).toBe('stopping');
    expect(service.snapshot().resources).toHaveLength(1);
    expect(released).toBe(0);
    barrier.release();
    await until(() => service.snapshot().runs[0]?.state === 'failed');
    expect(released).toBe(1);
  });

  it('bounds cleanup retries and aborts each timed-out attempt while retaining unresolved resources', async () => {
    const storage = await open();
    const actual = createControlledDriver({ root: join(directory, 'resources') });
    let attempts = 0;
    let aborted = 0;
    const service = runtime(
      storage,
      {
        ...actual,
        async execute() {},
        async release(_resource, signal) {
          attempts += 1;
          await new Promise<void>((_resolve, reject) =>
            signal.addEventListener(
              'abort',
              () => {
                aborted += 1;
                reject(new Error('cleanup timeout'));
              },
              { once: true },
            ),
          );
        },
      },
      { executionTimeoutMs: 1000, cleanupTimeoutMs: 20, cleanupAttempts: 2 },
    );
    start(service, device(storage));
    await until(() => aborted === 2);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(attempts).toBe(2);
    expect(service.snapshot().runs[0]?.state).toBe('stopping');
    expect(service.snapshot().resources[0]?.failure).toBe('CLEANUP_FAILED');
    await expect(service.stop()).rejects.toThrow('cleanup is incomplete');
    expect(attempts).toBe(2);
  });

  it('includes every active run and unresolved resource beyond bounded terminal history', async () => {
    const storage = await open();
    const id = device(storage);
    const firstInput = { commandId: randomUUID(), deviceId: id };
    const first = storage.work.start(firstInput);
    storage.work.cancel({ commandId: randomUUID(), runId: value(first).runId });
    for (let index = 0; index < 105; index++) {
      const receipt = value(storage.work.start({ commandId: randomUUID(), deviceId: id }));
      storage.work.cancel({ commandId: randomUUID(), runId: receipt.runId });
    }
    for (let index = 0; index < 105; index++)
      storage.work.start({ commandId: randomUUID(), deviceId: device(storage) });
    expect(storage.work.snapshot().runs.filter((run) => run.state === 'queued')).toHaveLength(105);
    expect(storage.work.snapshot().runs.filter((run) => run.state === 'cancelled')).toHaveLength(
      100,
    );
    expect(storage.work.start(firstInput)).toEqual(first);
  });
});

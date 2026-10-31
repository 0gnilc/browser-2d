import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { secretRefSchema } from '@browser-2d/contracts/host';
import type { Result, Run } from '@browser-2d/contracts/public';
import { openBusinessStore } from '../src/storage/open-business-store';
import type { Acquisition, Obligation } from '../src/work/repository';
import { createWorkService, type ControlledDriver } from '../src/work/service';

const acquisitionSchema = z.object({
  ownership: z.enum(['owned', 'borrowed']),
  externalId: z.string(),
});
const reconciliationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('present'), resource: acquisitionSchema }),
  z.object({ kind: z.literal('absent-final') }),
  z.object({ kind: z.literal('unknown') }),
]);
const stateSchema = z.object({
  pid: z.number(),
  operations: z.array(
    z.object({
      operationId: z.string(),
      runId: z.string(),
      deviceId: z.number(),
      present: z.boolean(),
      fenced: z.boolean(),
      ownership: z.enum(['owned', 'borrowed']),
    }),
  ),
  events: z.array(z.object({ operationId: z.string(), kind: z.string() })),
});
type FixtureState = z.infer<typeof stateSchema>;
type Mode = 'late-success' | 'unknown' | 'borrowed' | 'cleanup-refused';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

async function resourceService() {
  const child = fork(fileURLToPath(new URL('./fixtures/resource-service.mjs', import.meta.url)), {
    execArgv: [],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const exited = once(child, 'exit');
  let port: number;
  try {
    const [message] = await once(child, 'message', { signal: AbortSignal.timeout(5000) });
    port = z.object({ port: z.number() }).parse(message).port;
  } catch (error) {
    child.kill();
    await exited;
    throw error;
  }
  const base = `http://127.0.0.1:${port}`;
  async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(`${base}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`Resource service ${response.status}`);
    return response.json();
  }
  return {
    request,
    state: async () => stateSchema.parse(await request('state')),
    configure: (deviceId: number, mode: Mode) => request('configure', { deviceId, mode }),
    control: (operationId: string, action: string) => request('control', { operationId, action }),
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
    },
  };
}

function serviceDriver(remote: Awaited<ReturnType<typeof resourceService>>): ControlledDriver {
  return {
    async acquire(intent, signal) {
      return acquisitionSchema.parse(await remote.request('acquire', intent, signal));
    },
    async execute(resource: Acquisition, _run: Run, signal: AbortSignal) {
      await remote.request('execute', resource);
      await new Promise<void>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    async reconcile(intent: Obligation, signal: AbortSignal) {
      return reconciliationSchema.parse(await remote.request('reconcile', intent, signal));
    },
    async release(resource: Acquisition, signal: AbortSignal) {
      await remote.request('release', resource, signal);
    },
  };
}

let directory: string;
let remote: Awaited<ReturnType<typeof resourceService>>;
let database: Awaited<ReturnType<typeof openBusinessStore>>;
let service: ReturnType<typeof createWorkService>;
let activeService = false;
let deviceId: number;

beforeEach(async () => {
  activeService = false;
  directory = mkdtempSync(join(tmpdir(), 'browser-2d-resource-service-'));
  remote = await resourceService();
  database = await openBusinessStore({
    path: join(directory, 'data.db'),
    confirmLegacy: async () => true,
    prepareLegacy: async () => secretRefSchema.parse(randomUUID()),
    verifyCredential: async () => undefined,
  });
  const settings = value(database.store.settings.get());
  value(
    database.store.settings.commit({
      values: { ...settings, pageCount: 4 },
      expectedRevision: settings.revision,
      credential: { action: 'retain' },
    }),
  );
  deviceId = value(database.store.devices.create({ symbol: 'external-fixture' })).id;
});
afterEach(async () => {
  try {
    if (activeService) {
      for (const operation of (await remote.state()).operations) {
        for (const action of ['allow-fence', 'allow-release', 'create', 'respond'])
          await remote.control(operation.operationId, action);
      }
      await service.stop();
    }
  } finally {
    try {
      database?.store.close();
    } finally {
      await remote?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

function start(mode: Mode) {
  const driver = serviceDriver(remote);
  service = createWorkService({
    repository: database.work,
    driver:
      mode === 'late-success'
        ? {
            ...driver,
            acquire: async (intent) =>
              acquisitionSchema.parse(await remote.request('acquire', intent)),
          }
        : driver,
    publish: () => undefined,
  });
  activeService = true;
  return value(service.start({ commandId: randomUUID(), deviceId })).runId;
}
async function operationFor(runId: string) {
  await expect
    .poll(async () => (await remote.state()).operations.some((item) => item.runId === runId))
    .toBe(true);
  const operation = (await remote.state()).operations.find((item) => item.runId === runId);
  if (!operation) throw new Error('External operation missing');
  return operation.operationId;
}
const runState = (runId: string) =>
  service.snapshot().runs.find((item) => item.id === runId)?.state;
const eventKinds = (state: FixtureState, operationId: string) =>
  state.events.filter((event) => event.operationId === operationId).map((event) => event.kind);
function cancel(runId: string) {
  expect(value(service.cancel({ commandId: randomUUID(), runId })).disposition).toBe(
    'stop-requested',
  );
}

describe('scheduler against a separate resource service', () => {
  it('cleans a successful late acquire after durable cancellation without executing it', async () => {
    await remote.configure(deviceId, 'late-success');
    const runId = start('late-success');
    const operationId = await operationFor(runId);
    expect((await remote.state()).pid).not.toBe(process.pid);
    expect(service.snapshot().resources).toMatchObject([{ operationId, state: 'intent' }]);
    cancel(runId);
    await remote.control(operationId, 'create');
    expect(runState(runId)).toBe('stopping');
    expect((await remote.state()).operations[0]?.present).toBe(true);
    expect(service.start({ commandId: randomUUID(), deviceId })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    await remote.control(operationId, 'respond');
    await expect.poll(() => runState(runId)).toBe('cancelled');
    expect(service.snapshot().resources).toEqual([]);
    const external = await remote.state();
    expect(external.operations[0]).toMatchObject({ present: false, fenced: true });
    expect(eventKinds(external, operationId)).toEqual([
      'acquire-requested',
      'created',
      'acquire-response',
      'released',
    ]);
  });

  it('retains unknown acquisition capacity until fencing prevents future creation', async () => {
    await remote.configure(deviceId, 'unknown');
    const runId = start('unknown');
    const operationId = await operationFor(runId);
    cancel(runId);
    await expect
      .poll(async () => eventKinds(await remote.state(), operationId).includes('transient-absence'))
      .toBe(true);
    await expect
      .poll(
        () =>
          service.snapshot().resources.find((item) => item.operationId === operationId)?.failure,
      )
      .toBe('OWNERSHIP_UNCERTAIN');
    expect(runState(runId)).toBe('stopping');
    expect(service.snapshot().resources).toMatchObject([
      { operationId, pages: 4, ownership: 'unknown', failure: 'OWNERSHIP_UNCERTAIN' },
    ]);
    const otherId = value(database.store.devices.create({ symbol: 'wait-for-capacity' })).id;
    await remote.configure(otherId, 'borrowed');
    const waiting = value(service.start({ commandId: randomUUID(), deviceId: otherId })).runId;
    expect((await remote.state()).operations).toHaveLength(1);
    expect(runState(waiting)).toBe('queued');
    await remote.control(operationId, 'allow-fence');
    await expect.poll(() => runState(runId), { timeout: 4000 }).toBe('cancelled');
    await expect.poll(() => runState(waiting)).toBe('running');
    await remote.control(operationId, 'create');
    const external = await remote.state();
    expect(external.operations.find((item) => item.operationId === operationId)).toMatchObject({
      present: false,
      fenced: true,
    });
    expect(eventKinds(external, operationId)).toContain('creation-suppressed');
    expect(eventKinds(external, operationId)).not.toContain('executed');
    const fenceIndex = external.events.findIndex((event) => event.kind === 'fenced');
    const waitingIndex = external.events.findIndex((event) => event.operationId !== operationId);
    expect(fenceIndex).toBeLessThan(waitingIndex);
    cancel(waiting);
    await expect.poll(() => runState(waiting)).toBe('cancelled');
  });

  it('detaches a borrowed resource while keeping its external resource alive', async () => {
    await remote.configure(deviceId, 'borrowed');
    const runId = start('borrowed');
    const operationId = await operationFor(runId);
    await expect.poll(() => runState(runId)).toBe('running');
    cancel(runId);
    await expect.poll(() => runState(runId)).toBe('cancelled');
    expect(service.snapshot().resources).toEqual([]);
    const external = await remote.state();
    expect(external.operations[0]).toMatchObject({ ownership: 'borrowed', present: true });
    expect(eventKinds(external, operationId)).toEqual([
      'acquire-requested',
      'created',
      'acquire-response',
      'executed',
      'detached',
    ]);
  });

  it('keeps refused cleanup visible and blocks the device and page capacity until release succeeds', async () => {
    await remote.configure(deviceId, 'cleanup-refused');
    const runId = start('cleanup-refused');
    const operationId = await operationFor(runId);
    await expect.poll(() => runState(runId)).toBe('running');
    cancel(runId);
    await expect
      .poll(
        () =>
          service.snapshot().resources.find((item) => item.operationId === operationId)?.failure,
      )
      .toBe('CLEANUP_FAILED');
    expect(runState(runId)).toBe('stopping');
    expect((await remote.state()).operations[0]?.present).toBe(true);
    expect(service.start({ commandId: randomUUID(), deviceId })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(database.store.devices.delete({ id: deviceId })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    const otherId = value(database.store.devices.create({ symbol: 'blocked-by-cleanup' })).id;
    await remote.configure(otherId, 'borrowed');
    const waiting = value(service.start({ commandId: randomUUID(), deviceId: otherId })).runId;
    expect((await remote.state()).operations).toHaveLength(1);
    expect(runState(waiting)).toBe('queued');
    await remote.control(operationId, 'allow-release');
    await expect.poll(() => runState(runId), { timeout: 4000 }).toBe('cancelled');
    await expect.poll(() => runState(waiting)).toBe('running');
    const external = await remote.state();
    expect(external.operations[0]?.present).toBe(false);
    const releasedIndex = external.events.findIndex((event) => event.kind === 'released');
    const waitingIndex = external.events.findIndex((event) => event.operationId !== operationId);
    expect(releasedIndex).toBeGreaterThan(-1);
    expect(releasedIndex).toBeLessThan(waitingIndex);
    cancel(waiting);
    await expect.poll(() => runState(waiting)).toBe('cancelled');
  });
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, dirname, relative, isAbsolute, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { app, utilityProcess } from 'electron';
import { z } from 'zod';
import {
  browserSnapshotSchema,
  taskIdSchema,
  executionNonceSchema,
  type TaskProcessEvent,
} from '@browser-2d/contracts/host';
import { verifyProductionWorker } from './production-worker';
import { superviseTask, type TaskOptions } from '../main/task-supervisor';
import { isolatedProcessEnvironment } from '../main/isolated-process-environment';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function until(check: () => boolean, label: string) {
  const end = Date.now() + 15_000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await delay(10);
  }
}
const responseSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ready') }),
  z.strictObject({ kind: z.literal('busy-started') }),
  z.strictObject({
    kind: z.literal('response'),
    id: z.number().int(),
    row: z.strictObject({ value: z.number().int() }),
  }),
]);

export async function verifyTaskProcesses(reportPath: string) {
  const directory = dirname(resolve(reportPath));
  const suffix = relative(tmpdir(), directory);
  assert(
    !isAbsolute(suffix) && !suffix.startsWith('..') && suffix.startsWith('browser-2d-process-'),
  );
  assert.equal(join(directory, 'report.json'), resolve(reportPath));
  process.env.BROWSER2D_TEST_SECRET = 'environment-isolation-probe';
  const require = createRequire(join(app.getAppPath(), 'package.json'));
  const runtime = dirname(require.resolve('@browser-2d/backend/browser-worker'));
  const database = utilityProcess.fork(join(runtime, 'verification/data-service.cjs'), [], {
    env: isolatedProcessEnvironment('verification'),
  });
  const dbReady = deferred<void>();
  const dbExit = deferred<number>();
  const dbBusy = deferred<void>();
  const replies = new Map<number, (value: number) => void>();
  let nextId = 0;
  database.on('message', (raw: unknown) => {
    const event = responseSchema.parse(raw);
    if (event.kind === 'ready') dbReady.resolve();
    if (event.kind === 'busy-started') dbBusy.resolve();
    if (event.kind === 'response') {
      replies.get(event.id)?.(event.row.value);
      replies.delete(event.id);
    }
  });
  database.on('exit', (code) => dbExit.resolve(code));
  database.on('spawn', () =>
    database.postMessage({
      kind: 'open',
      path: join(directory, 'proof.sqlite'),
      ...(app.isPackaged ? {} : { binding: process.env.BROWSER2D_NATIVE_BINDING }),
    }),
  );
  function dbRequest(kind: 'read' | 'write' | 'busy') {
    const id = ++nextId;
    return new Promise<number>((done) => {
      replies.set(id, done);
      database.postMessage({ kind, id });
    });
  }
  const workers: ReturnType<typeof superviseTask>[] = [];
  const reports: object[] = [];
  const snapshot = browserSnapshotSchema.parse({
    id: 1,
    provider: 'adspower',
    profileId: 'controlled',
    name: 'Controlled',
    account: 'snapshot-input',
    amount: 29,
    count: 0,
    status: 'idle',
    notes: '',
    lastError: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  function launch(behavior: string, change: Partial<TaskOptions> = {}) {
    let open = false;
    let releases = 0;
    let pulses = 0;
    let requests = 0;
    let running: TaskProcessEvent | undefined;
    const seen = new Set<number>();
    const child = utilityProcess.fork(
      join(runtime, 'verification/browser-worker.cjs'),
      [behavior],
      { env: isolatedProcessEnvironment('verification') },
    );
    const worker = superviseTask(child, join(runtime, 'verification/browser-worker.cjs'), {
      taskId: taskIdSchema.parse(randomUUID()),
      executionNonce: executionNonceSchema.parse(randomUUID()),
      browser: snapshot,
      environment: {
        async open() {
          open = true;
          return {
            processor: 'baidu-check',
            endpoint: 'ws://127.0.0.1:1',
            url: 'https://www.baidu.com',
          };
        },
        async close() {
          open = false;
        },
        async closed() {
          return !open;
        },
      },
      async fence() {
        await dbRequest('write');
      },
      async release() {
        assert(!open);
        releases++;
      },
      async request() {
        requests++;
        await dbRequest('read');
      },
      ...change,
      observe(event) {
        if (event.kind === 'pulse') {
          pulses++;
          seen.add(event.sequence);
        }
        if (event.kind === 'running') running = event;
        change.observe?.(event);
      },
    });
    workers.push(worker);
    return {
      worker,
      fatal() {
        child.emit('error', 'FatalError', 'fixture-location', 'fixture-report');
      },
      seen,
      get pulses() {
        return pulses;
      },
      get requests() {
        return requests;
      },
      get releases() {
        return releases;
      },
      get running() {
        return running;
      },
    };
  }
  try {
    await dbReady.promise;
    assert.equal(await dbRequest('write'), 1);
    const peer = launch('healthy');
    await until(
      () => peer.worker.state.kind === 'running' && peer.requests > 0,
      'healthy peer ready',
    );
    for (const behavior of ['cpu-loop', 'ignore-cancel', 'ignore-sigterm']) {
      const selected = launch(behavior);
      await until(() => selected.worker.state.kind === 'running', 'selected running');
      assert.deepEqual(selected.running, { kind: 'running' });
      if (behavior === 'ignore-cancel') {
        selected.worker.cancel();
        await until(() => selected.seen.has(999_999), 'thread cancellation acknowledgment');
        const prior = selected.pulses;
        await until(() => selected.pulses > prior, 'execution after ignored cancellation');
      }
      if (behavior === 'ignore-sigterm' && process.platform !== 'win32') {
        selected.worker.cancel();
        await until(() => selected.seen.has(999_998), 'host signal acknowledgment');
        const prior = selected.pulses;
        await until(() => selected.pulses > prior, 'execution after ignored SIGTERM');
      }
      let busyFinished = false;
      const busy =
        behavior === 'cpu-loop'
          ? dbRequest('busy').then(() => {
              busyFinished = true;
            })
          : Promise.resolve();
      if (behavior === 'cpu-loop') await dbBusy.promise;
      const clicked = performance.now();
      const stop = selected.worker.stop();
      assert.equal(selected.worker.state.kind, 'stopping');
      const repeats = selected.worker.stop();
      assert.equal(stop, repeats);
      await selected.worker.exited;
      if (behavior === 'cpu-loop')
        assert.equal(busyFinished, false, 'selected exit must not wait for busy SQL');
      const outcome = await stop;
      await busy;
      assert.equal(outcome.kind, 'exited');
      assert.equal(selected.releases, 1);
      const peerBefore = peer.pulses;
      await until(() => peer.pulses > peerBefore, 'peer alive after selected exit');
      const dbAfter = await dbRequest('write');
      assert(dbAfter > 1);
      reports.push({
        behavior:
          behavior === 'ignore-sigterm' && process.platform === 'win32'
            ? 'stop-control (POSIX SIGTERM not applicable)'
            : behavior,
        gateMs: selected.worker.evidence.gateClosedAt! - clicked,
        exitMs: selected.worker.evidence.exitedAt! - clicked,
        closedMs: selected.worker.evidence.environmentClosedAt! - clicked,
        releasedMs: selected.worker.evidence.releasedAt! - clicked,
        peerAlive: true,
        dbCommitted: dbAfter,
        busySqlIndependent: behavior === 'cpu-loop',
      });
    }
    const beforeReady = launch('healthy');
    assert.equal((await beforeReady.worker.stop()).kind, 'exited');
    assert.equal(beforeReady.running, undefined);
    reports.push({ behavior: 'stop-before-ready', result: 'passed' });

    const opened = deferred<void>();
    const finishOpen = deferred<void>();
    const finishClose = deferred<void>();
    let lateOpen = false;
    let lateClosed = false;
    const late = launch('healthy', {
      environment: {
        async open() {
          opened.resolve();
          await finishOpen.promise;
          lateOpen = true;
          return {
            processor: 'baidu-check',
            endpoint: 'ws://127.0.0.1:1',
            url: 'https://www.baidu.com',
          };
        },
        async close() {
          await finishClose.promise;
          lateOpen = false;
          lateClosed = true;
        },
        async closed() {
          return lateClosed && !lateOpen;
        },
      },
    });
    await opened.promise;
    const lateStop = late.worker.stop();
    await late.worker.exited;
    assert.equal(late.releases, 0);
    finishOpen.resolve();
    await delay(30);
    assert.equal(late.releases, 0);
    finishClose.resolve();
    assert.equal((await lateStop).kind, 'exited');
    assert.equal(late.releases, 1);
    reports.push({ behavior: 'late-start-delayed-close', result: 'passed' });

    let allowClose = false;
    const failed = launch('healthy', {
      environment: {
        async open() {
          return {
            processor: 'baidu-check',
            endpoint: 'ws://127.0.0.1:1',
            url: 'https://www.baidu.com',
          };
        },
        async close() {
          if (!allowClose) throw Error('Controlled close failure');
        },
        async closed() {
          return allowClose;
        },
      },
    });
    await until(() => failed.worker.state.kind === 'running', 'close failure task ready');
    assert.equal((await failed.worker.stop()).kind, 'blocked');
    assert.equal(failed.releases, 0);
    allowClose = true;
    assert.equal((await failed.worker.stop()).kind, 'exited');
    assert.equal(failed.releases, 1);
    reports.push({ behavior: 'failed-close-retry', result: 'passed' });

    let frozenFence: Promise<void> | undefined;
    const frozen = launch('freeze-host', {
      deadlineMs: 100,
      fence() {
        frozenFence ??= dbRequest('write').then(() => undefined);
        return frozenFence;
      },
    });
    await until(() => frozen.worker.state.kind === 'running', 'frozen host fixture ready');
    frozen.worker.cancel();
    await until(() => frozen.seen.has(999_997), 'host frozen');
    assert.equal((await frozen.worker.stop()).kind, 'blocked');
    assert.equal(frozen.releases, 0);
    await frozen.worker.exited;
    assert(frozenFence);
    await frozenFence;
    assert.equal(frozen.releases, 0);
    const recovered = await frozen.worker.stop();
    assert.equal(recovered.kind, 'exited', JSON.stringify(recovered));
    reports.push({ behavior: 'unconfirmed-exit-retains-reservation', result: 'passed' });

    const closeStarted = deferred<void>();
    const closeFinished = deferred<void>();
    let closeCalls = 0;
    const pendingClose = launch('healthy', {
      deadlineMs: 100,
      environment: {
        async open() {
          return {
            processor: 'baidu-check',
            endpoint: 'ws://127.0.0.1:1',
            url: 'https://www.baidu.com',
          };
        },
        async close() {
          closeCalls++;
          closeStarted.resolve();
          await closeFinished.promise;
        },
        async closed() {
          return true;
        },
      },
    });
    await until(() => pendingClose.worker.state.kind === 'running', 'pending close fixture ready');
    const firstClose = pendingClose.worker.stop();
    await closeStarted.promise;
    assert.equal((await firstClose).kind, 'blocked');
    assert.equal((await pendingClose.worker.stop()).kind, 'blocked');
    assert.equal(closeCalls, 1, 'an unresolved close cannot be repeated');
    assert.equal(
      pendingClose.releases,
      0,
      'reservation must prevent replacement while close is unresolved',
    );
    const finalClose = pendingClose.worker.stop();
    closeFinished.resolve();
    assert.equal((await finalClose).kind, 'exited');
    assert.equal(closeCalls, 1);
    assert.equal(pendingClose.releases, 1);
    reports.push({ behavior: 'pending-close-retry-retains-reservation', result: 'passed' });

    const releaseStarted = deferred<void>();
    const releaseFinished = deferred<void>();
    const repeatedCloseFinished = deferred<void>();
    let releaseCloseCalls = 0;
    let releaseCalls = 0;
    let released = false;
    const releaseFence = dbRequest('write').then(() => undefined);
    const pendingRelease = launch('healthy', {
      deadlineMs: 100,
      fence: () => releaseFence,
      environment: {
        async open() {
          return {
            processor: 'baidu-check',
            endpoint: 'ws://127.0.0.1:1',
            url: 'https://www.baidu.com',
          };
        },
        async close() {
          releaseCloseCalls++;
          if (releaseCloseCalls > 1) await repeatedCloseFinished.promise;
        },
        async closed() {
          return true;
        },
      },
      async release() {
        releaseCalls++;
        releaseStarted.resolve();
        await releaseFinished.promise;
        released = true;
      },
    });
    await until(() => pendingRelease.worker.state.kind === 'running', 'pending release ready');
    await releaseFence;
    const firstRelease = pendingRelease.worker.stop();
    await releaseStarted.promise;
    await pendingRelease.worker.exited;
    assert.equal((await firstRelease).kind, 'blocked');
    assert.equal(released, false);
    const retryRelease = pendingRelease.worker.stop();
    await delay(30);
    releaseFinished.resolve();
    await until(() => released, 'original release completed');
    try {
      assert.equal(releaseCloseCalls, 1, 'release cannot race a repeated environment close');
      assert.equal((await retryRelease).kind, 'exited');
      assert.equal(releaseCalls, 1);
      assert.equal((await pendingRelease.worker.stop()).kind, 'exited');
      assert.equal(releaseCloseCalls, 1);
      assert.equal(releaseCalls, 1);
    } finally {
      repeatedCloseFinished.resolve();
    }
    reports.push({ behavior: 'pending-release-retry-reuses-closed-environment', result: 'passed' });

    const fatal = launch('healthy');
    await until(() => fatal.worker.state.kind === 'running', 'fatal event fixture ready');
    assert.doesNotThrow(() => fatal.fatal());
    await until(() => fatal.worker.state.kind === 'exited', 'fatal error cleanup');
    assert.equal(fatal.releases, 1);
    reports.push({ behavior: 'utility-process-fatal-error', result: 'passed' });

    const forged = launch('forge-identity');
    await until(() => forged.worker.state.kind === 'exited', 'forged identity stopped');
    assert.equal(forged.requests, 0);
    reports.push({ behavior: 'source-bound-identity', result: 'passed' });
    const crashed = launch('crash');
    await until(() => crashed.worker.state.kind === 'exited', 'crashed task cleaned');
    assert.equal(crashed.releases, 1);
    reports.push({ behavior: 'thread-crash', result: 'passed' });
    const orphan = launch('healthy');
    await until(() => orphan.worker.state.kind === 'running', 'orphan fixture ready');
    orphan.worker.pauseHeartbeat();
    await until(() => orphan.worker.state.kind === 'exited', 'parent lease loss');
    assert.equal(orphan.releases, 1);
    reports.push({ behavior: 'parent-lease-loss', result: 'passed' });
    assert.equal((await peer.worker.stop()).kind, 'exited');
    assert((await dbRequest('write')) > 1);
    reports.push(
      await verifyProductionWorker({
        runtime,
        browser: snapshot,
        commit: async () => {
          await dbRequest('write');
        },
      }),
    );
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          result: 'VERIFIED',
          platform: process.platform,
          arch: process.arch,
          electron: process.versions.electron,
          packaged: app.isPackaged,
          runtime,
          reports,
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all(workers.map((worker) => worker.stop()));
    database.postMessage({ kind: 'close', id: ++nextId });
    await dbExit.promise;
  }
}

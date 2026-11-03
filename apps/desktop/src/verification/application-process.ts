import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, utilityProcess } from 'electron';
import type { Result, BrowserId } from '@browser-2d/contracts/public';
import {
  dataOperations,
  type DataMethod,
  type DataInput,
  type DataResult,
  type PreparedTask,
  type SessionFingerprint,
} from '@browser-2d/contracts/host';
import type { DataClient } from '../main/data-service-client';
import { launchDataService } from '../main/data-service-client';
import { createTaskCoordinator } from '../main/task-coordinator';
import { createExecutionOwnership } from '../main/execution-ownership';
import { superviseTask } from '../main/task-supervisor';
import { isolatedProcessEnvironment } from '../main/isolated-process-environment';
import type {
  BrowserPlatform,
  StartOutcome,
  CloseOutcome,
} from '../main/browser-platforms/adspower';
function value<T>(result: Result<T>): T {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}
async function until(check: () => Promise<boolean> | boolean, label: string) {
  const deadline = Date.now() + 20_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await delay(10);
  }
}
export async function verifyApplicationProcesses(directory: string, runtime: string) {
  const root = join(directory, 'application');
  await mkdir(root, { recursive: true });
  const behaviors = new Map<string, string>();
  const sessions = new Map<string, SessionFingerprint>();
  const closeFailures = new Set<string>();
  const unknownStarts = new Set<string>();
  const lateStarts = new Map<string, () => void>();
  const launchCounts = new Map<BrowserId, number>();
  const claimedNumbers = new Map<BrowserId, string>();
  let deferStart: string | undefined;
  let coordinator: ReturnType<typeof createTaskCoordinator>;
  const data = launchDataService({
    dataPath: join(root, 'app.sqlite'),
    entry: join(runtime, 'verification/application-data-service.cjs'),
    nativeBinding: app.isPackaged ? undefined : process.env.BROWSER2D_NATIVE_BINDING,
    onChanged() {},
    onUnavailable() {
      coordinator?.unavailable();
    },
  });
  const platform: BrowserPlatform = {
    inspect: async (profileId) =>
      sessions.has(profileId)
        ? { kind: 'active', endpoint: sessions.get(profileId)?.endpoint ?? null }
        : { kind: 'inactive' },
    async start(profileId): Promise<StartOutcome> {
      if (deferStart === profileId)
        await new Promise<void>((resolve) => lateStarts.set(profileId, resolve));
      if (unknownStarts.has(profileId))
        return { kind: 'uncertain', message: 'Fixture lost start response' };
      const id = randomUUID();
      const session = { endpoint: `ws://127.0.0.1:1/devtools/browser/${id}`, browserTargetId: id };
      sessions.set(profileId, session);
      return { kind: 'opened', session };
    },
    async closeOwned({ profileId, session }): Promise<CloseOutcome> {
      if (closeFailures.has(profileId))
        return { kind: 'uncertain', message: 'Fixture close failure' };
      if (sessions.get(profileId)?.endpoint !== session.endpoint)
        return { kind: 'foreign_session', message: 'Replacement preserved' };
      sessions.delete(profileId);
      return { kind: 'closed', session };
    },
  };
  const heldFences = new Map<string, Promise<void>>();
  const lostReleaseReplies = new Set<string>();
  const failedWitnessRemovals = new Set<string>();
  const failedAfterUnlink = new Set<string>();
  const coordinatorData: DataClient = {
    get available() {
      return data.available;
    },
    async request<M extends DataMethod>(method: M, input: DataInput<M>): Promise<DataResult<M>> {
      if (method === 'tasks.fence')
        await heldFences.get(dataOperations['tasks.fence'].input.parse(input).taskId);
      const result = await data.request(method, input);
      if (
        method === 'tasks.finish' &&
        'ok' in result &&
        result.ok &&
        lostReleaseReplies.delete(
          dataOperations['tasks.finish'].input.parse(input).execution.taskId,
        )
      )
        throw new Error('Fixture lost committed release acknowledgment');
      return result;
    },
  };
  const options = {
    data: coordinatorData,
    ownershipDirectory: join(root, 'execution-owners'),
    connection: async () => ({ apiBaseUrl: 'http://127.0.0.1:1', apiKey: 'isolated-test-only' }),
    changed() {},
    platform: () => platform,
    checkpoint(point: string, task: PreparedTask) {
      if (point === 'post-release-pre-unlink' && failedAfterUnlink.delete(task.browser.profileId)) {
        createExecutionOwnership(join(root, 'execution-owners')).remove({
          taskId: task.id,
          executionNonce: task.execution.nonce,
        });
        throw new Error('Fixture failed after witness unlink');
      }
      if (
        point === 'post-release-pre-unlink' &&
        failedWitnessRemovals.delete(task.browser.profileId)
      )
        throw new Error('Fixture failed witness removal after committed release');
    },
    spawn(task: Parameters<typeof superviseTask>[2]) {
      launchCounts.set(task.browser.id, (launchCounts.get(task.browser.id) ?? 0) + 1);
      const entry = join(runtime, 'verification/card-worker.cjs');
      const child = utilityProcess.fork(entry, [behaviors.get(task.browser.profileId) ?? 'cards'], {
        env: isolatedProcessEnvironment('verification'),
      });
      return superviseTask(child, entry, {
        ...task,
        async request(request, sequence) {
          const reply = await task.request(request, sequence);
          if (
            reply.kind === 'next_card' &&
            reply.result.ok &&
            reply.result.value.kind === 'claimed'
          )
            claimedNumbers.set(task.browser.id, reply.result.value.claim.card.number);
          return reply;
        },
      });
    },
  };
  const reports: object[] = [];
  const controls: ReturnType<typeof createTaskCoordinator>[] = [];
  async function browser(profileId: string) {
    return value(
      await data.request('browsers.create', {
        provider: 'adspower',
        profileId,
        name: profileId,
        account: 'snapshot-input',
        amount: '0.29',
        notes: '',
      }),
    );
  }
  async function importCards(...numbers: string[]) {
    value(
      await data.request('cards.importText', {
        text: numbers.map((number) => `${number}|01|2030|000|||||||`).join('\n'),
      }),
    );
  }
  async function cards() {
    return value(await data.request('cards.list', { page: 1, pageSize: 200 })).items;
  }
  async function emptyTasks() {
    return value(await data.request('tasks.list', undefined)).length === 0;
  }
  try {
    await data.ready;
    coordinator = createTaskCoordinator(options);
    controls.push(coordinator);
    await coordinator.recover();
    const sequential = await browser('sequential');
    await importCards('A', 'B', 'C');
    const accepted = value(await coordinator.start({ browserId: sequential.id }));
    assert.equal(value(await coordinator.start({ browserId: sequential.id })).id, accepted.id);
    await until(emptyTasks, 'three sequential Cards exhausted and cleaned');
    assert.deepEqual(
      (await cards()).map((card) => [card.number, card.status, card.amount, card.extra]),
      ['A', 'B', 'C'].map((number) => [number, 'processed', '1.00', 'controlled-committed']),
    );
    assert.equal(
      value(await data.request('browsers.list', undefined)).find((row) => row.id === sequential.id)
        ?.count,
      3,
    );
    assert.equal(launchCounts.get(sequential.id), 1);
    assert.equal(sessions.size, 0);
    reports.push({ behavior: 'real-data-service-three-cards-one-worker-replay', result: 'passed' });

    const selected = await browser('selected');
    const peer = await browser('peer');
    const queued = await browser('queued');
    behaviors.set('selected', 'cards-cpu-loop');
    behaviors.set('peer', 'cards-hold');
    await importCards('D', 'E', 'F');
    value(await coordinator.start({ browserId: selected.id }));
    value(await coordinator.start({ browserId: peer.id }));
    value(await coordinator.start({ browserId: queued.id }));
    await until(
      async () =>
        (await cards()).filter((card) => card.status === 'processing' && card.amount === '1.00')
          .length === 2,
      'two committed current Cards',
    );
    assert.equal(launchCounts.get(queued.id), undefined);
    assert.equal(value(await coordinator.stop({ browserId: queued.id })).kind, 'stopped');
    const stop = coordinator.stop({ browserId: selected.id });
    assert.equal(coordinator.live.find((entry) => entry.taskId !== accepted.id)?.gate, 'stopping');
    assert.equal(
      value(await coordinator.list()).find((entry) => entry.browserId === selected.id)?.state,
      'stopping',
    );
    const repeated = coordinator.stop({ browserId: selected.id });
    assert.equal(value(await stop).kind, 'stopped');
    assert.equal(value(await repeated).kind, 'stopped');
    const afterStop = await cards();
    assert.equal(
      afterStop.find((card) => card.number === claimedNumbers.get(selected.id))?.status,
      'pending',
    );
    assert.equal(
      afterStop.find((card) => card.number === claimedNumbers.get(selected.id))?.amount,
      '1.00',
    );
    assert.equal(
      afterStop.find((card) => card.number === claimedNumbers.get(peer.id))?.status,
      'processing',
    );
    assert(sessions.has('peer'));
    const free = afterStop.find((card) => card.number === 'F');
    assert(free);
    value(
      await data.request('cards.update', {
        id: free.id,
        notes: 'DataService progresses after selected CPU loop stop',
      }),
    );
    assert.equal(value(await coordinator.stop({ browserId: peer.id })).kind, 'stopped');
    behaviors.set('selected', 'cards');
    value(await coordinator.start({ browserId: selected.id }));
    await until(emptyTasks, 'reclaimed Cards finish');
    assert((await cards()).every((card) => card.amount === '1.00'));
    assert.equal(
      value(await data.request('browsers.list', undefined)).find((row) => row.id === selected.id)
        ?.count,
      3,
    );
    assert.equal(launchCounts.get(queued.id), undefined);
    reports.push({
      behavior: 'real-card-cpu-stop-peer-progress-fifo-no-fork-reclaim-dedupe',
      result: 'passed',
    });

    const failed = await browser('close-failure');
    behaviors.set(failed.profileId, 'cards-hold');
    closeFailures.add(failed.profileId);
    await importCards('G');
    value(await coordinator.start({ browserId: failed.id }));
    await until(
      async () =>
        (await cards()).some(
          (card) => card.number === 'G' && card.extra === 'controlled-committed',
        ),
      'close failure current Card',
    );
    assert.equal(value(await coordinator.stop({ browserId: failed.id })).kind, 'recovery_required');
    assert.equal((await cards()).find((card) => card.number === 'G')?.status, 'processing');
    closeFailures.delete(failed.profileId);
    const retry = value(await coordinator.stop({ browserId: failed.id }));
    assert.equal(retry.kind, 'stopped', JSON.stringify({ retry, live: coordinator.live }));
    assert.equal((await cards()).find((card) => card.number === 'G')?.status, 'pending');
    reports.push({ behavior: 'real-card-close-failure-retains-claim-retry', result: 'passed' });

    const ownership = createExecutionOwnership(options.ownershipDirectory);
    for (const fault of ['lost-release-reply', 'failed-witness-removal', 'failed-after-unlink']) {
      const released = await browser(fault);
      behaviors.set(released.profileId, 'cards-hold');
      const oldTask = value(await coordinator.start({ browserId: released.id }));
      await until(
        async () =>
          (await cards()).some(
            (card) => card.status === 'processing' && card.extra === 'controlled-committed',
          ),
        `${fault} committed current Card`,
      );
      const committed = (await cards()).find((card) => card.status === 'processing');
      assert(committed);
      const count = value(await data.request('browsers.list', undefined)).find(
        (row) => row.id === released.id,
      )?.count;
      if (fault === 'lost-release-reply') lostReleaseReplies.add(oldTask.id);
      else if (fault === 'failed-witness-removal') failedWitnessRemovals.add(released.profileId);
      else failedAfterUnlink.add(released.profileId);
      assert.equal(
        value(await coordinator.stop({ browserId: released.id })).kind,
        'recovery_required',
      );
      assert(await emptyTasks(), 'release committed before the injected failure');
      const reclaimed = (await cards()).find((card) => card.id === committed.id);
      assert.deepEqual(
        reclaimed && { ...reclaimed, status: committed.status, updatedAt: committed.updatedAt },
        committed,
      );
      assert.equal(reclaimed?.status, 'pending');
      assert.equal(
        ownership.list().some((witness) => witness.execution.taskId === oldTask.id),
        fault !== 'failed-after-unlink',
      );
      const raw = value(await data.request('browsers.list', undefined));
      assert.equal(raw.find((row) => row.id === released.id)?.count, count);
      assert.equal(raw.find((row) => row.id === released.id)?.status, 'idle');
      assert.equal(
        coordinator.projectBrowsers(raw).find((row) => row.id === released.id)?.status,
        'recovery_required',
      );
      const startDuringCleanup = await coordinator.start({ browserId: released.id });
      const retry = value(await coordinator.stop({ browserId: released.id }));
      assert.deepEqual(
        { startBlocked: !startDuringCleanup.ok, retry: retry.kind },
        { startBlocked: true, retry: 'stopped' },
        `${fault} must reconcile the old release before accepting a replacement`,
      );
      assert(!ownership.list().some((witness) => witness.execution.taskId === oldTask.id));
      assert(!coordinator.live.some((entry) => entry.taskId === oldTask.id));
      assert.equal(
        coordinator
          .projectBrowsers(value(await data.request('browsers.list', undefined)))
          .find((row) => row.id === released.id)?.status,
        'idle',
      );
      const fresh = value(await coordinator.start({ browserId: released.id }));
      assert.notEqual(fresh.id, oldTask.id);
      await until(
        () =>
          coordinator.live.some(
            (entry) => entry.taskId === fresh.id && entry.state?.kind === 'running',
          ),
        `${fault} replacement running`,
      );
      assert.equal(value(await coordinator.start({ browserId: released.id })).id, fresh.id);
      assert.equal(value(await coordinator.stop({ browserId: released.id })).kind, 'stopped');
      assert(await emptyTasks());
      reports.push({ behavior: `real-data-service-${fault}-retry`, result: 'passed' });
    }

    const fenced = await browser('fence-pending');
    behaviors.set(fenced.profileId, 'cards-hold');
    const fenceTask = value(await coordinator.start({ browserId: fenced.id }));
    await until(
      async () =>
        (await cards()).some(
          (card) => card.status === 'processing' && card.extra === 'controlled-committed',
        ),
      'current Card before held database fence',
    );
    let releaseFence!: () => void;
    const fenceGate = new Promise<void>((resolve) => {
      releaseFence = resolve;
    });
    heldFences.set(fenceTask.id, fenceGate);
    const heldStop = coordinator.stop({ browserId: fenced.id });
    await until(
      () =>
        coordinator.live.find((entry) => entry.taskId === fenceTask.id)?.evidence?.exitedAt !==
        undefined,
      'execution exits before DB fence acknowledgment',
    );
    assert.equal(
      value(await data.request('tasks.list', undefined)).find((task) => task.id === fenceTask.id)
        ?.state,
      'running',
    );
    assert.equal(
      value(await coordinator.list()).find((task) => task.id === fenceTask.id)?.state,
      'stopping',
    );
    const rawBrowsers = value(await data.request('browsers.list', undefined));
    assert.equal(rawBrowsers.find((browser) => browser.id === fenced.id)?.status, 'working');
    assert.equal(
      coordinator.projectBrowsers(rawBrowsers).find((browser) => browser.id === fenced.id)?.status,
      'stopping',
    );
    releaseFence();
    assert.equal(value(await heldStop).kind, 'stopped');
    reports.push({
      behavior: 'Main-live-stopping-projection-before-database-fence-ack',
      result: 'passed',
    });

    const foreign = await browser('foreign-replacement');
    behaviors.set(foreign.profileId, 'cards-hold');
    value(await coordinator.start({ browserId: foreign.id }));
    await until(() => sessions.has(foreign.profileId), 'owned environment before replacement');
    await until(
      async () =>
        (await cards()).some(
          (card) => card.status === 'processing' && card.extra === 'controlled-committed',
        ),
      'claimed Card before replacement',
    );
    const owned = sessions.get(foreign.profileId);
    assert(owned);
    const replacementSession = {
      endpoint: 'ws://127.0.0.1:1/devtools/browser/foreign',
      browserTargetId: 'foreign',
    };
    sessions.set(foreign.profileId, replacementSession);
    assert.equal(
      value(await coordinator.stop({ browserId: foreign.id })).kind,
      'recovery_required',
    );
    assert.equal(sessions.get(foreign.profileId), replacementSession);
    assert((await cards()).some((card) => card.status === 'processing'));
    sessions.set(foreign.profileId, owned);
    assert.equal(value(await coordinator.stop({ browserId: foreign.id })).kind, 'stopped');
    reports.push({
      behavior: 'foreign-replacement-preserved-with-claim-reserved',
      result: 'passed',
    });

    const late = await browser('late-start');
    deferStart = late.profileId;
    value(await coordinator.start({ browserId: late.id }));
    await until(() => lateStarts.has(late.profileId), 'start request in flight');
    const lateStop = coordinator.stop({ browserId: late.id });
    assert(
      value(await data.request('tasks.list', undefined)).some((task) => task.browserId === late.id),
    );
    lateStarts.get(late.profileId)?.();
    deferStart = undefined;
    assert.equal(value(await lateStop).kind, 'stopped');
    assert(!sessions.has(late.profileId));
    reports.push({
      behavior: 'real-data-service-late-start-settles-before-release',
      result: 'passed',
    });

    const unknown = await browser('unknown-start');
    unknownStarts.add(unknown.profileId);
    value(await coordinator.start({ browserId: unknown.id }));
    await until(
      async () =>
        value(await data.request('tasks.list', undefined)).some(
          (task) => task.browserId === unknown.id && task.state === 'recovery_required',
        ),
      'uncertain start retained',
    );
    assert.equal(
      value(await coordinator.stop({ browserId: unknown.id })).kind,
      'recovery_required',
    );
    const unknownTask = value(await data.request('tasks.list', undefined)).find(
      (task) => task.browserId === unknown.id,
    );
    assert(unknownTask);
    const replacement = createTaskCoordinator(options);
    controls.push(replacement);
    await replacement.recover();
    assert(
      value(await data.request('tasks.list', undefined)).some(
        (task) => task.id === unknownTask.id && task.state === 'recovery_required',
      ),
    );
    assert.equal(launchCounts.get(unknown.id), 1);
    reports.push({ behavior: 'unknown-start-retained-without-replay', result: 'passed' });
    return reports;
  } finally {
    // The deliberately unresolved start has no live execution or browser and must retain its DB reservation.
    for (const control of controls) control.unavailable();
    await data.close();
  }
}

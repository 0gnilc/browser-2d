import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  failure,
  workTaskSchema,
  type Browser,
  type BrowserId,
  type Result,
  type StopView,
  type WorkTask,
} from '@browser-2d/contracts/public';
import {
  type BoundExecution,
  type CleanupProof,
  type PreparedTask,
  type RecoveryTask,
  type SessionFingerprint,
} from '@browser-2d/contracts/host';
import type { DataClient } from './data-service-client';
import {
  createExecutionOwnership,
  processAbsent,
  type ExecutionWitness,
} from './execution-ownership';
import { createAdsPowerClient, type BrowserPlatform } from './browser-platforms/adspower';
import { launchTask, type TaskOptions } from './task-supervisor';

type Execution = ReturnType<typeof launchTask>;
type LiveTask = {
  task: PreparedTask;
  execution: BoundExecution;
  control?: Execution;
  gate: 'open' | 'stopping' | 'recovery_required';
  outcome: CleanupProof['outcome'];
  platform?: BrowserPlatform;
  requestId?: string;
  closure?: CleanupProof['environment'];
};
function requireSuccess<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const recoveryMessage = 'Cleanup is not confirmed. The task remains reserved for recovery';
export function createTaskCoordinator(options: {
  data: DataClient;
  ownershipDirectory: string;
  connection: () => Promise<{ apiBaseUrl: string; apiKey: string }>;
  changed: () => void;
  platform?: (connection: { apiBaseUrl: string; apiKey: string }) => BrowserPlatform;
  spawn?: (task: TaskOptions) => Execution;
  checkpoint?: (point: string, task: PreparedTask) => void;
}) {
  const ownership = createExecutionOwnership(options.ownershipDirectory);
  const ownerNonce = randomUUID();
  const live = new Map<string, LiveTask>();
  let accepting = false;
  const stoppedBrowsers = new Set<BrowserId>();
  let connection: { apiBaseUrl: string; apiKey: string } | undefined;
  let platform: BrowserPlatform | undefined;
  async function platformForCurrentSettings() {
    const next = await options.connection();
    if (
      !platform ||
      !connection ||
      connection.apiBaseUrl !== next.apiBaseUrl ||
      connection.apiKey !== next.apiKey
    ) {
      connection = next;
      platform = (options.platform ?? createAdsPowerClient)(next);
    }
    return platform;
  }
  let pumping: Promise<void> | undefined;
  let pumpAgain = false;
  function bind(task: RecoveryTask): BoundExecution {
    if (!task.execution) throw new Error('Execution identity is missing');
    return { taskId: task.id, executionNonce: task.execution.nonce };
  }
  function project(task: RecoveryTask | WorkTask): WorkTask {
    const current = live.get(task.id);
    const state = current?.gate === 'open' || !current ? task.state : current.gate;
    return workTaskSchema.parse({
      id: task.id,
      browserId: task.browserId,
      state,
      stopRequestedAt:
        current && current.gate !== 'open'
          ? (task.stopRequestedAt ?? new Date().toISOString())
          : task.stopRequestedAt,
      createdAt: task.createdAt,
    });
  }
  function closeGate(current: LiveTask) {
    if (current.gate !== 'open') return;
    current.gate = 'stopping';
    options.changed();
  }
  async function closedEnvironment(current: LiveTask) {
    if (current.closure) return;
    const witness = ownership.read(current.execution);
    const state = witness.environment;
    if (state.kind === 'untouched') current.closure = { kind: 'never_started' };
    else if (state.kind === 'not_started')
      current.closure = { kind: 'settled_without_open', requestId: state.requestId };
    else if (state.kind === 'closed') current.closure = state.proof;
    else if (state.kind === 'owned') {
      const platform = current.platform ?? (await platformForCurrentSettings());
      const result = await platform.closeOwned({
        profileId: current.task.browser.profileId,
        session: state.session,
      });
      if (result.kind !== 'closed') throw new Error(recoveryMessage);
      current.closure = {
        kind: 'owned_session_closed',
        requestId: state.requestId,
        session: state.session,
        observedAt: new Date().toISOString(),
      };
    } else throw new Error('Environment start is unresolved');
    ownership.update(current.execution, {
      environment: { kind: 'closed', proof: current.closure },
    });
  }
  async function reconcileOwned(
    execution: BoundExecution,
    requestId: string,
    session: SessionFingerprint,
  ) {
    const tasks = requireSuccess(await options.data.request('tasks.list', undefined));
    const task = tasks.find((entry) => entry.id === execution.taskId);
    if (!task) return;
    if (task.execution?.nonce !== execution.executionNonce)
      throw new Error('Execution identity changed');
    const env = task.environment;
    if (
      env.kind === 'start_intent' ||
      (env.kind === 'recovery_required' && env.obligation.kind === 'start')
    ) {
      requireSuccess(await options.data.request('tasks.owned', { execution, requestId, session }));
      return;
    }
    const owed = env.kind === 'recovery_required' ? env.obligation : env;
    if (
      !('session' in owed) ||
      owed.requestId !== requestId ||
      owed.session.endpoint !== session.endpoint ||
      owed.session.browserTargetId !== session.browserTargetId
    )
      throw new Error('Environment ownership contradicts witness');
  }
  async function finish(current: LiveTask) {
    const witness = ownership.read(current.execution);
    if (!witness.pid || !witness.exitedAt || !current.closure) throw new Error(recoveryMessage);
    requireSuccess(
      await options.data.request('tasks.authorize', {
        execution: current.execution,
        pid: witness.pid,
      }),
    );
    if (current.closure.kind === 'owned_session_closed')
      await reconcileOwned(current.execution, current.closure.requestId, current.closure.session);
    requireSuccess(
      await options.data.request('tasks.finish', {
        execution: current.execution,
        exit: {
          kind: 'observed_exit',
          execution: current.execution,
          pid: witness.pid,
          observedAt: witness.exitedAt,
        },
        environment: current.closure,
        outcome: current.outcome,
      }),
    );
    options.checkpoint?.('post-release-pre-unlink', current.task);
    ownership.remove(current.execution);
    live.delete(current.task.id);
    stoppedBrowsers.delete(current.task.browserId);
    options.changed();
    void pump();
  }
  function spawn(task: PreparedTask) {
    const execution = bind(task);
    const current: LiveTask = {
      task,
      execution,
      gate: 'open',
      outcome: { kind: 'failed', message: 'Browser execution failed' },
    };
    live.set(task.id, current);
    ownership.prepare(task);
    options.checkpoint?.('pre-fork-intent', task);
    current.control = (options.spawn ?? launchTask)({
      taskId: task.id,
      executionNonce: execution.executionNonce,
      browser: task.browser,
      onSpawn(pid) {
        options.checkpoint?.('post-fork-pre-pid', task);
        ownership.update(execution, { pid });
        options.checkpoint?.('post-pid-pre-db-ack', task);
        return options.data.request('tasks.authorize', { execution, pid }).then((result) => {
          requireSuccess(result);
        });
      },
      onExit() {
        ownership.update(execution, { exitedAt: new Date().toISOString() });
      },
      stopped: () => closeGate(current),
      settled(state) {
        if (state.kind !== 'blocked') return;
        current.gate = 'recovery_required';
        void options.data
          .request('tasks.recovery', { execution, message: recoveryMessage })
          .catch(() => undefined);
        options.changed();
      },
      environment: {
        async open() {
          if (current.gate !== 'open' || !accepting)
            throw new Error('Execution stopped before start');
          const platform = await platformForCurrentSettings();
          current.platform = platform;
          const observation = await platform.inspect(task.browser.profileId);
          if (observation.kind !== 'inactive')
            throw new Error('The environment is already open; adoption was refused');
          if (current.gate !== 'open' || !accepting)
            throw new Error('Execution stopped before start');
          const requestId = randomUUID();
          current.requestId = requestId;
          requireSuccess(await options.data.request('tasks.startIntent', { execution, requestId }));
          // No HTTP start may cross a source gate closed while its DB acknowledgment was pending.
          if (current.gate !== 'open' || !accepting) {
            ownership.update(execution, { environment: { kind: 'not_started', requestId } });
            throw new Error('Execution stopped before start');
          }
          ownership.update(execution, { environment: { kind: 'start_intent', requestId } });
          options.checkpoint?.('post-start-intent-pre-response', task);
          const result = await platform.start(task.browser.profileId);
          if (result.kind === 'not_started') {
            ownership.update(execution, { environment: { kind: 'not_started', requestId } });
            throw new Error('Environment was not started');
          }
          if (result.kind !== 'opened') throw new Error('Environment start result is unknown');
          ownership.update(execution, {
            environment: { kind: 'owned', requestId, session: result.session },
          });
          options.checkpoint?.('post-success-sidecar-pre-db-ack', task);
          requireSuccess(
            await options.data.request('tasks.owned', {
              execution,
              requestId,
              session: result.session,
            }),
          );
          return {
            processor: 'baidu-check',
            endpoint: result.session.endpoint,
            url: 'https://www.baidu.com',
          };
        },
        close: () => closedEnvironment(current),
        closed: async () => current.closure !== undefined,
      },
      async running() {
        if (current.gate !== 'open') throw new Error('Execution gate closed');
        requireSuccess(await options.data.request('tasks.running', execution));
        if (current.gate !== 'open') throw new Error('Execution gate closed');
        options.changed();
      },
      async fence() {
        requireSuccess(await options.data.request('tasks.fence', { taskId: task.id, reason: '' }));
      },
      release: () => finish(current),
      request(request) {
        if (current.gate !== 'open' || !accepting)
          return Promise.reject(new Error('Execution gate closed'));
        return options.data.request('tasks.request', { execution, request });
      },
      observe(event) {
        if (event.kind === 'exhausted') current.outcome = { kind: 'exhausted' };
        if (event.kind === 'failed')
          current.outcome = { kind: 'failed', message: 'Browser automation failed' };
      },
    });
  }
  function pump(): Promise<void> {
    if (pumping) {
      pumpAgain = true;
      return pumping;
    }
    pumping = (async () => {
      do {
        pumpAgain = false;
        while (accepting && options.data.available) {
          const prepared = requireSuccess(
            await options.data.request('tasks.prepareNext', { ownerNonce }),
          );
          if (!prepared) break;
          if (!accepting || stoppedBrowsers.has(prepared.browserId)) {
            const execution = bind(prepared);
            requireSuccess(
              await options.data.request('tasks.fence', { taskId: prepared.id, reason: '' }),
            );
            requireSuccess(
              await options.data.request('tasks.finish', {
                execution,
                exit: { kind: 'never_forked', execution, ownerNonce },
                environment: { kind: 'never_started' },
                outcome: { kind: 'stopped' },
              }),
            );
            stoppedBrowsers.delete(prepared.browserId);
            continue;
          }
          try {
            spawn(prepared);
          } catch {
            const current = live.get(prepared.id);
            if (current) current.gate = 'recovery_required';
            await options.data
              .request('tasks.recovery', { execution: bind(prepared), message: recoveryMessage })
              .catch(() => undefined);
            options.changed();
          }
        }
      } while (pumpAgain && accepting);
    })()
      .catch(() => unavailable())
      .finally(() => {
        pumping = undefined;
      });
    return pumping;
  }
  function unavailable() {
    accepting = false;
    for (const current of live.values()) {
      closeGate(current);
      void current.control?.stop().then((state) => {
        if (state.kind !== 'exited') {
          current.gate = 'recovery_required';
          options.changed();
        }
      });
    }
    options.changed();
  }
  async function stopLive(current: LiveTask): Promise<Result<StopView>> {
    if (current.gate === 'open') current.outcome = { kind: 'stopped' };
    closeGate(current);
    if (!current.control) {
      current.gate = 'recovery_required';
      return {
        ok: true,
        value: { kind: 'recovery_required', task: project(current.task), message: recoveryMessage },
      };
    }
    const result = await current.control.stop();
    if (result.kind === 'exited')
      return { ok: true, value: { kind: 'stopped', browserId: current.task.browserId } };
    current.gate = 'recovery_required';
    await options.data
      .request('tasks.recovery', { execution: current.execution, message: recoveryMessage })
      .catch(() => undefined);
    options.changed();
    return {
      ok: true,
      value: { kind: 'recovery_required', task: project(current.task), message: recoveryMessage },
    };
  }
  async function recoverTask(task: RecoveryTask, witnesses: ExecutionWitness[]) {
    requireSuccess(await options.data.request('tasks.fence', { taskId: task.id, reason: '' }));
    if (!task.execution) {
      requireSuccess(await options.data.request('tasks.cancelQueued', { taskId: task.id }));
      return;
    }
    const execution = bind(task);
    try {
      const witness = witnesses.find(
        (entry) => entry.execution.executionNonce === execution.executionNonce,
      );
      if (!witness) {
        if (task.execution.kind !== 'prepared' || task.environment.kind !== 'untouched')
          throw new Error('Execution witness is missing');
        requireSuccess(
          await options.data.request('tasks.finish', {
            execution,
            exit: { kind: 'never_forked', execution, ownerNonce: task.execution.ownerNonce },
            environment: { kind: 'never_started' },
            outcome: { kind: 'stopped' },
          }),
        );
        return;
      }
      if (
        witness.execution.taskId !== task.id ||
        witness.ownerNonce !== task.execution.ownerNonce ||
        witness.generation !== task.execution.generation ||
        (witness.hostPid !== process.pid && !processAbsent(witness.hostPid))
      )
        throw new Error('Execution witness does not establish ownership');
      if (!witness.pid) throw new Error('Fork outcome is unknown');
      if (task.execution.kind !== 'prepared' && task.execution.pid !== witness.pid)
        throw new Error('Execution authorization contradicts witness');
      if (task.execution.kind === 'prepared')
        requireSuccess(
          await options.data.request('tasks.authorize', { execution, pid: witness.pid }),
        );
      const deadline = Date.now() + 15_000;
      while (!processAbsent(witness.pid)) {
        if (Date.now() >= deadline) throw new Error('Old execution exit is not confirmed');
        await delay(50);
      }
      const env = witness.environment;
      if (env.kind === 'owned') await reconcileOwned(execution, env.requestId, env.session);
      const current: LiveTask = {
        task: { ...task, execution: task.execution },
        execution,
        gate: 'stopping',
        outcome: { kind: 'stopped' },
      };
      live.set(task.id, current);
      await closedEnvironment(current);
      const closure = current.closure;
      if (closure?.kind === 'owned_session_closed')
        await reconcileOwned(execution, closure.requestId, closure.session);
      if (!closure) throw new Error(recoveryMessage);
      requireSuccess(
        await options.data.request('tasks.finish', {
          execution,
          exit: {
            kind: 'observed_absent',
            execution,
            pid: witness.pid,
            observedAt: new Date().toISOString(),
          },
          environment: closure,
          outcome: { kind: 'stopped' },
        }),
      );
      ownership.remove(execution);
      live.delete(task.id);
    } catch {
      const current = live.get(task.id);
      if (current) current.gate = 'recovery_required';
      requireSuccess(
        await options.data.request('tasks.recovery', { execution, message: recoveryMessage }),
      );
    }
  }
  return {
    async recover() {
      accepting = false;
      const tasks = requireSuccess(await options.data.request('tasks.list', undefined));
      // Fence every old execution before doing any potentially slow provider cleanup.
      for (const task of tasks)
        requireSuccess(await options.data.request('tasks.fence', { taskId: task.id, reason: '' }));
      const witnesses = ownership.list();
      for (const task of tasks) await recoverTask(task, witnesses);
      const active = new Set(
        tasks.flatMap((task) => (task.execution ? [task.execution.nonce] : [])),
      );
      for (const witness of witnesses)
        if (!active.has(witness.execution.executionNonce)) ownership.remove(witness.execution);
      accepting = true;
      options.changed();
    },
    async start(input: { browserId: BrowserId }): Promise<Result<WorkTask>> {
      if (!accepting || !options.data.available)
        return failure('UNAVAILABLE', 'Work is unavailable');
      stoppedBrowsers.delete(input.browserId);
      const accepted = await options.data.request('tasks.accept', input);
      if (accepted.ok) {
        options.changed();
        void pump();
      }
      return accepted;
    },
    stop(input: { browserId: BrowserId }): Promise<Result<StopView>> {
      stoppedBrowsers.add(input.browserId);
      const current = [...live.values()].find((entry) => entry.task.browserId === input.browserId);
      if (current) return stopLive(current);
      return (async () => {
        const tasks = await options.data.request('tasks.list', undefined);
        if (!tasks.ok) return tasks;
        const task = tasks.value.find((entry) => entry.browserId === input.browserId);
        if (!task) {
          stoppedBrowsers.delete(input.browserId);
          return { ok: true, value: { kind: 'stopped', browserId: input.browserId } };
        }
        // The scheduling pump may have promoted this row while the list reply was in flight.
        const promoted = live.get(task.id);
        if (promoted) return stopLive(promoted);
        if (task.execution)
          return {
            ok: true,
            value: { kind: 'recovery_required', task: project(task), message: recoveryMessage },
          };
        const result = await options.data.request('tasks.cancelQueued', { taskId: task.id });
        if (result.ok) stoppedBrowsers.delete(input.browserId);
        options.changed();
        return result.ok
          ? { ok: true, value: { kind: 'stopped', browserId: input.browserId } }
          : result;
      })();
    },
    async list(): Promise<Result<WorkTask[]>> {
      const result = await options.data.request('tasks.list', undefined);
      return result.ok ? { ok: true, value: result.value.map(project) } : result;
    },
    projectBrowsers(browsers: Browser[]) {
      return browsers.map((browser) => {
        const current = [...live.values()].find((entry) => entry.task.browserId === browser.id);
        return current && current.gate !== 'open' ? { ...browser, status: current.gate } : browser;
      });
    },
    unavailable,
    async shutdown() {
      accepting = false;
      for (const current of live.values()) closeGate(current);
      await pumping;
      const results = await Promise.all([...live.values()].map(stopLive));
      const tasks = requireSuccess(await options.data.request('tasks.list', undefined));
      for (const task of tasks)
        if (!task.execution)
          requireSuccess(await options.data.request('tasks.cancelQueued', { taskId: task.id }));
      if (
        results.some((result) => !result.ok || result.value.kind !== 'stopped') ||
        tasks.some((task) => task.execution)
      )
        throw new Error(recoveryMessage);
    },
    get live() {
      return [...live.values()].map((entry) => ({
        taskId: entry.task.id,
        gate: entry.gate,
        pid: entry.control?.pid,
        state: entry.control?.state,
        evidence: entry.control?.evidence,
      }));
    },
  };
}
export type TaskCoordinator = ReturnType<typeof createTaskCoordinator>;

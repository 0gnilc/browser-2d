import {
  failure,
  type CancelInput,
  type CancelResult,
  type Run,
  type StartInput,
  type StartResult,
  type WorkSnapshot,
} from '@browser-2d/contracts/public';
import type { Acquisition, Obligation, Reconciliation, WorkRepository } from './repository';

export interface ControlledDriver {
  acquire(intent: Obligation, signal: AbortSignal): Promise<Acquisition>;
  execute(resource: Acquisition, run: Run, signal: AbortSignal): Promise<void>;
  reconcile(intent: Obligation, signal: AbortSignal): Promise<Reconciliation>;
  release(resource: Acquisition, signal: AbortSignal): Promise<void>;
}
export function createWorkService({
  repository,
  driver,
  publish,
  policy = { executionTimeoutMs: 30_000, cleanupTimeoutMs: 1000, cleanupAttempts: 3 },
}: {
  repository: WorkRepository;
  driver: ControlledDriver;
  publish: (snapshot: WorkSnapshot) => void;
  policy?: { executionTimeoutMs: number; cleanupTimeoutMs: number; cleanupAttempts: number };
}) {
  const running = new Map<string, { abort: AbortController; promise: Promise<void> }>();
  const cleaning = new Map<string, Promise<void>>();
  const cleanupAttempts = new Map<string, number>();
  let accepting = true;
  let scheduled = false;
  let stopped = false;
  let stopping: Promise<void> | undefined;
  repository.recover();
  const changed = () => publish(repository.snapshot());
  async function clean(intent: Obligation) {
    const abort = new AbortController();
    const deadline = setTimeout(() => {
      repository.cleanupFailure(intent.operationId, 'CLEANUP_FAILED');
      changed();
      abort.abort();
    }, policy.cleanupTimeoutMs);
    try {
      const signal = abort.signal;
      const observed = await driver.reconcile(intent, signal);
      if (observed.kind === 'unknown') {
        repository.cleanupFailure(intent.operationId, 'OWNERSHIP_UNCERTAIN');
        return false;
      }
      if (observed.kind === 'present') await driver.release(observed.resource, signal);
      const after = await driver.reconcile(intent, signal);
      if (
        after.kind === 'absent-final' ||
        (after.kind === 'present' && after.resource.ownership === 'borrowed')
      )
        repository.resolved(intent.operationId);
      else repository.cleanupFailure(intent.operationId, 'CLEANUP_FAILED');
    } catch {
      repository.cleanupFailure(intent.operationId, 'CLEANUP_FAILED');
    } finally {
      clearTimeout(deadline);
      changed();
    }
    return !repository.obligations().some((item) => item.operationId === intent.operationId);
  }
  function cleanup() {
    for (const intent of repository.obligations()) {
      if (running.has(intent.runId) || cleaning.has(intent.operationId)) continue;
      const state = repository.run(intent.runId)?.state;
      if (state !== 'stopping' && state !== 'interrupted') continue;
      const attempts = cleanupAttempts.get(intent.operationId) ?? 0;
      if (attempts >= policy.cleanupAttempts) continue;
      cleanupAttempts.set(intent.operationId, attempts + 1);
      const promise = clean(intent).then((resolved) => {
        cleaning.delete(intent.operationId);
        if (resolved) wake();
      });
      cleaning.set(intent.operationId, promise);
    }
  }
  async function execute(run: Run, intent: Obligation, signal: AbortSignal) {
    try {
      const resource = await driver.acquire(intent, signal);
      const mayExecute = repository.acquired(intent, resource);
      changed();
      if (mayExecute) {
        await driver.execute(resource, run, signal);
        repository.finish(run.id, 'completed');
      }
    } catch {
      repository.finish(run.id, 'failed');
    } finally {
      changed();
    }
  }
  function pump() {
    scheduled = false;
    if (stopped) return;
    cleanup();
    if (!accepting) return;
    for (;;) {
      const admitted = repository.admit();
      if (!admitted) return;
      changed();
      const abort = new AbortController();
      const deadline = setTimeout(() => {
        repository.finish(admitted.run.id, 'failed');
        changed();
        abort.abort();
      }, policy.executionTimeoutMs);
      const promise = execute(admitted.run, admitted.intent, abort.signal).finally(() => {
        clearTimeout(deadline);
        running.delete(admitted.run.id);
        wake();
      });
      running.set(admitted.run.id, { abort, promise });
    }
  }
  function wake() {
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(pump);
  }
  // Failed reconciliation is retried at a bounded rate, never execution.
  const retry = setInterval(wake, 1000);
  wake();
  return {
    snapshot: repository.snapshot,
    getCommand: repository.getCommand,
    start(input: StartInput): StartResult {
      if (!accepting) return failure('UNAVAILABLE', 'Worker is shutting down');
      const result = repository.start(input);
      changed();
      wake();
      return result;
    },
    cancel(input: CancelInput): CancelResult {
      if (!accepting) return failure('UNAVAILABLE', 'Worker is shutting down');
      const result = repository.cancel(input);
      if (result.ok) running.get(input.runId)?.abort.abort();
      changed();
      wake();
      return result;
    },
    stop(): Promise<void> {
      stopping ??= (async () => {
        accepting = false;
        stopped = true;
        repository.stopAll();
        for (const task of running.values()) task.abort.abort();
        changed();
        clearInterval(retry);
        await Promise.all([...running.values()].map((task) => task.promise));
        cleanup();
        await Promise.all(cleaning.values());
        stopped = true;
        if (repository.obligations().length) throw new Error('Resource cleanup is incomplete');
      })();
      return stopping;
    },
  };
}

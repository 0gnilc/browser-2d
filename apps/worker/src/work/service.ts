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
}: {
  repository: WorkRepository;
  driver: ControlledDriver;
  publish: (snapshot: WorkSnapshot) => void;
}) {
  const running = new Map<string, { abort: AbortController; promise: Promise<void> }>();
  const cleaning = new Map<string, Promise<void>>();
  let accepting = true;
  let scheduled = false;
  let stopped = false;
  let stopping: Promise<void> | undefined;
  repository.recover();
  const changed = () => publish(repository.snapshot());
  async function clean(intent: Obligation) {
    try {
      const signal = new AbortController().signal;
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
      changed();
    }
    return !repository.obligations().some((item) => item.operationId === intent.operationId);
  }
  function cleanup() {
    for (const intent of repository.obligations()) {
      if (running.has(intent.runId) || cleaning.has(intent.operationId)) continue;
      const state = repository.run(intent.runId)?.state;
      if (state !== 'stopping' && state !== 'interrupted') continue;
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
      const promise = execute(admitted.run, admitted.intent, abort.signal).finally(() => {
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

import type { Browser2dApi, Run, Snapshot } from '@browser-2d/contracts/public';

export function createFixtureBridge(): Browser2dApi {
  const epoch = crypto.randomUUID();
  let revision = 0;
  const runs: Run[] = [];
  const listeners = new Set<(snapshot: Snapshot) => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const snapshot = (): Snapshot => ({
    epoch,
    revision,
    workerPid: 1,
    runs: runs.map((run) => ({ ...run })),
  });
  const publish = () => {
    revision++;
    listeners.forEach((listener) => listener(snapshot()));
  };
  const finish = (run: Run, state: 'completed' | 'cancelled') => {
    clearTimeout(timers.get(run.id));
    timers.delete(run.id);
    run.state = state;
    run.updatedAt = new Date().toISOString();
    publish();
  };
  return {
    async getSnapshot() {
      return { ok: true, value: snapshot() };
    },
    async start(input) {
      if (runs.some((run) => run.deviceId === input.deviceId && run.state === 'running')) {
        return {
          ok: false,
          error: { code: 'CONFLICT', message: '该设备已有运行中的任务。' },
        };
      }
      const now = new Date().toISOString();
      const run: Run = {
        ...input,
        id: crypto.randomUUID(),
        state: 'running',
        createdAt: now,
        updatedAt: now,
      };
      runs.unshift(run);
      timers.set(
        run.id,
        setTimeout(() => finish(run, 'completed'), run.durationMs),
      );
      publish();
      return { ok: true, value: { ...run } };
    },
    async cancel({ runId }) {
      const run = runs.find((candidate) => candidate.id === runId);
      if (!run)
        return {
          ok: false,
          error: { code: 'NOT_FOUND', message: '找不到该任务。' },
        };
      if (run.state === 'running') finish(run, 'cancelled');
      return { ok: true, value: { ...run } };
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

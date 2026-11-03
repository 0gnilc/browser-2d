import type { WorkSnapshot, WorkState } from '@browser-2d/contracts/public';
import { createPinia, disposePinia } from 'pinia';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createFixtureBridge } from '../src/fixture';
import { useRunsStore } from '../src/runs';

const snapshot: WorkSnapshot = {
  epoch: '33333333-3333-4333-8333-333333333333',
  revision: 0,
  workerPid: 1234,
  execution: 'controlled',
  policy: { devices: 2, pages: 4 },
  runs: [],
  resources: [],
};

function fixture(initial: WorkState = { status: 'ready', generation: 0, snapshot }) {
  const api = createFixtureBridge();
  let emit: (state: WorkState) => void = () => {};
  api.work.subscribe = (listener) => {
    emit = listener;
    listener(initial);
    return () => {};
  };
  api.work.getSnapshot = async () => ({ ok: true, value: snapshot });
  const pinia = createPinia();
  const store = useRunsStore(pinia);
  const disconnect = store.connect(api);
  onTestFinished(() => {
    disconnect();
    disposePinia(pinia);
  });
  return { api, store, emit };
}

describe('work connection errors', () => {
  it('clears a startup failure when a newer worker generation becomes ready', async () => {
    const { store, emit } = fixture({
      status: 'unavailable',
      generation: 0,
      reason: 'Worker is starting',
    });
    expect(store.error).toBe('Worker is starting');
    await store.refresh();
    expect(store.connection).toBe('unavailable');
    emit({ status: 'ready', generation: 1, snapshot });
    expect(store.connection).toBe('connected');
    expect(store.error).toBe('');
  });

  it('keeps the failure for stale or same-generation ready events', () => {
    const { store, emit } = fixture({
      status: 'unavailable',
      generation: 1,
      reason: 'Worker exited',
    });
    for (const generation of [0, 1]) {
      emit({ status: 'ready', generation, snapshot });
      expect(store.connection).toBe('unavailable');
      expect(store.error).toBe('Worker exited');
      expect(store.snapshot).toBeUndefined();
    }
  });

  it('clears a snapshot request failure after a newer generation becomes ready', async () => {
    const { api, store, emit } = fixture();
    await store.refresh();
    api.work.getSnapshot = async () => ({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'Worker is starting' },
    });
    await store.refresh();
    expect(store.connection).toBe('unavailable');
    expect(store.error).toBe('Worker is starting');
    emit({ status: 'ready', generation: 1, snapshot });
    expect(store.connection).toBe('connected');
    expect(store.error).toBe('');
  });

  it('preserves a definite command failure through snapshots and transport recovery', async () => {
    const { api, store, emit } = fixture();
    api.work.start = async () => ({
      ok: false,
      error: { code: 'CONFLICT', message: 'Device is busy' },
    });
    await store.start(7);
    expect(store.error).toBe('Device is busy');
    expect(store.pending).toBeUndefined();
    emit({ status: 'ready', generation: 0, snapshot: { ...snapshot, revision: 1 } });
    expect(store.error).toBe('Device is busy');
    emit({ status: 'unavailable', generation: 1, reason: 'Worker exited' });
    emit({ status: 'ready', generation: 2, snapshot: { ...snapshot, revision: 2 } });
    expect(store.connection).toBe('connected');
    expect(store.error).toBe('Device is busy');
  });

  it.each(['INTERNAL', 'UNAVAILABLE'] satisfies Array<'INTERNAL' | 'UNAVAILABLE'>)(
    'preserves an unresolved %s command and its error after connection recovery',
    async (code) => {
      const { api, store, emit } = fixture();
      api.work.start = async () => ({
        ok: false,
        error: { code, message: 'Command outcome is unknown' },
      });
      await store.start(7);
      const pending = store.pending;
      expect(pending).toBeDefined();
      emit({ status: 'unavailable', generation: 1, reason: 'Worker exited' });
      emit({ status: 'ready', generation: 2, snapshot });
      expect(store.connection).toBe('connected');
      expect(store.pending).toEqual(pending);
      expect(store.error).toBe('Command outcome is unknown');
    },
  );
});

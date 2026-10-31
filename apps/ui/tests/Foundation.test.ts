import type {
  Browser2dApi,
  Run,
  RunResult,
  Snapshot,
  SnapshotResult,
} from '@browser-2d/contracts/public';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import Foundation from '../src/Foundation.vue';
import { bridgeKey } from '../src/bridge';
import { createFixtureBridge } from '../src/fixture';

const run: Run = {
  id: '11111111-1111-4111-8111-111111111111',
  commandId: '22222222-2222-4222-8222-222222222222',
  deviceId: 'fixture-device',
  durationMs: 3000,
  state: 'running',
  createdAt: '2026-10-30T12:00:00.000Z',
  updatedAt: '2026-10-30T12:00:00.000Z',
};
const initial: Snapshot = {
  epoch: '33333333-3333-4333-8333-333333333333',
  revision: 0,
  workerPid: 1234,
  runs: [],
};

function fixture() {
  let value = initial;
  let listener: (snapshot: Snapshot) => void = () => {};
  const dispose = vi.fn();
  const api: Browser2dApi = {
    ...createFixtureBridge(),
    getSnapshot: vi.fn(async (): Promise<SnapshotResult> => ({ ok: true, value })),
    start: vi.fn(async (input): Promise<RunResult> => {
      value = {
        ...value,
        revision: value.revision + 1,
        runs: [{ ...run, ...input }],
      };
      listener(value);
      return { ok: true, value: value.runs[0] ?? run };
    }),
    cancel: vi.fn(async (): Promise<RunResult> => ({
      ok: true,
      value: { ...run, state: 'cancelled' },
    })),
    subscribe(callback) {
      listener = callback;
      callback(value);
      return dispose;
    },
  };
  const emit = (snapshot: Snapshot) => {
    value = snapshot;
    listener(snapshot);
  };
  const wrapper = mount(Foundation, {
    global: { plugins: [createPinia()], provide: { [bridgeKey]: api } },
  });
  return { api, dispose, emit, wrapper };
}

describe('foundation screen', () => {
  it('starts a task through the public bridge and disposes its subscription', async () => {
    const { wrapper, api, dispose } = fixture();
    await flushPromises();
    await wrapper.get('[data-testid="device-id"]').setValue('test-device');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.start).toHaveBeenCalledOnce();
    expect(api.start).toHaveBeenCalledWith({
      commandId: expect.any(String),
      deviceId: 'test-device',
      durationMs: 3000,
    });
    expect(wrapper.get('[data-testid="run-table"]').text()).toContain('test-device');
    expect(wrapper.get(`[data-testid="cancel-${run.id}"]`).text()).toBe('取消');
    wrapper.unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('keeps the latest epoch and revision when an older refresh completes', async () => {
    const { api, emit, wrapper } = fixture();
    await flushPromises();
    let resolve: (result: SnapshotResult) => void = () => {};
    api.getSnapshot = () =>
      new Promise((done) => {
        resolve = done;
      });
    await wrapper.get('[data-testid="refresh"]').trigger('click');
    const next = {
      ...initial,
      epoch: '44444444-4444-4444-8444-444444444444',
      revision: 2,
      workerPid: 5678,
      runs: [run],
    };
    emit(next);
    resolve({ ok: true, value: initial });
    await flushPromises();
    emit({ ...next, revision: 1, runs: [] });
    emit({ ...initial, revision: 99 });
    await flushPromises();
    expect(wrapper.get('[data-testid="worker-pid"]').text()).toBe('5678');
    expect(wrapper.get('[data-testid="run-table"]').text()).toContain('fixture-device');
    wrapper.unmount();
  });

  it('shows a rejected bridge error without inventing a task', async () => {
    const { wrapper, api } = fixture();
    api.start = async () => {
      throw new Error('工作进程已退出');
    };
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('工作进程已退出');
    expect(wrapper.get('[data-testid="run-table"]').text()).toContain('尚无运行记录');
    wrapper.unmount();
  });
});

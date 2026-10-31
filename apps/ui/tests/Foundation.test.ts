import type {
  Browser2dApi,
  Device,
  Run,
  WorkSnapshot,
  WorkSnapshotResult,
  WorkState,
} from '@browser-2d/contracts/public';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import Foundation from '../src/Foundation.vue';
import { bridgeKey } from '../src/bridge';
import { createFixtureBridge } from '../src/fixture';

const run: Run = {
  id: '11111111-1111-4111-8111-111111111111',
  deviceId: 7,
  config: { revision: 4, pageCount: 2, viewportWidth: 1280, viewportHeight: 720 },
  outcome: null,
  state: 'running',
  createdAt: '2026-10-30T12:00:00.000Z',
  updatedAt: '2026-10-30T12:00:00.000Z',
};
const initial: WorkSnapshot = {
  epoch: '33333333-3333-4333-8333-333333333333',
  revision: 0,
  workerPid: 1234,
  execution: 'controlled',
  policy: { devices: 2, pages: 4 },
  runs: [],
  resources: [],
};
const device: Device = {
  id: 7,
  createTime: '2026-10-30 12:00:00',
  symbol: '验收设备',
  account: null,
  amount: null,
  count: 0,
  status: 2,
  note: null,
};
function fixture() {
  let value = initial;
  let listener: (state: WorkState) => void = () => {};
  const dispose = vi.fn();
  const api: Browser2dApi = {
    ...createFixtureBridge(),
    devices: {
      ...createFixtureBridge().devices,
      list: vi.fn<Browser2dApi['devices']['list']>(async () => ({ ok: true, value: [device] })),
      create: vi.fn<Browser2dApi['devices']['create']>(async () => ({
        ok: true,
        value: { ...device, id: 8, symbol: '新验收设备' },
      })),
    },
    work: {
      getSnapshot: vi.fn<Browser2dApi['work']['getSnapshot']>(async () => ({ ok: true, value })),
      start: vi.fn<Browser2dApi['work']['start']>(async (input) => {
        value = {
          ...value,
          revision: value.revision + 1,
          runs: [{ ...run, deviceId: input.deviceId, state: 'queued' }],
        };
        listener({ status: 'ready', generation: 0, snapshot: value });
        return {
          ok: true,
          value: {
            kind: 'start',
            commandId: input.commandId,
            runId: run.id,
            acceptedAt: run.createdAt,
          },
        };
      }),
      cancel: vi.fn<Browser2dApi['work']['cancel']>(async (input) => ({
        ok: true,
        value: {
          kind: 'cancel',
          commandId: input.commandId,
          runId: input.runId,
          acceptedAt: run.createdAt,
          disposition: 'stop-requested',
        },
      })),
      getCommand: vi.fn<Browser2dApi['work']['getCommand']>(async () => ({
        ok: true,
        value: { status: 'unknown' },
      })),
      subscribe(callback) {
        listener = callback;
        callback({ status: 'ready', generation: 0, snapshot: value });
        return dispose;
      },
    },
  };
  const emitState = (state: WorkState) => listener(state);
  const emit = (snapshot: WorkSnapshot, generation = 0) => {
    value = snapshot;
    emitState({ status: 'ready', generation, snapshot });
  };
  const wrapper = mount(Foundation, {
    global: { plugins: [createPinia()], provide: { [bridgeKey]: api } },
  });
  return { api, dispose, emit, emitState, wrapper };
}

describe('scheduling screen', () => {
  it('starts with a numeric business device and treats the receipt as acceptance', async () => {
    const { wrapper, api, dispose } = fixture();
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.work.start).toHaveBeenCalledWith({ commandId: expect.any(String), deviceId: 7 });
    expect(wrapper.find('[data-testid="duration-ms"]').exists()).toBe(false);
    expect(wrapper.get(`[data-testid="run-${run.id}"]`).attributes('data-state')).toBe('queued');
    expect(wrapper.get('[data-testid="command-receipt"]').text()).toContain('受理不代表执行完成');
    expect(wrapper.get('[data-testid="capacity-limits"]').text()).toContain('2 台设备 / 4 页');
    expect(wrapper.get('[data-testid="controlled-mode"]').text()).toContain('不消耗业务材料');
    wrapper.unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('creates an account-free fixture through the business API and selects its real ID', async () => {
    const { wrapper, api } = fixture();
    await flushPromises();
    await wrapper.get('[data-testid="create-fixture-device"]').trigger('click');
    await flushPromises();
    expect(api.devices.create).toHaveBeenCalledWith({
      symbol: expect.stringMatching(/^local-test-/),
      note: '本地受控验收设备，无真实账户。',
    });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.work.start).toHaveBeenCalledWith({ commandId: expect.any(String), deviceId: 8 });
    await wrapper.get('[data-testid="devices-refresh"]').trigger('click');
    await flushPromises();
    expect(api.devices.list).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('keeps the latest epoch and revision when an older refresh completes', async () => {
    const { api, emit, wrapper } = fixture();
    await flushPromises();
    let resolve: (result: WorkSnapshotResult) => void = () => {};
    api.work.getSnapshot = () =>
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
    expect(wrapper.get('[data-testid="run-table"]').text()).toContain(run.id);
    wrapper.unmount();
  });

  it('immediately disables work after unavailable and fences late events and refreshes', async () => {
    const { wrapper, api, emit, emitState } = fixture();
    await flushPromises();
    let resolve: (result: WorkSnapshotResult) => void = () => {};
    api.work.getSnapshot = () =>
      new Promise((done) => {
        resolve = done;
      });
    await wrapper.get('[data-testid="refresh"]').trigger('click');
    emitState({ status: 'unavailable', generation: 1, reason: '工作进程已退出' });
    resolve({ ok: true, value: initial });
    emit({ ...initial, revision: 99 }, 0);
    emit({ ...initial, revision: 100 }, 1);
    await flushPromises();
    expect(wrapper.get('[data-testid="connection-status"]').attributes('data-state')).toBe(
      'unavailable',
    );
    expect(wrapper.get('[data-testid="start-run"]').attributes('disabled')).toBeDefined();
    api.work.getSnapshot = async () => ({ ok: true, value: initial });
    await wrapper.get('[data-testid="refresh"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="connection-status"]').attributes('data-state')).toBe(
      'unavailable',
    );
    emit({ ...initial, epoch: '44444444-4444-4444-8444-444444444444' }, 2);
    await flushPromises();
    expect(wrapper.get('[data-testid="connection-status"]').attributes('data-state')).toBe(
      'connected',
    );
    wrapper.unmount();
  });

  it.each(['queued', 'starting', 'running', 'stopping'] satisfies Run['state'][])(
    'allows cancelling %s and waits for cleanup rather than inventing a terminal state',
    async (state) => {
      const { api, emit, wrapper } = fixture();
      await flushPromises();
      emit({ ...initial, runs: [{ ...run, state }] });
      await flushPromises();
      await wrapper.get(`[data-testid="cancel-${run.id}"]`).trigger('click');
      await flushPromises();
      expect(api.work.cancel).toHaveBeenCalledWith({
        commandId: expect.any(String),
        runId: run.id,
      });
      expect(wrapper.get(`[data-testid="run-${run.id}"]`).attributes('data-state')).toBe(state);
      expect(wrapper.get('[data-testid="command-receipt"]').text()).toContain('请等待资源清理');
      wrapper.unmount();
    },
  );

  it('renders all eight states, frozen config, and unresolved cleanup failures', async () => {
    const { emit, wrapper } = fixture();
    await flushPromises();
    const states: Run['state'][] = [
      'queued',
      'starting',
      'running',
      'stopping',
      'completed',
      'cancelled',
      'failed',
      'interrupted',
    ];
    const runs = states.map((state) => ({ ...run, id: crypto.randomUUID(), state }));
    const operationId = crypto.randomUUID();
    emit({
      ...initial,
      runs,
      resources: [
        {
          operationId,
          runId: run.id,
          deviceId: 7,
          pages: 2,
          state: 'release-pending',
          ownership: 'owned',
          failure: 'CLEANUP_FAILED',
        },
      ],
    });
    await flushPromises();
    for (const row of runs) {
      expect(wrapper.get(`[data-testid="run-${row.id}"]`).text()).toContain('版本 4 · 2 页');
      expect(wrapper.find(`[data-testid="cancel-${row.id}"]`).exists()).toBe(
        ['queued', 'starting', 'running', 'stopping'].includes(row.state),
      );
    }
    expect(wrapper.get(`[data-testid="resource-${operationId}"]`).text()).toContain(
      'CLEANUP_FAILED',
    );
    wrapper.unmount();
  });

  it('retains an uncertain start command and queries and retries the same identity', async () => {
    const { wrapper, api } = fixture();
    const start = vi.fn<Browser2dApi['work']['start']>(async () => {
      throw new Error('响应超时');
    });
    api.work.start = start;
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('响应超时');
    const commandId = wrapper.get('[data-testid="command-id"]').text();
    expect(wrapper.get('[data-testid="start-run"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="query-command"]').trigger('click');
    await flushPromises();
    expect(api.work.getCommand).toHaveBeenCalledWith({ commandId });
    expect(wrapper.get('[data-testid="command-receipt"]').text()).toContain('尚未查到');
    await wrapper.get('[data-testid="retry-command"]').trigger('click');
    await flushPromises();
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[0]).toEqual(start.mock.calls[1]);
    expect(wrapper.get('[data-testid="run-table"]').text()).toContain('尚无运行记录');
    wrapper.unmount();
  });

  it('shows lookup failure and resolves a recorded receipt without creating another run', async () => {
    const { wrapper, api } = fixture();
    api.work.start = vi.fn(async () => {
      throw new Error('响应丢失');
    });
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const commandId = wrapper.get('[data-testid="command-id"]').text();
    api.work.getCommand = async () => ({
      ok: false,
      error: { code: 'INTERNAL', message: '查询失败' },
    });
    await wrapper.get('[data-testid="query-command"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('查询失败');
    expect(wrapper.get('[data-testid="command-id"]').text()).toBe(commandId);
    api.work.getCommand = async () => ({
      ok: true,
      value: {
        status: 'recorded',
        receipt: {
          ok: true,
          value: { kind: 'start', commandId, runId: run.id, acceptedAt: run.createdAt },
        },
      },
    });
    await wrapper.get('[data-testid="query-command"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="pending-command"]').exists()).toBe(false);
    expect(api.work.start).toHaveBeenCalledOnce();
    expect(wrapper.get('[data-testid="command-receipt"]').text()).toContain('启动指令已受理');
    wrapper.unmount();
  });

  it('keeps the original command when a receipt identifies another command', async () => {
    const { wrapper, api } = fixture();
    api.work.start = async () => ({
      ok: true,
      value: {
        kind: 'start',
        commandId: '22222222-2222-4222-8222-222222222222',
        runId: run.id,
        acceptedAt: run.createdAt,
      },
    });
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('指令回执与原指令不匹配');
    expect(wrapper.get('[data-testid="command-id"]').text()).not.toBe(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(wrapper.get('[data-testid="start-run"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('retains an uncertain cancellation with the same run ID and command ID', async () => {
    const { wrapper, api, emit } = fixture();
    api.work.cancel = vi.fn(async () => {
      throw new Error('取消响应超时');
    });
    await flushPromises();
    emit({ ...initial, runs: [run] });
    await flushPromises();
    await wrapper.get(`[data-testid="cancel-${run.id}"]`).trigger('click');
    await flushPromises();
    const commandId = wrapper.get('[data-testid="command-id"]').text();
    await wrapper.get('[data-testid="retry-command"]').trigger('click');
    await flushPromises();
    expect(api.work.cancel).toHaveBeenNthCalledWith(1, { commandId, runId: run.id });
    expect(api.work.cancel).toHaveBeenNthCalledWith(2, { commandId, runId: run.id });
    wrapper.unmount();
  });

  it('keeps the development fixture explicitly unavailable', async () => {
    const wrapper = mount(Foundation, {
      global: { plugins: [createPinia()], provide: { [bridgeKey]: createFixtureBridge() } },
    });
    await flushPromises();
    expect(wrapper.get('[data-testid="connection-status"]').attributes('data-state')).toBe(
      'unavailable',
    );
    expect(wrapper.get('[data-testid="devices-error"]').text()).toContain(
      '界面预览不连接业务数据库',
    );
    expect(wrapper.get('[data-testid="start-run"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
});

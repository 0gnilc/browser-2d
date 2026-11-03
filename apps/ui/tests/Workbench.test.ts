import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserSchema,
  failure,
  workTaskSchema,
  type Browser2dApi,
  type Browser,
  type Result,
  type WorkTask,
} from '@browser-2d/contracts/public';
import App from '../src/App.vue';
import BrowsersPage from '../src/views/browsers/BrowsersPage.vue';
import BrowserEditor from '../src/views/browsers/BrowserEditor.vue';
import { desktopApiKey } from '../src/platform/desktop-api';
import { useWorkTasksStore } from '../src/stores/work-tasks';
import { unavailableApi } from '../src/platform/unavailable-api';
import { useLatestRefresh } from '../src/composables/useDesktopRequest';
import { browser, createTestApi } from './helpers';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
const task = workTaskSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  browserId: browser.id,
  state: 'running',
  stopRequestedAt: null,
  createdAt: browser.createdAt,
});
beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('truthful work state', () => {
  it('subscribes before loading and coalesces invalidations without applying the old response', async () => {
    const test = createTestApi();
    const old = deferred<Result<Browser[]>>();
    const list = vi
      .fn<Browser2dApi['browsers']['list']>()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ ok: true, value: [{ ...browser, name: '最新名称' }] });
    test.api.browsers.list = list;
    const work = useWorkTasksStore();
    const stop = work.connect(test.api);
    expect(test.api.workTasks.subscribe).toHaveBeenCalledBefore(list);
    test.emit();
    test.emit();
    test.emit();
    expect(list).toHaveBeenCalledOnce();
    old.resolve({ ok: true, value: [browser] });
    await flushPromises();
    expect(work.browsers[0]?.name).toBe('最新名称');
    expect(list).toHaveBeenCalledTimes(2);
    stop();
  });

  it('fences a disconnected source response after reconnecting to a new desktop source', async () => {
    const old = createTestApi();
    const next = createTestApi();
    const reply = deferred<Result<Browser[]>>();
    old.api.browsers.list = () => reply.promise;
    next.api.browsers.list = async () => ({ ok: true, value: [{ ...browser, name: '新连接' }] });
    const work = useWorkTasksStore();
    const oldStop = work.connect(old.api);
    const stop = work.connect(next.api);
    await flushPromises();
    oldStop();
    reply.resolve({ ok: true, value: [{ ...browser, name: '旧连接' }] });
    await flushPromises();
    expect(work.browsers[0]?.name).toBe('新连接');
    expect(work.connection).toBe('connected');
    stop();
  });

  it('shows stopping immediately and keeps backend recovery busy until a later real idle projection', async () => {
    const test = createTestApi();
    test.api.browsers.list = async () => ({ ok: true, value: [{ ...browser, status: 'working' }] });
    test.api.workTasks.list = async () => ({ ok: true, value: [task] });
    const reply = deferred<Awaited<ReturnType<Browser2dApi['workTasks']['stop']>>>();
    test.api.workTasks.stop = vi.fn(() => reply.promise);
    const work = useWorkTasksStore();
    const stop = work.connect(test.api);
    await flushPromises();
    const request = work.control(browser.id, 'stop');
    expect(work.label(browser)).toBe('停止中');
    await work.control(browser.id, 'stop');
    expect(test.api.workTasks.stop).toHaveBeenCalledOnce();
    const recovery = { ...task, state: 'recovery_required' } satisfies WorkTask;
    test.api.browsers.list = async () => ({
      ok: true,
      value: [{ ...browser, status: 'recovery_required' }],
    });
    test.api.workTasks.list = async () => ({ ok: true, value: [recovery] });
    reply.resolve({
      ok: true,
      value: { kind: 'recovery_required', task: recovery, message: '关闭尚未确认' },
    });
    await request;
    const row = work.browsers[0];
    expect(row && work.label(row)).toBe('待恢复');
    expect(row && work.busy(row)).toBe(true);
    test.api.browsers.list = async () => ({ ok: true, value: [browser] });
    test.api.workTasks.list = async () => ({ ok: true, value: [] });
    await work.refresh();
    expect(work.busy(browser)).toBe(false);
    stop();
  });

  it('retains a rejected start error after a successful refresh', async () => {
    const test = createTestApi();
    test.api.workTasks.start = async () => failure('CONFLICT', '环境已经被占用', 'ACTIVE_TASK');
    const work = useWorkTasksStore();
    const stop = work.connect(test.api);
    await flushPromises();
    await work.control(browser.id, 'start');
    expect(work.controlError).toBe('环境已经被占用');
    expect(work.connection).toBe('connected');
    stop();
  });

  it.each(['accepted', 'transport lost', 'unavailable response'])(
    'keeps %s starts occupied after a failed projection and permits Stop through the live bridge',
    async (outcome) => {
      const test = createTestApi();
      test.api.workTasks.start = vi.fn<Browser2dApi['workTasks']['start']>(async () => {
        if (outcome === 'transport lost') throw new Error('lost after commit');
        if (outcome === 'unavailable response') return failure('UNAVAILABLE', '连接中断');
        return { ok: true, value: { ...task, state: 'queued' } };
      });
      test.api.workTasks.stop = vi.fn<Browser2dApi['workTasks']['stop']>(async () => ({
        ok: true,
        value: { kind: 'stopped', browserId: browser.id },
      }));
      const work = useWorkTasksStore();
      const stop = work.connect(test.api);
      await flushPromises();
      const wrapper = mount(BrowsersPage, { global: { provide: { [desktopApiKey]: test.api } } });
      test.api.browsers.list = async () => failure('UNAVAILABLE', '数据服务不可用');
      test.api.workTasks.list = async () => failure('UNAVAILABLE', '数据服务不可用');
      await work.control(browser.id, 'start');
      await flushPromises();
      expect(work.label(browser)).toBe('工作状态待确认');
      expect(work.busy(browser)).toBe(true);
      expect(work.browsers[0]?.status).toBe('idle');
      const button = (text: string) =>
        wrapper.findAll('button').find((item) => item.text() === text);
      expect(button('开始工作')).toBeUndefined();
      expect(button('编辑')?.attributes('disabled')).toBeDefined();
      expect(button('移除')?.attributes('disabled')).toBeDefined();
      expect(button('停止工作')?.attributes('disabled')).toBeUndefined();
      await work.control(browser.id, 'start');
      expect(test.api.workTasks.start).toHaveBeenCalledOnce();
      await button('停止工作')?.trigger('click');
      await flushPromises();
      expect(test.api.workTasks.stop).toHaveBeenCalledOnce();
      expect(work.label(browser)).toBe('工作状态待确认');
      test.api.browsers.list = async () => ({ ok: true, value: [browser] });
      test.api.workTasks.list = async () => ({ ok: true, value: [] });
      await work.refresh();
      await flushPromises();
      expect(work.label(browser)).toBe('空闲');
      expect(work.busy(browser)).toBe(false);
      expect(button('编辑')?.attributes('disabled')).toBeUndefined();
      expect(button('开始工作')?.attributes('disabled')).toBeUndefined();
      wrapper.unmount();
      stop();
    },
  );

  it('retains uncertain work after a definitive Stop refusal until both projections succeed', async () => {
    const test = createTestApi();
    const work = useWorkTasksStore();
    const stop = work.connect(test.api);
    await flushPromises();
    test.api.workTasks.start = async () => ({ ok: true, value: task });
    test.api.browsers.list = async () => failure('UNAVAILABLE', '数据服务不可用');
    await work.control(browser.id, 'start');
    test.api.workTasks.stop = async () => failure('CONFLICT', '暂时无法停止');
    await work.control(browser.id, 'stop');
    expect(work.controlError).toBe('暂时无法停止');
    expect(work.busy(browser)).toBe(true);
    expect(work.label(browser)).toBe('工作状态待确认');
    test.api.browsers.list = async () => ({ ok: true, value: [browser] });
    test.api.workTasks.list = async () => failure('UNAVAILABLE', '任务读取失败');
    await work.refresh();
    expect(work.busy(browser)).toBe(true);
    expect(work.label(browser)).toBe('工作状态待确认');
    test.api.workTasks.list = async () => ({ ok: true, value: [] });
    await work.refresh();
    expect(work.busy(browser)).toBe(false);
    expect(work.label(browser)).toBe('空闲');
    stop();
  });

  it('fences an old control reply after disconnect and a fresh action', async () => {
    const old = createTestApi();
    const next = createTestApi();
    const oldReply = deferred<Awaited<ReturnType<Browser2dApi['workTasks']['start']>>>();
    const nextReply = deferred<Awaited<ReturnType<Browser2dApi['workTasks']['start']>>>();
    old.api.workTasks.start = () => oldReply.promise;
    next.api.workTasks.start = () => nextReply.promise;
    const work = useWorkTasksStore();
    const disconnect = work.connect(old.api);
    await flushPromises();
    const oldRequest = work.control(browser.id, 'start');
    disconnect();
    const stop = work.connect(next.api);
    await flushPromises();
    const nextRequest = work.control(browser.id, 'start');
    oldReply.resolve(failure('CONFLICT', '旧请求错误'));
    await oldRequest;
    expect(work.label(browser)).toBe('正在请求启动');
    expect(work.busy(browser)).toBe(true);
    expect(work.controlError).toBe('');
    next.api.browsers.list = async () => ({ ok: true, value: [{ ...browser, status: 'working' }] });
    next.api.workTasks.list = async () => ({ ok: true, value: [task] });
    nextReply.resolve({ ok: true, value: task });
    await nextRequest;
    const row = work.browsers[0];
    expect(row && work.label(row)).toBe('工作中');
    expect(row && work.busy(row)).toBe(true);
    stop();
  });

  it('does not let a pre-action projection clear an uncertain start', async () => {
    const test = createTestApi();
    const work = useWorkTasksStore();
    const stop = work.connect(test.api);
    await flushPromises();
    const stale = deferred<Result<Browser[]>>();
    test.api.browsers.list = vi
      .fn<Browser2dApi['browsers']['list']>()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValue(failure('UNAVAILABLE', '数据服务不可用'));
    const refresh = work.refresh();
    test.api.workTasks.start = async () => ({ ok: true, value: task });
    const request = work.control(browser.id, 'start');
    await flushPromises();
    stale.resolve({ ok: true, value: [browser] });
    await Promise.all([refresh, request]);
    expect(work.label(browser)).toBe('工作状态待确认');
    expect(work.busy(browser)).toBe(true);
    stop();
  });

  it('treats queued and recovery browsers as occupied in the actual row actions', async () => {
    const test = createTestApi();
    test.api.browsers.list = async () => ({
      ok: true,
      value: [browserSchema.parse({ ...browser, status: 'queued' })],
    });
    const work = useWorkTasksStore();
    const stop = work.connect(test.api);
    await flushPromises();
    const wrapper = mount(BrowsersPage, { global: { provide: { [desktopApiKey]: test.api } } });
    await flushPromises();
    const buttons = wrapper.findAll('button');
    expect(buttons.some((button) => button.text() === '开始工作')).toBe(false);
    expect(
      buttons.find((button) => button.text() === '停止工作')?.attributes('disabled'),
    ).toBeUndefined();
    expect(
      buttons.find((button) => button.text() === '编辑')?.attributes('disabled'),
    ).toBeDefined();
    wrapper.unmount();
    stop();
  });
});

it('saves the complete Browser input and keeps a failed edit draft visible', async () => {
  const test = createTestApi();
  test.api.browsers.update = vi.fn(async () =>
    failure('CONFLICT', '浏览器正在工作', 'ACTIVE_TASK'),
  );
  const wrapper = mount(BrowserEditor, {
    attachTo: document.body,
    global: { provide: { [desktopApiKey]: test.api } },
  });
  await wrapper.vm.open(browser);
  await flushPromises();
  const account = document.querySelector<HTMLInputElement>('#browser-account');
  if (!account) throw new Error('Account input missing');
  account.value = 'raw  account';
  account.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector<HTMLButtonElement>('[data-testid="browser-save"]')?.click();
  await flushPromises();
  expect(test.api.browsers.update).toHaveBeenCalledWith({
    id: browser.id,
    provider: 'adspower',
    profileId: browser.profileId,
    name: browser.name,
    account: 'raw  account',
    amount: '12.34',
    notes: browser.notes,
  });
  expect(document.body.textContent).toContain('浏览器正在工作');
  expect(account.value).toBe('raw  account');
  wrapper.unmount();
});

it('discards late page responses after the view is unmounted', async () => {
  const reply = deferred<Result<string>>();
  let listing: ReturnType<typeof useLatestRefresh<string>> | undefined;
  const wrapper = mount(
    defineComponent({
      setup() {
        listing = useLatestRefresh(() => reply.promise);
        return () => null;
      },
    }),
  );
  if (!listing) throw new Error('Listing missing');
  const request = listing.refresh();
  wrapper.unmount();
  reply.resolve({ ok: true, value: 'late' });
  await request;
  expect(listing.data.value).toBeUndefined();
});

it('keeps standalone preview unavailable for every operation', async () => {
  const results = await Promise.all([
    unavailableApi.browsers.list(),
    unavailableApi.cards.list({ page: 1, pageSize: 20 }),
    unavailableApi.cards.importText({ text: 'raw' }),
    unavailableApi.workTasks.start({ browserId: browser.id }),
    unavailableApi.settings.get(),
    unavailableApi.updates.check(),
  ]);
  expect(results.every((result) => !result.ok && result.error.code === 'UNAVAILABLE')).toBe(true);
});

it('persists the collapsed sidebar through typed settings while retaining accessible route and connection labels', async () => {
  const test = createTestApi();
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div>浏览器内容</div>' } },
      { path: '/cards', component: { template: '<div>卡内容</div>' } },
      { path: '/settings', component: { template: '<div>设置内容</div>' } },
    ],
  });
  await router.push('/');
  const wrapper = mount(App, {
    global: { plugins: [pinia, router], provide: { [desktopApiKey]: test.api } },
  });
  await flushPromises();
  await wrapper.get('[data-testid="sidebar-toggle"]').trigger('click');
  await flushPromises();
  expect(test.api.settings.save).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRevision: 1,
      apiKey: { kind: 'keep' },
      values: expect.objectContaining({ sidebarCollapsed: true }),
    }),
  );
  expect(wrapper.get('.app-shell').classes()).toContain('sidebar-collapsed');
  expect(wrapper.get('[data-testid="nav-cards"]').attributes('aria-label')).toBe('卡');
  expect(wrapper.get('[data-testid="connection-status"]').attributes('tabindex')).toBe('0');
  expect(wrapper.get('[data-testid="connection-status"]').attributes('aria-label')).toBe('已连接');
  wrapper.unmount();
  const next = mount(App, {
    global: { plugins: [createPinia(), router], provide: { [desktopApiKey]: test.api } },
  });
  await flushPromises();
  expect(next.get('.app-shell').classes()).toContain('sidebar-collapsed');
  next.unmount();
});

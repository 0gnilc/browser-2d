import type { UpdateState, UpdatesApi } from '@browser-2d/contracts/public';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import Updates from '../src/business/Updates.vue';
import { bridgeKey } from '../src/bridge';
import { createFixtureBridge } from '../src/fixture';

afterEach(() => {
  document.body.innerHTML = '';
});

function fixture(initial: UpdateState) {
  const api = createFixtureBridge();
  const listeners = new Set<(state: UpdateState) => void>();
  const unsubscribe = vi.fn();
  const updates: UpdatesApi = {
    getState: vi.fn<UpdatesApi['getState']>(async () => ({ ok: true, value: initial })),
    check: vi.fn<UpdatesApi['check']>(async () => ({ ok: true, value: initial })),
    download: vi.fn<UpdatesApi['download']>(async () => ({ ok: true, value: initial })),
    install: vi.fn<UpdatesApi['install']>(async () => ({ ok: true, value: { accepted: true } })),
    subscribe(listener) {
      listeners.add(listener);
      listener(initial);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
  };
  api.updates = updates;
  return {
    updates,
    unsubscribe,
    emit(state: UpdateState) {
      for (const listener of listeners) listener(state);
    },
    mount: () =>
      mount(Updates, { attachTo: document.body, global: { provide: { [bridgeKey]: api } } }),
  };
}

it('explains unavailable preview updates without presenting install actions', async () => {
  const test = fixture({
    status: 'unavailable',
    reason: 'unconfigured',
    currentVersion: '0.1.0',
    revision: 0,
  });
  const wrapper = test.mount();
  await flushPromises();
  expect(wrapper.text()).toContain('此预览版本尚未启用更新渠道');
  expect(wrapper.find('[data-testid="update-check"]').exists()).toBe(false);
  expect(wrapper.find('[data-testid="update-install"]').exists()).toBe(false);
  wrapper.unmount();
  expect(test.unsubscribe).toHaveBeenCalledOnce();
});

it('ignores an older initial reply after a subscription has announced a new version', async () => {
  const idle: UpdateState = {
    status: 'idle',
    channel: 'stable',
    currentVersion: '0.1.0',
    revision: 1,
  };
  const test = fixture(idle);
  let reply: ((value: Awaited<ReturnType<UpdatesApi['getState']>>) => void) | undefined;
  test.updates.getState = () =>
    new Promise((resolve) => {
      reply = resolve;
    });
  const wrapper = test.mount();
  test.emit({ ...idle, status: 'available', version: '0.2.0', revision: 2 });
  reply?.({ ok: true, value: idle });
  await flushPromises();
  expect(wrapper.get('[data-testid="update-status"]').text()).toContain('0.2.0');
  wrapper.unmount();
  expect(test.unsubscribe).toHaveBeenCalledOnce();
});

it('downloads separately and installs only after the stop-work confirmation', async () => {
  const initial: UpdateState = {
    status: 'available',
    channel: 'stable',
    currentVersion: '0.1.0',
    version: '0.2.0',
    revision: 1,
  };
  const test = fixture(initial);
  test.updates.download = vi.fn<UpdatesApi['download']>(async () => {
    const downloaded = { ...initial, status: 'downloaded', revision: 2 } satisfies UpdateState;
    test.emit(downloaded);
    return { ok: true, value: downloaded };
  });
  const wrapper = test.mount();
  await flushPromises();
  await wrapper.get('[data-testid="update-download"]').trigger('click');
  await flushPromises();
  expect(test.updates.download).toHaveBeenCalledOnce();
  expect(test.updates.install).not.toHaveBeenCalled();
  async function confirm(text: string) {
    const button = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === text,
    );
    expect(button).toBeDefined();
    button?.click();
    await flushPromises();
  }
  await wrapper.get('[data-testid="update-install"]').trigger('click');
  await flushPromises();
  await confirm('暂不安装');
  expect(test.updates.install).not.toHaveBeenCalled();
  await wrapper.get('[data-testid="update-install"]').trigger('click');
  await flushPromises();
  await confirm('停止任务并安装');
  expect(test.updates.install).toHaveBeenCalledOnce();
  wrapper.unmount();
});

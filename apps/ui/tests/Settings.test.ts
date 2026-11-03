import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { ElMessageBox, ElSelect, type MessageBoxInputData } from 'element-plus';
import { afterEach, expect, it, vi } from 'vitest';
import { failure, type Browser2dApi } from '@browser-2d/contracts/public';
import SettingsPage from '../src/views/settings/SettingsPage.vue';
import { desktopApiKey } from '../src/platform/desktop-api';
import { useApplicationSettingsStore } from '../src/stores/application-settings';
import { createTestApi, initialSettings } from './helpers';

function mountSettings(api: Browser2dApi) {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(SettingsPage, {
    attachTo: document.body,
    global: { plugins: [pinia], provide: { [desktopApiKey]: api } },
  });
}
async function save() {
  document.querySelector<HTMLButtonElement>('[data-testid="settings-save"]')?.click();
  await flushPromises();
}
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

it('keeps the credential private, saves a replacement, and clears the password after acknowledgement', async () => {
  const test = createTestApi();
  const wrapper = mountSettings(test.api);
  await flushPromises();
  expect(wrapper.text()).toContain('已配置密钥');
  expect(wrapper.text()).not.toContain('revision');
  expect(wrapper.text()).not.toContain('apiKeyRef');
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 'replace');
  await flushPromises();
  await wrapper.get('#settings-api-key').setValue('new-private-key');
  await save();
  expect(test.api.settings.save).toHaveBeenCalledWith({
    values: {
      apiBaseUrl: 'http://127.0.0.1:50325',
      maxConcurrentTasks: 2,
      sidebarCollapsed: false,
    },
    apiKey: { kind: 'replace', value: 'new-private-key' },
    expectedRevision: 1,
  });
  expect(wrapper.text()).toContain('设置已保存');
  expect(wrapper.text()).not.toContain('有未保存的修改');
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 'replace');
  await flushPromises();
  expect(wrapper.get<HTMLInputElement>('#settings-api-key').element.value).toBe('');
  wrapper.unmount();
});

it('sends keep and clear as explicit credential actions', async () => {
  const test = createTestApi();
  const wrapper = mountSettings(test.api);
  await flushPromises();
  await save();
  expect(test.api.settings.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ apiKey: { kind: 'keep' }, expectedRevision: 1 }),
  );
  wrapper.getComponent(ElSelect).vm.$emit('update:modelValue', 'clear');
  await flushPromises();
  await save();
  expect(test.api.settings.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ apiKey: { kind: 'clear' }, expectedRevision: 2 }),
  );
  expect(wrapper.text()).toContain('未配置密钥');
  wrapper.unmount();
});

it('uses the backend binding token only after the user confirms the precise connection save', async () => {
  const test = createTestApi();
  const token = '00000000-0000-4000-8000-000000000011';
  test.api.settings.save = vi
    .fn<Browser2dApi['settings']['save']>()
    .mockResolvedValueOnce({
      ok: true,
      value: { kind: 'binding_confirmation_required', token, browserCount: 3 },
    })
    .mockResolvedValueOnce({
      ok: true,
      value: {
        kind: 'saved',
        settings: {
          values: { ...initialSettings.values, apiBaseUrl: 'http://127.0.0.1:50326' },
          revision: 2,
        },
      },
    });
  const confirm = vi
    .spyOn(ElMessageBox, 'confirm')
    .mockResolvedValue(
      Object.assign('confirm', { value: '', action: 'confirm' } satisfies MessageBoxInputData),
    );
  const wrapper = mountSettings(test.api);
  await flushPromises();
  await wrapper.get('#settings-api-url').setValue('http://127.0.0.1:50326');
  await save();
  expect(confirm).toHaveBeenCalledWith(
    expect.stringContaining('3 个已保存浏览器'),
    '重新确认环境绑定',
    expect.any(Object),
  );
  expect(test.api.settings.save).toHaveBeenNthCalledWith(
    1,
    expect.not.objectContaining({ bindingConfirmationToken: expect.anything() }),
  );
  expect(test.api.settings.save).toHaveBeenNthCalledWith(2, {
    values: {
      apiBaseUrl: 'http://127.0.0.1:50326',
      maxConcurrentTasks: 2,
      sidebarCollapsed: false,
    },
    apiKey: { kind: 'keep' },
    expectedRevision: 1,
    bindingConfirmationToken: token,
  });
  expect(wrapper.text()).not.toContain(token);
  wrapper.unmount();
});

it('cancels binding confirmation without losing the draft or sending a confirmed save', async () => {
  const test = createTestApi();
  test.api.settings.save = vi.fn<Browser2dApi['settings']['save']>(async () => ({
    ok: true,
    value: {
      kind: 'binding_confirmation_required',
      token: '00000000-0000-4000-8000-000000000011',
      browserCount: 1,
    },
  }));
  vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel');
  const wrapper = mountSettings(test.api);
  await flushPromises();
  await wrapper.get('#settings-api-url').setValue('http://127.0.0.1:50326');
  await save();
  expect(test.api.settings.save).toHaveBeenCalledOnce();
  expect(wrapper.get<HTMLInputElement>('#settings-api-url').element.value).toBe(
    'http://127.0.0.1:50326',
  );
  expect(wrapper.text()).toContain('有未保存的修改');
  wrapper.unmount();
});

it('retains a conflicting draft and never silently rebases it over external changes', async () => {
  const test = createTestApi();
  test.api.settings.save = vi.fn(async () => failure('CONFLICT', '设置已被其他窗口修改'));
  const wrapper = mountSettings(test.api);
  await flushPromises();
  await wrapper.get('#settings-api-url').setValue('http://127.0.0.1:50326');
  const store = useApplicationSettingsStore();
  store.accept({ values: { ...initialSettings.values, maxConcurrentTasks: 8 }, revision: 9 });
  await flushPromises();
  await save();
  expect(test.api.settings.save).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRevision: 1,
      values: expect.objectContaining({ maxConcurrentTasks: 2 }),
    }),
  );
  expect(wrapper.get<HTMLInputElement>('#settings-api-url').element.value).toBe(
    'http://127.0.0.1:50326',
  );
  expect(wrapper.text()).toContain('当前草稿已保留');
  wrapper.unmount();
});

it('advances only a known local sidebar preference revision while retaining a dirty settings draft', async () => {
  const test = createTestApi();
  const wrapper = mountSettings(test.api);
  await flushPromises();
  await wrapper.get('#settings-api-url').setValue('http://127.0.0.1:50326');
  await useApplicationSettingsStore().toggleSidebar(test.api);
  await flushPromises();
  expect(wrapper.get<HTMLInputElement>('#settings-api-url').element.value).toBe(
    'http://127.0.0.1:50326',
  );
  expect(wrapper.text()).toContain('有未保存的修改');
  await save();
  expect(test.api.settings.save).toHaveBeenLastCalledWith({
    values: { apiBaseUrl: 'http://127.0.0.1:50326', maxConcurrentTasks: 2, sidebarCollapsed: true },
    apiKey: { kind: 'keep' },
    expectedRevision: 2,
  });
  expect(wrapper.text()).not.toContain('有未保存的修改');
  wrapper.unmount();
});

it('keeps the draft and old revision when a sidebar preference save conflicts', async () => {
  const test = createTestApi();
  const wrapper = mountSettings(test.api);
  await flushPromises();
  await wrapper.get('#settings-api-url').setValue('http://127.0.0.1:50326');
  test.api.settings.save = vi
    .fn<Browser2dApi['settings']['save']>()
    .mockResolvedValueOnce(failure('CONFLICT', '设置已变化'))
    .mockResolvedValueOnce({
      ok: true,
      value: { kind: 'saved', settings: { ...initialSettings, revision: 2 } },
    });
  await useApplicationSettingsStore().toggleSidebar(test.api);
  await flushPromises();
  expect(useApplicationSettingsStore().current?.values.sidebarCollapsed).toBe(false);
  expect(wrapper.text()).toContain('设置已变化');
  await save();
  expect(test.api.settings.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expectedRevision: 1,
      values: expect.objectContaining({
        apiBaseUrl: 'http://127.0.0.1:50326',
        sidebarCollapsed: false,
      }),
    }),
  );
  wrapper.unmount();
});

import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import {
  failure,
  type Browser2dApi,
  type Result,
  type SettingsSave,
  type SettingsSaveOutcome,
  type SettingsView,
} from '@browser-2d/contracts/public';

export const useApplicationSettingsStore = defineStore('application-settings', () => {
  const current = shallowRef<SettingsView>();
  const localPreferenceChange = shallowRef<{ before: SettingsView; after: SettingsView }>();
  const saving = ref(false);
  const error = ref('');
  let generation = 0;
  function accept(settings: SettingsView) {
    if (!current.value || settings.revision >= current.value.revision) current.value = settings;
  }
  async function load(api: Browser2dApi) {
    const request = ++generation;
    try {
      const result = await api.settings.get();
      if (request !== generation) return;
      if (result.ok) {
        accept(result.value);
        error.value = '';
      } else error.value = result.error.message;
    } catch {
      if (request === generation) error.value = '无法读取设置。请重新连接后刷新。';
    }
  }
  async function save(
    api: Browser2dApi,
    input: SettingsSave,
  ): Promise<Result<SettingsSaveOutcome>> {
    if (saving.value) return failure('CONFLICT', '设置正在保存，请稍后重试。');
    saving.value = true;
    generation += 1;
    try {
      const result = await api.settings.save(input);
      if (result.ok && result.value.kind === 'saved') {
        accept(result.value.settings);
        error.value = '';
      }
      return result;
    } catch {
      return failure('UNAVAILABLE', '连接中断，设置保存结果尚未确认。请刷新核对。');
    } finally {
      saving.value = false;
    }
  }
  async function toggleSidebar(api: Browser2dApi) {
    const before = current.value;
    if (!before || saving.value) return;
    error.value = '';
    const result = await save(api, {
      values: {
        apiBaseUrl: before.values.apiBaseUrl,
        maxConcurrentTasks: before.values.maxConcurrentTasks,
        sidebarCollapsed: !before.values.sidebarCollapsed,
      },
      apiKey: { kind: 'keep' },
      expectedRevision: before.revision,
    });
    if (result.ok && result.value.kind === 'saved') {
      localPreferenceChange.value = { before, after: result.value.settings };
    } else {
      error.value = result.ok ? '侧边栏偏好未保存，请刷新设置后重试。' : result.error.message;
    }
  }
  return { current, localPreferenceChange, saving, error, accept, load, save, toggleSidebar };
});

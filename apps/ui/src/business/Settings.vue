<script setup lang="ts">
import type { SettingsSave, SettingsValues, SettingsView } from '@browser-2d/contracts/public';
import { onMounted, reactive, ref } from 'vue';
import { NButton } from 'naive-ui';
import BusinessPage from './BusinessPage.vue';
import { useBusinessRequest } from './request';

const { busy, error, request } = useBusinessRequest();
const current = ref<SettingsView>();
const values = reactive<SettingsValues>({
  adsPowerUrl: '',
  viewportWidth: 1280,
  viewportHeight: 720,
  pageCount: 1,
});
const action = ref<SettingsSave['secret']['action']>('retain');
const persistence = ref<'persistent' | 'session'>('persistent');
const secret = ref('');
const saved = ref(false);
function accept(view: SettingsView) {
  current.value = view;
  Object.assign(values, {
    adsPowerUrl: view.adsPowerUrl,
    viewportWidth: view.viewportWidth,
    viewportHeight: view.viewportHeight,
    pageCount: view.pageCount,
  });
  secret.value = '';
  action.value = 'retain';
}
async function load() {
  const value = await request((api) => api.settings.get());
  if (value) {
    accept(value);
    saved.value = false;
  }
}
async function save() {
  if (!current.value) return;
  saved.value = false;
  const secretChange: SettingsSave['secret'] =
    action.value === 'replace'
      ? { action: 'replace', value: secret.value, persistence: persistence.value }
      : { action: action.value };
  const input: SettingsSave = {
    values: { ...values },
    expectedRevision: current.value.revision,
    secret: secretChange,
  };
  secret.value = '';
  const value = await request((api) => api.settings.save(input));
  if (value) {
    accept(value);
    saved.value = true;
  }
}
onMounted(load);
</script>

<template>
  <BusinessPage title="设置" :error="error">
    <section class="task-panel">
      <div class="business-toolbar">
        <h2>应用设置</h2>
        <NButton :disabled="busy" data-testid="settings-reload" @click="load">重新读取</NButton>
      </div>
      <p v-if="current" data-testid="settings-credential-state">
        凭据{{ current.keyConfigured ? '已配置' : '未配置' }} ·
        {{
          { none: '无凭据', persistent: '持久保存', session: '仅本次会话' }[current.credentialMode]
        }}
        · 版本 {{ current.revision }}
      </p>
      <p v-if="saved" role="status" data-testid="settings-saved">设置已保存。</p>
      <form class="business-form" data-testid="settings-form" @submit.prevent="save">
        <label class="field"
          >AdsPower 地址<input
            v-model="values.adsPowerUrl"
            data-testid="settings-url"
            maxlength="2048"
        /></label>
        <label class="field"
          >窗口宽度<input
            v-model.number="values.viewportWidth"
            data-testid="settings-width"
            type="number"
            min="1"
            max="16384"
            required
        /></label>
        <label class="field"
          >窗口高度<input
            v-model.number="values.viewportHeight"
            data-testid="settings-height"
            type="number"
            min="1"
            max="16384"
            required
        /></label>
        <label class="field"
          >页面数量<input
            v-model.number="values.pageCount"
            data-testid="settings-page-count"
            type="number"
            min="1"
            max="10000"
            required
        /></label>
        <label class="field"
          >凭据操作<select
            v-model="action"
            data-testid="settings-secret-action"
            @change="secret = ''"
          >
            <option value="retain">保留现有凭据</option>
            <option value="clear">清除凭据</option>
            <option value="replace">替换凭据</option>
          </select></label
        >
        <template v-if="action === 'replace'">
          <label class="field"
            >新 API Key<input
              v-model="secret"
              data-testid="settings-secret"
              type="password"
              autocomplete="new-password"
              required
              maxlength="16384"
          /></label>
          <label class="field"
            >保存方式<select v-model="persistence" data-testid="settings-persistence">
              <option value="persistent">持久保存</option>
              <option value="session">仅本次会话，重启后未配置</option>
            </select></label
          >
        </template>
        <p class="business-note">
          读取设置只返回配置状态。若保存提示版本冲突，请重新读取后核对再保存。
        </p>
        <div class="business-actions">
          <NButton
            type="primary"
            attr-type="submit"
            :disabled="busy || !current"
            data-testid="settings-save"
            >保存设置</NButton
          >
        </div>
      </form>
    </section>
  </BusinessPage>
</template>

<script setup lang="ts">
import type { SettingsSave, SettingsValues, SettingsView } from '@browser-2d/contracts/public';
import { computed, onMounted, reactive, ref } from 'vue';
import { ElButton, ElInput, ElInputNumber, ElSelect, ElCheckbox } from 'element-plus';
import BusinessPage from './BusinessPage.vue';
import Updates from './Updates.vue';
import { fieldProps, useBusinessRequest } from './request';

const { busy, error, request } = useBusinessRequest();
const current = ref<SettingsView>();
const formValues = reactive<SettingsValues>({
  browser: { mode: 'launch', executablePath: '', headless: false },
  viewportWidth: 1280,
  viewportHeight: 720,
  pageCount: 1,
});
const saved = ref(false);
const browserDescription = computed(() =>
  formValues.browser.mode === 'launch'
    ? '应用启动并管理独立 Chrome。'
    : '使用现有 Chrome 的独立会话，保留原有浏览器。调试地址须为本机 HTTP 地址并包含端口。',
);
const endpoint = computed({
  get: () => (formValues.browser.mode === 'connect' ? formValues.browser.endpoint : ''),
  set: (value: string) => {
    if (formValues.browser.mode === 'connect') formValues.browser.endpoint = value;
  },
});
function setWidth(value: number | null | undefined) {
  formValues.viewportWidth = value ?? 0;
}
function setHeight(value: number | null | undefined) {
  formValues.viewportHeight = value ?? 0;
}
function setPageCount(value: number | null | undefined) {
  formValues.pageCount = value ?? 0;
}
function accept(view: SettingsView) {
  current.value = view;
  Object.assign(formValues, {
    browser: { ...view.browser },
    viewportWidth: view.viewportWidth,
    viewportHeight: view.viewportHeight,
    pageCount: view.pageCount,
  });
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
  const input: SettingsSave = {
    values: { ...formValues, browser: { ...formValues.browser } },
    expectedRevision: current.value.revision,
  };
  const value = await request((api) => api.settings.save(input));
  if (value) {
    accept(value);
    saved.value = true;
  }
}
const viewportWidth = computed({ get: () => formValues.viewportWidth, set: setWidth });
const viewportHeight = computed({ get: () => formValues.viewportHeight, set: setHeight });
const pageCount = computed({ get: () => formValues.pageCount, set: setPageCount });
const browserMode = computed({
  get: () => formValues.browser.mode,
  set(mode: SettingsValues['browser']['mode']) {
    formValues.browser =
      mode === 'connect'
        ? { mode: 'connect', endpoint: 'http://127.0.0.1:9222' }
        : { mode: 'launch', executablePath: '', headless: false };
  },
});
onMounted(load);
</script>

<template>
  <BusinessPage title="设置" :error="error">
    <form class="settings-form" data-testid="settings-form" @submit.prevent="save">
      <section class="settings-section" aria-labelledby="browser-settings-title">
        <h2 id="browser-settings-title">Chrome</h2>
        <div class="settings-grid">
          <div class="field">
            <label for="settings-browser-mode">Chrome 模式</label>
            <ElSelect
              id="settings-browser-mode"
              v-model="browserMode"
              aria-label="Chrome 模式"
              data-testid="settings-browser-mode"
              :options="[
                { label: '启动新 Chrome', value: 'launch' },
                { label: '连接现有 Chrome', value: 'connect' },
              ]"
            />
          </div>
          <template v-if="formValues.browser.mode === 'launch'">
            <div class="field">
              <label for="settings-executable-path">Chrome 路径</label>
              <ElInput
                id="settings-executable-path"
                v-model="formValues.browser.executablePath"
                v-bind="fieldProps('settings-executable-path')"
                placeholder="留空自动查找"
                :maxlength="4096"
              />
            </div>
            <ElCheckbox v-model="formValues.browser.headless" data-testid="settings-headless">
              无头模式
            </ElCheckbox>
          </template>
          <div v-else class="field">
            <label for="settings-endpoint">本机调试地址</label>
            <ElInput
              id="settings-endpoint"
              v-model="endpoint"
              v-bind="fieldProps('settings-endpoint', { required: true })"
              placeholder="http://127.0.0.1:9222"
              :maxlength="2048"
            />
          </div>
        </div>
        <p class="business-note">{{ browserDescription }}</p>
      </section>
      <section class="settings-section" aria-labelledby="window-settings-title">
        <h2 id="window-settings-title">任务窗口</h2>
        <div class="settings-grid">
          <div class="field">
            <label for="settings-width">窗口宽度</label>
            <ElInputNumber
              id="settings-width"
              v-model="viewportWidth"
              data-testid="settings-width"
              aria-label="窗口宽度"
              :min="1"
              :max="16384"
            />
          </div>
          <div class="field">
            <label for="settings-height">窗口高度</label>
            <ElInputNumber
              id="settings-height"
              v-model="viewportHeight"
              data-testid="settings-height"
              aria-label="窗口高度"
              :min="1"
              :max="16384"
            />
          </div>
          <div class="field">
            <label for="settings-page-count">页面数量</label>
            <ElInputNumber
              id="settings-page-count"
              v-model="pageCount"
              data-testid="settings-page-count"
              aria-label="页面数量"
              :min="1"
              :max="10000"
            />
          </div>
        </div>
      </section>
      <div class="business-actions">
        <ElButton
          type="primary"
          native-type="submit"
          :disabled="busy || !current"
          data-testid="settings-save"
          >保存设置</ElButton
        >
        <ElButton :disabled="busy" data-testid="settings-reload" @click="load">重新读取</ElButton>
        <p v-if="saved" role="status" data-testid="settings-saved">设置已保存。</p>
      </div>
      <details v-if="current" class="technical-details">
        <summary>设置版本</summary>
        <p data-testid="settings-revision">版本 {{ current.revision }}</p>
        <p>若保存提示版本冲突，请重新读取后核对再保存。</p>
      </details>
    </form>
    <Updates />
  </BusinessPage>
</template>

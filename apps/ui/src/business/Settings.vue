<script setup lang="ts">
import type { SettingsSave, SettingsValues, SettingsView } from '@browser-2d/contracts/public';
import { computed, onMounted, reactive, ref } from 'vue';
import { NButton, NInput, NInputNumber, NSelect, NCheckbox, NForm } from 'naive-ui';
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
const endpoint = computed({
  get: () => (formValues.browser.mode === 'connect' ? formValues.browser.endpoint : ''),
  set: (value: string) => {
    if (formValues.browser.mode === 'connect') formValues.browser.endpoint = value;
  },
});
function setWidth(value: number | null) {
  formValues.viewportWidth = value ?? 0;
}
function setHeight(value: number | null) {
  formValues.viewportHeight = value ?? 0;
}
function setPageCount(value: number | null) {
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
    <section class="task-panel">
      <div class="business-toolbar">
        <h2>应用设置</h2>
        <NButton :disabled="busy" data-testid="settings-reload" @click="load">重新读取</NButton>
      </div>
      <p v-if="current" data-testid="settings-revision">版本 {{ current.revision }}</p>
      <p v-if="saved" role="status" data-testid="settings-saved">设置已保存。</p>
      <NForm class="business-form" data-testid="settings-form" @submit.prevent="save">
        <div class="field">
          <span>Chrome 模式</span
          ><NSelect
            aria-label="Chrome 模式"
            v-model:value="browserMode"
            data-testid="settings-browser-mode"
            :options="[
              { label: '启动新 Chrome', value: 'launch' },
              { label: '连接现有 Chrome', value: 'connect' },
            ]"
          />
        </div>
        <template v-if="formValues.browser.mode === 'launch'">
          <label class="field"
            >Chrome 路径<NInput
              v-model:value="formValues.browser.executablePath"
              :input-props="fieldProps('settings-executable-path')"
              placeholder="留空自动查找"
              :maxlength="4096"
          /></label>
          <label class="field"
            ><span>无头模式</span
            ><NCheckbox
              v-model:checked="formValues.browser.headless"
              data-testid="settings-headless"
          /></label>
        </template>
        <label v-else class="field"
          >本机调试地址<NInput
            v-model:value="endpoint"
            :input-props="fieldProps('settings-endpoint', { required: true })"
            placeholder="http://127.0.0.1:9222"
            :maxlength="2048"
        /></label>
        <label class="field"
          >窗口宽度<NInputNumber
            v-model:value="viewportWidth"
            :input-props="fieldProps('settings-width', { required: true })"
            :min="1"
            :max="16384"
        /></label>
        <label class="field"
          >窗口高度<NInputNumber
            v-model:value="viewportHeight"
            :input-props="fieldProps('settings-height', { required: true })"
            :min="1"
            :max="16384"
        /></label>
        <label class="field"
          >页面数量<NInputNumber
            v-model:value="pageCount"
            :input-props="fieldProps('settings-page-count', { required: true })"
            :min="1"
            :max="10000"
        /></label>
        <p class="business-note">
          启动模式使用独立浏览器。连接模式使用现有 Chrome 的独立会话，地址须为本机 HTTP
          地址并包含端口。若保存提示版本冲突，请重新读取后核对再保存。
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
      </NForm>
    </section>
    <Updates />
  </BusinessPage>
</template>

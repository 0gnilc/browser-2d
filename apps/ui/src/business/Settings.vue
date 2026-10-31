<script setup lang="ts">
import type { SettingsSave, SettingsValues, SettingsView } from '@browser-2d/contracts/public';
import { computed, onMounted, reactive, ref } from 'vue';
import { NButton } from 'naive-ui';
import BusinessPage from './BusinessPage.vue';
import { useBusinessRequest } from './request';

const { busy, error, request } = useBusinessRequest();
const current = ref<SettingsView>();
const values = reactive<SettingsValues>({
  browser: { mode: 'launch', executablePath: '', headless: false },
  viewportWidth: 1280,
  viewportHeight: 720,
  pageCount: 1,
});
const saved = ref(false);
function accept(view: SettingsView) {
  current.value = view;
  Object.assign(values, {
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
    values: { ...values, browser: { ...values.browser } },
    expectedRevision: current.value.revision,
  };
  const value = await request((api) => api.settings.save(input));
  if (value) {
    accept(value);
    saved.value = true;
  }
}
const browserMode = computed({
  get: () => values.browser.mode,
  set(mode: SettingsValues['browser']['mode']) {
    values.browser =
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
      <form class="business-form" data-testid="settings-form" @submit.prevent="save">
        <label class="field"
          >Chrome 模式<select v-model="browserMode" data-testid="settings-browser-mode">
            <option value="launch">启动新 Chrome</option>
            <option value="connect">连接现有 Chrome</option>
          </select></label
        >
        <template v-if="values.browser.mode === 'launch'">
          <label class="field"
            >Chrome 路径<input
              v-model="values.browser.executablePath"
              data-testid="settings-executable-path"
              maxlength="4096"
              placeholder="留空自动查找"
          /></label>
          <label class="field"
            ><span>无头模式</span
            ><input
              v-model="values.browser.headless"
              data-testid="settings-headless"
              type="checkbox"
          /></label>
        </template>
        <label v-else class="field"
          >本机调试地址<input
            v-model="values.browser.endpoint"
            data-testid="settings-endpoint"
            maxlength="2048"
            placeholder="http://127.0.0.1:9222"
            required
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
      </form>
    </section>
  </BusinessPage>
</template>

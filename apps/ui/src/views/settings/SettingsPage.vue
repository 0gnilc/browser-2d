<script setup lang="ts">
import { onMounted, reactive, shallowRef, ref, watch } from 'vue';
import {
  ElAlert,
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElMessageBox,
  ElOption,
  ElSelect,
  ElSkeleton,
  ElTag,
} from 'element-plus';
import {
  limits,
  settingsSaveSchema,
  type SettingsSave,
  type SettingsView,
} from '@browser-2d/contracts/public';
import PageFrame from '../../components/PageFrame.vue';
import ApplicationUpdates from './ApplicationUpdates.vue';
import { useDraftEditor } from '../../composables/useDraftEditor';
import { useDesktopApi } from '../../platform/desktop-api';
import { useApplicationSettingsStore } from '../../stores/application-settings';

type SettingsDraft = {
  apiBaseUrl: string;
  maxConcurrentTasks: number;
  apiKeyKind: SettingsSave['apiKey']['kind'];
  replacementKey: string;
};
const api = useDesktopApi();
const settings = useApplicationSettingsStore();
const editor = useDraftEditor<never, SettingsDraft>();
const baseline = shallowRef<SettingsView>();
const error = ref('');
const saved = ref(false);
const loading = ref(false);
async function useSettings(view: SettingsView) {
  const accepted = await editor.replace({
    kind: 'create',
    draft: reactive({
      apiBaseUrl: view.values.apiBaseUrl,
      maxConcurrentTasks: view.values.maxConcurrentTasks,
      apiKeyKind: 'keep',
      replacementKey: '',
    }),
  });
  if (accepted) {
    baseline.value = view;
    saved.value = false;
    error.value = '';
  }
}
watch(
  () => settings.current,
  (view) => {
    if (view && !baseline.value) void useSettings(view);
  },
  { immediate: true },
);
watch(
  () => settings.localPreferenceChange,
  (change) => {
    if (!change || baseline.value?.revision !== change.before.revision) return;
    const before = change.before.values;
    const after = change.after.values;
    if (
      before.apiBaseUrl === after.apiBaseUrl &&
      before.apiKeyConfigured === after.apiKeyConfigured &&
      before.maxConcurrentTasks === after.maxConcurrentTasks
    )
      baseline.value = change.after;
  },
);
async function reload() {
  if (editor.saving.value || editor.deciding.value) return;
  const allowed = await editor.leave();
  if (!allowed) return;
  loading.value = true;
  await settings.load(api);
  if (!settings.error && settings.current) await useSettings(settings.current);
  loading.value = false;
}
async function submit() {
  saved.value = false;
  await editor.save(async (session) => {
    const view = baseline.value;
    if (!view) return false;
    const draft = session.draft;
    const parsed = settingsSaveSchema.safeParse({
      values: {
        apiBaseUrl: draft.apiBaseUrl,
        maxConcurrentTasks: draft.maxConcurrentTasks,
        sidebarCollapsed: view.values.sidebarCollapsed,
      },
      apiKey:
        draft.apiKeyKind === 'replace'
          ? { kind: 'replace', value: draft.replacementKey }
          : { kind: draft.apiKeyKind },
      expectedRevision: view.revision,
    });
    if (!parsed.success) {
      error.value = '请填写有效的本机 API 地址、并发上限和替换密钥。';
      return false;
    }
    error.value = '';
    let result = await settings.save(api, parsed.data);
    if (result.ok && result.value.kind === 'binding_confirmation_required') {
      const confirmation = result.value;
      try {
        await ElMessageBox.confirm(
          `连接变更会影响 ${confirmation.browserCount} 个已保存浏览器的环境 ID 绑定。请确认这些环境属于新的连接，再继续保存。`,
          '重新确认环境绑定',
          {
            type: 'warning',
            confirmButtonText: '确认绑定并保存',
            cancelButtonText: '取消保存',
            closeOnHashChange: false,
          },
        );
      } catch {
        return false;
      }
      result = await settings.save(api, {
        ...parsed.data,
        bindingConfirmationToken: confirmation.token,
      });
    }
    if (!result.ok) {
      error.value =
        result.error.code === 'CONFLICT'
          ? `${result.error.message} 当前草稿已保留，请重新读取设置后核对。`
          : result.error.message;
      return false;
    }
    if (result.value.kind !== 'saved') {
      error.value = '绑定确认已失效，请重新保存。';
      return false;
    }
    baseline.value = result.value.settings;
    draft.apiKeyKind = 'keep';
    draft.replacementKey = '';
    editor.markSaved();
    saved.value = true;
    return false;
  });
}
onMounted(async () => {
  if (!settings.current) {
    loading.value = true;
    await settings.load(api);
    loading.value = false;
  }
});
</script>

<template>
  <PageFrame
    title="设置"
    description="配置浏览器平台连接、工作并发和应用更新。"
    class="settings-page"
  >
    <template #actions
      ><ElButton
        :disabled="editor.saving.value || settings.saving"
        :loading="loading"
        @click="reload"
        >重新读取设置</ElButton
      ></template
    >
    <ElAlert
      v-if="error || settings.error"
      :title="error || settings.error"
      type="error"
      :closable="false"
      role="alert"
      class="form-message"
    />
    <ElAlert
      v-if="saved"
      title="设置已保存。"
      type="success"
      :closable="false"
      role="status"
      class="form-message"
    />
    <ElSkeleton v-if="loading && !baseline" :rows="5" animated />
    <ElForm
      v-if="editor.session.value.kind !== 'closed'"
      class="settings-form"
      label-position="top"
      :disabled="editor.saving.value || settings.saving"
      @submit.prevent="submit"
    >
      <section class="settings-section">
        <h2>浏览器平台</h2>
        <p class="description">
          使用本机 AdsPower Local API。连接变更可能要求重新确认已有环境绑定。
        </p>
        <div class="settings-grid">
          <ElFormItem class="full-width" label="API 地址" for="settings-api-url"
            ><ElInput id="settings-api-url" v-model="editor.session.value.draft.apiBaseUrl"
          /></ElFormItem>
          <ElFormItem label="API 密钥" for="settings-api-key-action"
            ><ElSelect id="settings-api-key-action" v-model="editor.session.value.draft.apiKeyKind"
              ><ElOption label="保留现有密钥" value="keep" /><ElOption
                label="替换密钥"
                value="replace" /><ElOption label="清除密钥" value="clear" /></ElSelect
          ></ElFormItem>
          <div class="credential-state" role="status">
            <ElTag :type="baseline?.values.apiKeyConfigured ? 'success' : 'info'">{{
              baseline?.values.apiKeyConfigured ? '已配置密钥' : '未配置密钥'
            }}</ElTag>
          </div>
          <ElFormItem
            v-if="editor.session.value.draft.apiKeyKind === 'replace'"
            class="full-width"
            label="新 API 密钥"
            for="settings-api-key"
            ><ElInput
              id="settings-api-key"
              v-model="editor.session.value.draft.replacementKey"
              type="password"
              autocomplete="new-password"
          /></ElFormItem>
        </div>
      </section>
      <section class="settings-section">
        <h2>工作任务</h2>
        <div class="settings-grid">
          <ElFormItem label="最大并发浏览器数" for="settings-concurrency"
            ><ElInputNumber
              id="settings-concurrency"
              v-model="editor.session.value.draft.maxConcurrentTasks"
              :min="1"
              :max="limits.concurrentTasks"
              :precision="0"
          /></ElFormItem>
        </div>
        <p class="description">超过上限的任务按接纳顺序排队。停止中和待恢复的任务继续占用资源。</p>
      </section>
      <div class="form-actions settings-save">
        <ElButton
          type="primary"
          native-type="submit"
          :loading="editor.saving.value"
          data-testid="settings-save"
          >保存设置</ElButton
        ><span v-if="editor.dirty.value" class="secondary-text" role="status">有未保存的修改</span>
      </div>
    </ElForm>
    <ApplicationUpdates />
  </PageFrame>
</template>

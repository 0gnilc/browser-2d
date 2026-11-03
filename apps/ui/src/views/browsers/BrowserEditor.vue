<script setup lang="ts">
import { reactive } from 'vue';
import { ElAlert, ElButton, ElDrawer, ElForm, ElFormItem, ElInput } from 'element-plus';
import {
  browserCreateSchema,
  type Browser,
  type BrowserCreate,
} from '@browser-2d/contracts/public';
import { useDraftEditor } from '../../composables/useDraftEditor';
import { useDesktopRequest } from '../../composables/useDesktopRequest';

const emit = defineEmits<{ saved: [] }>();
const editor = useDraftEditor<Browser, BrowserCreate>();
const { api, error, request } = useDesktopRequest();
async function open(row?: Browser) {
  const draft = reactive<BrowserCreate>(
    row
      ? {
          provider: row.provider,
          profileId: row.profileId,
          name: row.name,
          account: row.account,
          amount: row.amount,
          notes: row.notes,
        }
      : { provider: 'adspower', profileId: '', name: '', account: '', amount: '0.00', notes: '' },
  );
  if (
    await editor.replace(row ? { kind: 'edit', original: row, draft } : { kind: 'create', draft })
  )
    error.value = '';
}
async function submit() {
  await editor.save(async (session) => {
    const parsed = browserCreateSchema.safeParse(session.draft);
    if (!parsed.success) {
      error.value = '请填写环境 ID。任务数值须为非负数，最多两位小数。';
      return false;
    }
    const result = await request(() =>
      session.kind === 'create'
        ? api.browsers.create(parsed.data)
        : api.browsers.update({ ...parsed.data, id: session.original.id }),
    );
    if (!result.ok) return false;
    emit('saved');
    return true;
  });
}
defineExpose({ open });
</script>

<template>
  <ElDrawer
    :model-value="editor.session.value.kind !== 'closed'"
    :title="editor.session.value.kind === 'edit' ? '编辑浏览器' : '添加浏览器'"
    size="min(560px, 100vw)"
    :before-close="editor.beforeClose"
    @update:model-value="
      (value) => {
        if (!value) editor.leave();
      }
    "
  >
    <template v-if="editor.session.value.kind !== 'closed'">
      <p class="description">引用已在 AdsPower 中创建的环境。任务使用此处保存的账号和数值。</p>
      <ElAlert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
        role="alert"
        class="form-message"
      />
      <ElForm
        class="drawer-form"
        label-position="top"
        :disabled="editor.saving.value"
        @submit.prevent="submit"
      >
        <ElFormItem label="名称" for="browser-name"
          ><ElInput id="browser-name" v-model="editor.session.value.draft.name"
        /></ElFormItem>
        <ElFormItem label="环境 ID" for="browser-profile"
          ><ElInput id="browser-profile" v-model="editor.session.value.draft.profileId" required
        /></ElFormItem>
        <ElFormItem label="账号" for="browser-account"
          ><ElInput id="browser-account" v-model="editor.session.value.draft.account"
        /></ElFormItem>
        <ElFormItem label="任务数值" for="browser-amount"
          ><ElInput
            id="browser-amount"
            v-model="editor.session.value.draft.amount"
            inputmode="decimal"
        /></ElFormItem>
        <ElFormItem class="full-width" label="备注" for="browser-notes"
          ><ElInput
            id="browser-notes"
            v-model="editor.session.value.draft.notes"
            type="textarea"
            :rows="3"
        /></ElFormItem>
        <div class="form-actions">
          <ElButton
            type="primary"
            native-type="submit"
            :loading="editor.saving.value"
            data-testid="browser-save"
            >保存</ElButton
          ><ElButton @click="editor.leave">取消</ElButton>
        </div>
      </ElForm>
    </template>
  </ElDrawer>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ElAlert, ElButton, ElDrawer, ElForm, ElFormItem, ElInput } from 'element-plus';
import { cardUpdateSchema, type Card, type CardUpdate } from '@browser-2d/contracts/public';
import { useDraftEditor } from '../../composables/useDraftEditor';
import { useDesktopRequest } from '../../composables/useDesktopRequest';
import { cardDraft, cardFields, type CardDraft } from './fields';

const emit = defineEmits<{ saved: [] }>();
const editor = useDraftEditor<Card, CardDraft>();
const { api, error, request } = useDesktopRequest();
const lock = ref<'none' | 'inputs' | 'all'>('none');
const changedInputs = computed(() => {
  const session = editor.session.value;
  return (
    session.kind === 'edit' &&
    cardFields.some(
      (field) => field.key !== 'notes' && session.draft[field.key] !== session.original[field.key],
    )
  );
});
async function open(row: Card) {
  if (await editor.replace({ kind: 'edit', original: row, draft: reactive(cardDraft(row)) })) {
    lock.value = row.status === 'processing' ? 'all' : row.inputLocked ? 'inputs' : 'none';
    error.value = '';
  }
}
function restoreInputs() {
  const session = editor.session.value;
  if (session.kind !== 'edit') return;
  for (const field of cardFields)
    if (field.key !== 'notes') session.draft[field.key] = session.original[field.key];
}
async function submit() {
  if (lock.value === 'all' || (lock.value === 'inputs' && changedInputs.value)) return;
  await editor.save(async (session) => {
    if (session.kind !== 'edit') return false;
    const update: CardUpdate = { id: session.original.id };
    for (const field of cardFields)
      if (session.draft[field.key] !== session.original[field.key])
        update[field.key] = session.draft[field.key];
    const parsed = cardUpdateSchema.safeParse(update);
    if (!parsed.success) {
      error.value = '前四个字段不能为空，字段内容超出限制时请缩短后重试。';
      return false;
    }
    const result = await request(() => api.cards.update(parsed.data));
    if (!result.ok) {
      if (result.error.reason === 'INPUT_LOCKED') lock.value = 'inputs';
      if (result.error.reason === 'ACTIVE_CLAIM') lock.value = 'all';
      return false;
    }
    emit('saved');
    return true;
  });
}
defineExpose({ open });
</script>

<template>
  <ElDrawer
    :model-value="editor.session.value.kind !== 'closed'"
    title="编辑卡"
    size="min(640px, 100vw)"
    :before-close="editor.beforeClose"
    @update:model-value="
      (value) => {
        if (!value) editor.leave();
      }
    "
  >
    <template v-if="editor.session.value.kind !== 'closed'">
      <p class="description">累计值、处理状态和验证结果由工作任务维护。</p>
      <ElAlert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
        role="alert"
        class="form-message"
      />
      <p v-if="lock === 'all'" role="status" class="form-message">
        卡正在被领取，暂时不能编辑。关闭后刷新再试。
      </p>
      <div v-if="lock === 'inputs'" class="form-message">
        <p>此卡已有处理记录，输入已锁定。未被领取时可修改本地备注。</p>
        <ElButton v-if="changedInputs" @click="restoreInputs">保留备注并恢复原始输入</ElButton>
      </div>
      <ElForm
        class="drawer-form"
        label-position="top"
        :disabled="editor.saving.value || lock === 'all'"
        @submit.prevent="submit"
      >
        <ElFormItem
          v-for="field in cardFields"
          :key="field.key"
          :label="field.label"
          :for="`card-${field.key}`"
          :class="{ 'full-width': ['billingAddress', 'extra', 'notes'].includes(field.key) }"
        >
          <ElInput
            :id="`card-${field.key}`"
            v-model="editor.session.value.draft[field.key]"
            :disabled="
              editor.saving.value || lock === 'all' || (lock === 'inputs' && field.key !== 'notes')
            "
            :type="['extra', 'notes'].includes(field.key) ? 'textarea' : 'text'"
          />
        </ElFormItem>
        <div class="form-actions">
          <ElButton
            type="primary"
            native-type="submit"
            :loading="editor.saving.value"
            :disabled="lock === 'inputs' && changedInputs"
            data-testid="card-save"
            >保存</ElButton
          ><ElButton @click="editor.leave">取消</ElButton>
        </div>
      </ElForm>
    </template>
  </ElDrawer>
</template>

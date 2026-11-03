<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, shallowRef } from 'vue';
import {
  ElAlert,
  ElButton,
  ElDrawer,
  ElForm,
  ElFormItem,
  ElInput,
  ElTable,
  ElTableColumn,
} from 'element-plus';
import { limits, type ImportLineResult, type ImportReport } from '@browser-2d/contracts/public';
import { useDraftEditor } from '../../composables/useDraftEditor';
import { useDesktopRequest } from '../../composables/useDesktopRequest';

const ImportColumn = ElTableColumn<ImportLineResult>;
const emit = defineEmits<{ imported: [] }>();
const editor = useDraftEditor<never, { text: string }>();
const { api, error, request } = useDesktopRequest();
const report = shallowRef<ImportReport>();
const unknownProgress = ref(false);
const importing = ref(false);
let fileGeneration = 0;
onBeforeUnmount(() => {
  fileGeneration += 1;
});
const template =
  'number|month|year|security_code|cardholder_name|address|city|region|postal_code|country_code|extra';
async function open() {
  if (await editor.replace({ kind: 'create', draft: reactive({ text: '' }) })) {
    report.value = undefined;
    unknownProgress.value = false;
    error.value = '';
  }
}
async function readFile(event: globalThis.Event) {
  const input = event.target;
  if (!(input instanceof globalThis.HTMLInputElement)) return;
  const file = input.files?.[0];
  const session = editor.session.value;
  if (!file || session.kind === 'closed' || editor.saving.value) return;
  const currentFile = ++fileGeneration;
  error.value = '';
  try {
    if (file.size > limits.importBytes) {
      error.value = 'TXT 文件超过 5 MiB，请分批导入。';
      return;
    }
    const text = new globalThis.TextDecoder('utf-8', { fatal: true }).decode(
      await file.arrayBuffer(),
    );
    if (currentFile === fileGeneration && editor.session.value === session)
      session.draft.text = text;
  } catch {
    if (currentFile === fileGeneration && editor.session.value === session)
      error.value = '文件不是有效的 UTF-8 文本。请另存为 UTF-8 TXT 后重试。';
  } finally {
    input.value = '';
  }
}
async function submit() {
  await editor.save(async (session) => {
    fileGeneration += 1;
    importing.value = true;
    report.value = undefined;
    unknownProgress.value = false;
    const result = await request(() => api.cards.importText({ text: session.draft.text }));
    importing.value = false;
    if (result.ok) report.value = result.value;
    else
      unknownProgress.value =
        result.error.code === 'UNAVAILABLE' || result.error.code === 'INTERNAL';
    emit('imported');
    return false;
  });
}
defineExpose({ open });
</script>

<template>
  <ElDrawer
    :model-value="editor.session.value.kind !== 'closed'"
    title="导入卡"
    size="min(760px, 100vw)"
    :before-close="editor.beforeClose"
    @update:model-value="
      (value) => {
        if (!value) editor.leave();
      }
    "
  >
    <template v-if="editor.session.value.kind !== 'closed'">
      <p class="description">
        每行固定十一列，前四列必填。选填项为空时保留分隔符。仅去掉各字段首尾空白。
      </p>
      <pre class="import-template" aria-label="固定十一列导入模板">{{ template }}</pre>
      <ElAlert
        v-if="error"
        :title="error"
        type="error"
        :closable="false"
        role="alert"
        class="form-message"
      />
      <p v-if="unknownProgress" role="status" class="form-message">
        导入进度未知，部分行可能已经提交。文本已保留，请刷新卡列表核对。重试时原有记录会报告为重复。
      </p>
      <ElForm
        class="import-form"
        label-position="top"
        :disabled="editor.saving.value"
        @submit.prevent="submit"
      >
        <ElFormItem label="卡文本" for="card-import-text"
          ><ElInput
            id="card-import-text"
            v-model="editor.session.value.draft.text"
            @update:model-value="fileGeneration += 1"
            type="textarea"
            :rows="9"
            placeholder="粘贴固定格式的多行卡文本"
        /></ElFormItem>
        <div class="file-input">
          <label for="card-import-file">或选择 UTF-8 TXT 文件</label
          ><input
            id="card-import-file"
            type="file"
            accept=".txt,text/plain"
            :disabled="editor.saving.value"
            @change="readFile"
          />
        </div>
        <div class="form-actions">
          <ElButton
            type="primary"
            native-type="submit"
            :loading="importing"
            :disabled="!editor.session.value.draft.text"
            data-testid="card-import-submit"
            >导入</ElButton
          ><ElButton @click="emit('imported')">刷新卡列表</ElButton
          ><ElButton @click="editor.leave">关闭</ElButton>
        </div>
      </ElForm>
      <section v-if="report" class="import-report" aria-labelledby="import-report-title">
        <h2 id="import-report-title">
          {{ report.outcome === 'partial' ? '部分导入已提交' : '导入结果' }}
        </h2>
        <p role="status">
          已插入 {{ report.inserted }}，重复 {{ report.duplicates }}，无效
          {{ report.invalid }}，空行 {{ report.blank }}。
        </p>
        <p v-if="report.message">{{ report.message }}</p>
        <p v-if="report.unprocessedFromLine !== null">
          从原始第 {{ report.unprocessedFromLine }} 行起尚未处理。
        </p>
        <ElTable :data="report.lines" border max-height="280" class="report-table"
          ><ImportColumn prop="line" label="原始行号" width="100" /><ImportColumn
            label="结果"
            width="100"
            ><template #default="{ row }">{{
              { inserted: '已插入', duplicate: '重复', invalid: '无效', blank: '空行' }[row.kind]
            }}</template></ImportColumn
          ><ImportColumn label="说明" min-width="200"
            ><template #default="{ row }">{{
              row.kind === 'invalid' ? row.message : ''
            }}</template></ImportColumn
          ></ElTable
        >
      </section>
    </template>
  </ElDrawer>
</template>

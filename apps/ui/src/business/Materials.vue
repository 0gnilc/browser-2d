<script setup lang="ts">
import {
  materialCreateSchema,
  materialUpdateSchema,
  type ImportReport,
  type Material,
  type MaterialQuery,
} from '@browser-2d/contracts/public';
import { computed, onMounted, reactive, ref } from 'vue';
import {
  ElAlert,
  ElButton,
  ElPagination,
  ElPopconfirm,
  ElInput,
  ElSelect,
  ElDrawer,
  ElTable,
  ElTableColumn,
  ElTag,
  ElRadioGroup,
  ElRadioButton,
  ElPopover,
  ElCheckbox,
} from 'element-plus';
import BusinessPage from './BusinessPage.vue';
import { fieldProps, nullableNumber, useBusinessRequest } from './request';
import { useEditor } from './useEditor';
const { busy, error, request } = useBusinessRequest();
const rows = ref<Material[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const card = ref('');
const status = ref<MaterialQuery['status']>();
const applied = ref<{ card: string; status: MaterialQuery['status'] }>({
  card: '',
  status: undefined,
});
const report = ref<ImportReport>();
const fields = ref(['name', 'expiry', 'amount', 'device', 'note']);
const density = ref<'default' | 'small' | 'large'>('default');
const textFields = [
  { key: 'card', label: '卡号' },
  { key: 'month', label: '月份' },
  { key: 'year', label: '年份' },
  { key: 'cvv', label: 'CVV' },
  { key: 'name', label: '姓名' },
  { key: 'address', label: '地址' },
  { key: 'city', label: '城市' },
  { key: 'state', label: '州' },
  { key: 'zip', label: '邮编' },
  { key: 'country', label: '国家' },
  { key: 'extra', label: '附加信息' },
  { key: 'device', label: '设备' },
  { key: 'note', label: '备注' },
] satisfies {
  key: keyof Omit<Material, 'id' | 'createTime' | 'amount' | 'status'>;
  label: string;
}[];
function emptyForm(): Omit<Material, 'id' | 'createTime' | 'amount'> & { amount: string } {
  return {
    card: '',
    month: '',
    year: '',
    cvv: '',
    name: null,
    address: null,
    city: null,
    state: null,
    zip: null,
    country: null,
    extra: null,
    amount: '',
    status: 0,
    device: null,
    note: null,
  };
}

const editor = useEditor<Material, ReturnType<typeof emptyForm>>();
const importer = useEditor<never, { text: string }>();
const editing = computed(() =>
  editor.session.value.kind === 'edit' ? editor.session.value.original.id : null,
);
const form = computed(() =>
  editor.session.value.kind === 'closed' ? emptyForm() : editor.session.value.draft,
);
const importDraft = computed(() =>
  importer.session.value.kind === 'closed' ? { text: '' } : importer.session.value.draft,
);
const statusOptions = computed(() =>
  [...new Set([0, 2, 3, 4, 5, 6, ...(form.value.status === null ? [] : [form.value.status])])]
    .filter((value) => value !== 1)
    .map((value) => ({ label: String(value), value })),
);
const outcomes = { inserted: '已插入', invalid: '无效', duplicate: '重复', blank: '空行' };
function outcomeLabel(value: keyof typeof outcomes) {
  return outcomes[value];
}
function processing(id: number) {
  return rows.value.find((row) => row.id === id)?.status === 1;
}
function mask(value: string) {
  return value.length > 4 ? `•••• ${value.slice(-4)}` : '••••';
}
async function create() {
  if (await importer.leave())
    await editor.replace({ kind: 'create', draft: reactive(emptyForm()) });
}
async function openImport() {
  if (await editor.leave())
    await importer.replace({ kind: 'create', draft: reactive({ text: '' }) });
}
async function edit(id: number) {
  const row = rows.value.find((value) => value.id === id);
  if (!row) return;
  if (busy.value || processing(row.id) || !(await importer.leave())) return;
  const values = {
    card: row.card,
    month: row.month,
    year: row.year,
    cvv: row.cvv,
    name: row.name,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    country: row.country,
    extra: row.extra,
    device: row.device,
    note: row.note,
    status: row.status,
    amount: row.amount === null ? '' : String(row.amount),
  };
  await editor.replace({
    kind: 'edit',
    original: row,
    draft: reactive(values),
  });
}
async function load(
  targetPage = page.value,
  targetSize = pageSize.value,
  targetQuery = applied.value,
) {
  if (busy.value) return;
  const query = {
    card: targetQuery.card,
    page: targetPage,
    pageSize: targetSize,
    ...(targetQuery.status === undefined ? {} : { status: targetQuery.status }),
  };
  const value = await request((api) => api.materials.page(query));
  if (!value) return;
  const last = Math.max(1, Math.ceil(value.total / targetSize));
  if (value.page > last) {
    await load(last, targetSize, targetQuery);
    return;
  }
  rows.value = value.items;
  total.value = value.total;
  page.value = value.page;
  pageSize.value = targetSize;
  applied.value = { ...targetQuery };
}
async function filter() {
  await load(1, pageSize.value, { card: card.value, status: status.value });
}
async function view(value: MaterialQuery['status']) {
  if (busy.value) return;
  status.value = value;
  await filter();
}
async function resetFilter() {
  if (busy.value) return;
  card.value = '';
  status.value = undefined;
  await filter();
}
async function resize(value: number) {
  await load(1, value);
}
async function navigate(value: number) {
  await load(value);
}
async function save() {
  if (busy.value) return;
  await editor.save(async (current) => {
    if (current.kind === 'edit' && processing(current.original.id)) {
      error.value = '处理中材料不可编辑。';
      return false;
    }
    const values = { ...current.draft, amount: nullableNumber(current.draft.amount) };
    let saved: Material | undefined;
    if (current.kind === 'edit') {
      const original = new Map(Object.entries(current.original));
      const changes = Object.fromEntries(
        Object.entries(values).filter(([key, value]) => original.get(key) !== value),
      );
      if (changes.status === 1) {
        error.value = '不能通过编辑将材料设为处理中。';
        return false;
      }
      const input = materialUpdateSchema.safeParse({ id: current.original.id, ...changes });
      if (!input.success) {
        error.value = '请检查已修改字段的格式。';
        return false;
      }
      saved = await request((api) => api.materials.update(input.data));
    } else {
      if (values.status === 1) return false;
      const input = materialCreateSchema.safeParse(values);
      if (!input.success) {
        error.value = '请检查卡号、有效期、CVV 和材料字段。';
        return false;
      }
      saved = await request((api) => api.materials.create(input.data));
    }
    if (!saved) return false;
    await load();
    return true;
  });
}
async function importLines() {
  if (busy.value) return;
  await importer.save(async (current) => {
    const value = await request((api) => api.materials.importText({ text: current.draft.text }));
    if (!value) return false;
    report.value = value;
    await load(1);
    return true;
  });
}
async function remove(id: number) {
  if (busy.value || processing(id)) return;
  if (editing.value === id && !(await editor.leave())) return;
  if (processing(id)) return;
  if (await request((api) => api.materials.delete({ id }))) await load();
}
async function reset(id: number) {
  if (busy.value || processing(id)) return;
  if (editing.value === id && !(await editor.leave())) return;
  if (processing(id)) return;
  if (await request((api) => api.materials.reset({ id }))) await load();
}
async function clear() {
  if (busy.value || !(await editor.leave()) || !(await importer.leave())) return;
  if (await request((api) => api.materials.clear())) {
    await load(1);
  }
}
onMounted(() => load());
</script>

<template>
  <BusinessPage title="材料" :error="error">
    <p class="business-note">
      卡号与状态筛选查询全部材料。表格隐藏完整卡号与 CVV，编辑时查看完整字段。
    </p>
    <div class="business-toolbar">
      <ElRadioGroup
        :model-value="applied.status ?? 'all'"
        :disabled="busy"
        aria-label="材料视图"
        @update:model-value="view($event === 0 ? 0 : $event === 1 ? 1 : undefined)"
        ><ElRadioButton value="all">全部材料</ElRadioButton
        ><ElRadioButton :value="0">可领取</ElRadioButton
        ><ElRadioButton :value="1">处理中</ElRadioButton></ElRadioGroup
      >
      <ElButton data-testid="material-import-open" @click="openImport">导入材料</ElButton
      ><ElButton type="primary" data-testid="material-new" @click="create">新增材料</ElButton>
    </div>
    <form class="business-toolbar" data-testid="material-filter" @submit.prevent="filter">
      <label class="field"
        >卡号<ElInput
          v-model="card"
          :disabled="busy"
          clearable
          v-bind="fieldProps('material-filter-card')"
          placeholder="按卡号查询全部材料"
      /></label>
      <div class="field">
        <span>状态</span
        ><ElSelect
          aria-label="筛选状态"
          :disabled="busy"
          :model-value="status ?? null"
          @update:model-value="status = $event ?? undefined"
          clearable
          :empty-values="[undefined, null]"
          :value-on-clear="null"
          placeholder="全部"
          data-testid="material-filter-status"
          :options="Array.from({ length: 7 }, (_, value) => ({ label: String(value), value }))"
        />
      </div>
      <ElButton native-type="submit" :disabled="busy" data-testid="material-filter-submit"
        >应用筛选</ElButton
      ><ElButton :disabled="busy" @click="resetFilter">重置筛选</ElButton>
      <ElPopover trigger="click" width="220"
        ><template #reference><ElButton>显示字段</ElButton></template>
        <div class="flex flex-col gap-2">
          <ElCheckbox
            v-for="field in [
              { key: 'name', label: '姓名' },
              { key: 'expiry', label: '有效期' },
              { key: 'amount', label: '金额' },
              { key: 'device', label: '设备' },
              { key: 'note', label: '备注' },
              { key: 'cvv', label: 'CVV（隐藏）' },
            ]"
            :key="field.key"
            :model-value="fields.includes(field.key)"
            @update:model-value="
              fields = $event ? [...fields, field.key] : fields.filter((key) => key !== field.key)
            "
            >{{ field.label }}</ElCheckbox
          >
        </div></ElPopover
      >
      <ElSelect
        v-model="density"
        aria-label="表格密度"
        class="density-select"
        :options="[
          { label: '标准', value: 'default' },
          { label: '紧凑', value: 'small' },
          { label: '宽松', value: 'large' },
        ]"
      />
      <ElPopconfirm
        title="清空全部材料？"
        confirm-button-text="确认"
        cancel-button-text="取消"
        @confirm="clear"
        ><template #reference
          ><ElButton :disabled="busy" data-testid="materials-clear">清空材料</ElButton></template
        ></ElPopconfirm
      >
    </form>
    <p class="business-note">
      已应用卡号 {{ applied.card || '全部' }} · 状态 {{ applied.status ?? '全部' }} · 共
      {{ total }} 条
    </p>
    <ElTable
      :data="rows"
      border
      row-key="id"
      :size="density"
      data-testid="materials-table"
      empty-text="暂无匹配材料"
      class="mt-4"
    >
      <ElTableColumn label="卡号" min-width="160"
        ><template #default="{ row }"
          ><span :data-testid="`material-${row.id}`">{{ mask(row.card) }}</span></template
        ></ElTableColumn
      >
      <ElTableColumn v-if="fields.includes('name')" prop="name" label="姓名" min-width="130" />
      <ElTableColumn v-if="fields.includes('expiry')" label="月 / 年" min-width="120"
        ><template #default="{ row }">{{ row.month }} / {{ row.year }}</template></ElTableColumn
      >
      <ElTableColumn v-if="fields.includes('cvv')" label="CVV" width="90"
        ><template #default>•••</template></ElTableColumn
      >
      <ElTableColumn v-if="fields.includes('amount')" label="金额" min-width="100"
        ><template #default="{ row }">{{ row.amount ?? '未设置' }}</template></ElTableColumn
      >
      <ElTableColumn label="状态" min-width="110"
        ><template #default="{ row }"
          ><ElTag :type="row.status === 1 ? 'warning' : 'info'">{{
            row.status === 0
              ? '可领取 · 0'
              : row.status === 1
                ? '处理中 · 1'
                : (row.status ?? '未设置')
          }}</ElTag></template
        ></ElTableColumn
      >
      <ElTableColumn v-if="fields.includes('device')" prop="device" label="设备" min-width="140" />
      <ElTableColumn v-if="fields.includes('note')" prop="note" label="备注" min-width="160" />
      <ElTableColumn label="操作" width="250" fixed="right"
        ><template #default="{ row }"
          ><div class="flex flex-wrap gap-2">
            <ElButton
              :disabled="busy || row.status === 1"
              :data-testid="`material-edit-${row.id}`"
              @click="edit(row.id)"
              >编辑</ElButton
            ><ElPopconfirm
              title="重置将清除设备与备注，并恢复为可领取。确认重置？"
              confirm-button-text="确认"
              cancel-button-text="取消"
              @confirm="reset(row.id)"
              ><template #reference
                ><ElButton
                  :disabled="busy || row.status === 1"
                  :data-testid="`material-reset-${row.id}`"
                  >重置</ElButton
                ></template
              ></ElPopconfirm
            ><ElPopconfirm
              title="删除此材料？"
              confirm-button-text="确认"
              cancel-button-text="取消"
              @confirm="remove(row.id)"
              ><template #reference
                ><ElButton
                  :disabled="busy || row.status === 1"
                  :data-testid="`material-delete-${row.id}`"
                  >删除</ElButton
                ></template
              ></ElPopconfirm
            >
          </div></template
        ></ElTableColumn
      >
    </ElTable>
    <div class="business-toolbar">
      <span data-testid="material-total">共 {{ total }} 条</span
      ><ElPagination
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="sizes, prev, pager, next"
        :disabled="busy"
        @update:current-page="navigate"
        @update:page-size="resize"
      />
    </div>
    <section v-if="report" data-testid="import-report" class="import-report" aria-live="polite">
      <h2>导入后逐行结果 · 实际提交 {{ report.committed }} 条</h2>
      <ElTable :data="report.lines" border row-key="line"
        ><ElTableColumn label="原始行号" prop="line" /><ElTableColumn label="结果"
          ><template #default="{ row }"
            ><span :data-testid="`import-line-${row.line}`"
              >第 {{ row.line }} 行 · {{ outcomeLabel(row.outcome) }}</span
            ></template
          ></ElTableColumn
        ></ElTable
      >
    </section>
    <ElDrawer
      :model-value="editor.session.value.kind !== 'closed'"
      :before-close="editor.beforeClose"
      :title="editing === null ? '新增材料' : `编辑材料 #${editing}`"
      size="min(640px, 100%)"
      destroy-on-close
    >
      <ElTag v-if="editor.dirty.value" type="warning">未保存</ElTag
      ><ElAlert v-if="error" :title="error" type="error" :closable="false" role="alert" />
      <form class="drawer-form" data-testid="material-form" @submit.prevent="save">
        <label v-for="field in textFields" :key="field.key" class="field"
          >{{ field.label
          }}<ElInput
            :disabled="editor.saving.value || editor.deciding.value"
            :model-value="form[field.key] ?? ''"
            @update:model-value="form[field.key] = $event"
            v-bind="
              fieldProps(`material-${field.key}`, {
                required:
                  ['card', 'month', 'year'].includes(field.key) ||
                  (field.key === 'cvv' && editing === null),
              })
            "
        /></label>
        <label class="field"
          >金额<ElInput
            :disabled="editor.saving.value || editor.deciding.value"
            placeholder="未设置"
            v-model="form.amount"
            v-bind="fieldProps('material-amount')"
        /></label>
        <div class="field">
          <span>状态</span
          ><ElSelect
            :disabled="editor.saving.value || editor.deciding.value"
            aria-label="状态"
            :model-value="form.status ?? null"
            @update:model-value="form.status = $event"
            clearable
            :empty-values="[undefined, null]"
            :value-on-clear="null"
            placeholder="未设置"
            data-testid="material-status"
            :options="statusOptions"
          />
        </div>
        <div class="business-actions">
          <ElButton
            type="primary"
            native-type="submit"
            :disabled="busy || editor.saving.value"
            data-testid="material-save"
            >保存材料</ElButton
          ><ElButton :disabled="busy || editor.saving.value" @click="editor.leave"
            >取消编辑</ElButton
          >
        </div>
      </form>
    </ElDrawer>
    <ElDrawer
      :model-value="importer.session.value.kind !== 'closed'"
      :before-close="importer.beforeClose"
      title="导入材料"
      size="min(640px, 100%)"
      destroy-on-close
    >
      <ElAlert v-if="error" :title="error" type="error" :closable="false" role="alert" />
      <p class="description">
        card|month|year|cvv|name|address|city|state|zip|country|extra。可选项留空时保留分隔符。提交后返回每行实际结果。
      </p>
      <form @submit.prevent="importLines" class="import-form">
        <label class="field"
          >导入内容<ElInput
            type="textarea"
            :disabled="importer.saving.value || importer.deciding.value"
            v-model="importDraft.text"
            v-bind="fieldProps('material-import-text', { required: true })"
            :autosize="{ minRows: 8, maxRows: 18 }"
        /></label>
        <div class="business-actions">
          <ElButton
            type="primary"
            native-type="submit"
            :disabled="busy || importer.saving.value"
            data-testid="material-import"
            >导入</ElButton
          ><ElButton :disabled="importer.saving.value" @click="importer.leave">取消</ElButton>
        </div>
      </form>
    </ElDrawer>
  </BusinessPage>
</template>

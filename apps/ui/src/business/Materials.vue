<script setup lang="ts">
import {
  materialCreateSchema,
  materialUpdateSchema,
  type ImportReport,
  type Material,
  type MaterialQuery,
} from '@browser-2d/contracts/public';
import { onMounted, reactive, ref } from 'vue';
import { NButton, NPagination, NPopconfirm } from 'naive-ui';
import BusinessPage from './BusinessPage.vue';
import { nullableNumber, useBusinessRequest } from './request';

const { busy, error, request } = useBusinessRequest();
const rows = ref<Material[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const card = ref('');
const status = ref<MaterialQuery['status']>();
const importText = ref('');
const report = ref<ImportReport>();
const editing = ref<number | null>(null);
let original = new Map<string, unknown>();
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
const form = reactive(emptyForm());
function resetEditor() {
  editing.value = null;
  original = new Map();
  Object.assign(form, emptyForm());
}
function edit(row: Material) {
  editing.value = row.id;
  original = new Map(Object.entries(row));
  Object.assign(form, {
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
    status: row.status,
    device: row.device,
    note: row.note,
    amount: row.amount === null ? '' : String(row.amount),
  });
}
async function load() {
  const value = await request((api) =>
    api.materials.page({
      page: page.value,
      pageSize: pageSize.value,
      card: card.value,
      ...(status.value === undefined ? {} : { status: status.value }),
    }),
  );
  if (value) {
    rows.value = value.items;
    total.value = value.total;
    page.value = value.page;
  }
}
async function filter() {
  page.value = 1;
  await load();
}
async function resetFilter() {
  card.value = '';
  status.value = undefined;
  await filter();
}
async function save() {
  const fields = { ...form, amount: nullableNumber(form.amount) };
  const changes = Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => original.get(key) !== value),
  );
  let value: Material | undefined;
  if (editing.value !== null) {
    const input = materialUpdateSchema.safeParse({ id: editing.value, ...changes });
    if (!input.success) {
      error.value = '请检查已修改字段的格式。';
      return;
    }
    value = await request((api) => api.materials.update(input.data));
  } else {
    const input = materialCreateSchema.safeParse(fields);
    if (!input.success) {
      error.value = '请检查卡号、有效期、CVV 和材料字段。';
      return;
    }
    value = await request((api) => api.materials.create(input.data));
  }
  if (value) {
    resetEditor();
    await load();
  }
}
async function importLines() {
  report.value = undefined;
  const value = await request((api) => api.materials.importText({ text: importText.value }));
  if (value) {
    report.value = value;
    await filter();
  }
}
async function remove(id: number) {
  if (await request((api) => api.materials.delete({ id }))) {
    if (editing.value === id) resetEditor();
    await load();
  }
}
async function reset(id: number) {
  const value = await request((api) => api.materials.reset({ id }));
  if (value) {
    if (editing.value === id) edit(value);
    await load();
  }
}
async function clear() {
  if (await request((api) => api.materials.clear())) {
    resetEditor();
    await filter();
  }
}
const outcomes = { inserted: '已插入', invalid: '无效', duplicate: '重复', blank: '空行' };
onMounted(load);
</script>

<template>
  <BusinessPage title="材料" :error="error">
    <section class="task-panel">
      <h2>按行导入材料</h2>
      <p class="description">
        card|month|year|cvv|name|address|city|state|zip|country|extra。可选项留空时保留分隔符。
      </p>
      <form @submit.prevent="importLines" class="import-form">
        <label class="field"
          >导入内容<textarea
            v-model="importText"
            data-testid="material-import-text"
            rows="4"
            required
          />
        </label>
        <NButton type="primary" attr-type="submit" :disabled="busy" data-testid="material-import"
          >导入</NButton
        >
      </form>
      <div v-if="report" data-testid="import-report" class="import-report" aria-live="polite">
        <strong>实际提交 {{ report.committed }} 条</strong>
        <ol>
          <li
            v-for="line in report.lines"
            :key="line.line"
            :data-testid="`import-line-${line.line}`"
          >
            第 {{ line.line }} 行 · {{ outcomes[line.outcome] }}
          </li>
        </ol>
      </div>
    </section>
    <section class="task-panel">
      <h2>{{ editing === null ? '新增材料' : `编辑材料 #${editing}` }}</h2>
      <form class="business-form" data-testid="material-form" @submit.prevent="save">
        <label v-for="field in textFields" :key="field.key" class="field"
          >{{ field.label
          }}<input
            v-model="form[field.key]"
            :data-testid="`material-${field.key}`"
            :required="
              ['card', 'month', 'year'].includes(field.key) ||
              (field.key === 'cvv' && editing === null)
            "
        /></label>
        <label class="field"
          >金额，留空表示未设置<input
            v-model="form.amount"
            data-testid="material-amount"
            type="number"
            step="1"
        /></label>
        <label class="field"
          >状态<select v-model="form.status" data-testid="material-status">
            <option :value="null">未设置</option>
            <option v-for="value in 7" :key="value" :value="value - 1">{{ value - 1 }}</option>
          </select></label
        >
        <div class="business-actions">
          <NButton type="primary" attr-type="submit" :disabled="busy" data-testid="material-save"
            >保存材料</NButton
          ><NButton :disabled="busy" @click="resetEditor">取消编辑</NButton>
        </div>
      </form>
    </section>
    <section class="history-panel">
      <form class="business-toolbar" data-testid="material-filter" @submit.prevent="filter">
        <label class="field">卡号<input v-model="card" data-testid="material-filter-card" /></label>
        <label class="field"
          >状态<select v-model="status" data-testid="material-filter-status">
            <option :value="undefined">全部</option>
            <option v-for="value in 7" :key="value" :value="value - 1">{{ value - 1 }}</option>
          </select></label
        >
        <NButton attr-type="submit" :disabled="busy" data-testid="material-filter-submit"
          >筛选</NButton
        ><NButton :disabled="busy" @click="resetFilter">重置筛选</NButton>
        <NPopconfirm @positive-click="clear"
          ><template #trigger
            ><NButton :disabled="busy" data-testid="materials-clear">清空材料</NButton></template
          >清空全部材料？</NPopconfirm
        >
      </form>
      <div class="table-scroll">
        <table data-testid="materials-table">
          <thead>
            <tr>
              <th>卡号</th>
              <th>月 / 年</th>
              <th>金额</th>
              <th>状态</th>
              <th>设备 / 备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" :data-testid="`material-${row.id}`">
              <td>{{ row.card }}</td>
              <td>{{ row.month }} / {{ row.year }}</td>
              <td>{{ row.amount ?? '未设置' }}</td>
              <td>{{ row.status ?? '未设置' }}</td>
              <td>{{ row.device }} / {{ row.note }}</td>
              <td class="row-actions">
                <NButton
                  size="small"
                  :disabled="busy"
                  :data-testid="`material-edit-${row.id}`"
                  @click="edit(row)"
                  >编辑</NButton
                ><NButton
                  size="small"
                  :disabled="busy"
                  :data-testid="`material-reset-${row.id}`"
                  @click="reset(row.id)"
                  >重置</NButton
                ><NPopconfirm @positive-click="remove(row.id)"
                  ><template #trigger
                    ><NButton
                      size="small"
                      :disabled="busy"
                      :data-testid="`material-delete-${row.id}`"
                      >删除</NButton
                    ></template
                  >删除此材料？</NPopconfirm
                >
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="6" class="empty-state">暂无匹配材料</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="business-toolbar">
        <span data-testid="material-total">共 {{ total }} 条</span
        ><NPagination
          v-model:page="page"
          v-model:page-size="pageSize"
          :item-count="total"
          :page-sizes="[20, 50, 100]"
          show-size-picker
          :disabled="busy"
          @update:page="load"
          @update:page-size="filter"
        />
      </div>
    </section>
  </BusinessPage>
</template>

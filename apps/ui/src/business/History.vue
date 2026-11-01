<script setup lang="ts">
import type { History, HistoryFilter } from '@browser-2d/contracts/public';
import { onMounted, reactive, ref } from 'vue';
import { NButton, NPagination, NPopconfirm, NInput, NSelect, NForm, NTable } from 'naive-ui';
import BusinessPage from './BusinessPage.vue';
import { fieldProps, useBusinessRequest } from './request';

const { busy, error, request } = useBusinessRequest();
const rows = ref<History[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const form = reactive({ card: '', note: '', startTime: '', endTime: '' });
const status = ref<HistoryFilter['status']>();
const exported = ref<{ text: string; count: number }>();
function filters(): HistoryFilter {
  return {
    ...(form.card ? { card: form.card } : {}),
    ...(form.note ? { note: form.note } : {}),
    ...(form.startTime ? { startTime: form.startTime } : {}),
    ...(form.endTime ? { endTime: form.endTime } : {}),
    ...(status.value === undefined ? {} : { status: status.value }),
  };
}
async function load() {
  const value = await request((api) =>
    api.history.page({ ...filters(), page: page.value, pageSize: pageSize.value }),
  );
  if (value) {
    rows.value = value.items;
    total.value = value.total;
    page.value = value.page;
  }
}
async function filter() {
  page.value = 1;
  exported.value = undefined;
  await load();
}
async function resetFilter() {
  Object.assign(form, { card: '', note: '', startTime: '', endTime: '' });
  status.value = undefined;
  await filter();
}
async function remove(id: number) {
  if (await request((api) => api.history.delete({ id }))) await load();
}
async function clear() {
  if (await request((api) => api.history.clear())) await filter();
}
async function exportText() {
  exported.value = undefined;
  const value = await request((api) => api.history.exportText(filters()));
  if (value) exported.value = value;
}
function download() {
  if (!exported.value) return;
  const url = globalThis.URL.createObjectURL(
    new globalThis.Blob([exported.value.text], { type: 'text/plain;charset=utf-8' }),
  );
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = 'history.txt';
  link.click();
  globalThis.URL.revokeObjectURL(url);
}
onMounted(load);
</script>

<template>
  <BusinessPage title="历史" :error="error">
    <section class="task-panel">
      <NForm class="business-form" data-testid="history-filter" @submit.prevent="filter">
        <label class="field"
          >卡号<NInput v-model:value="form.card" :input-props="fieldProps('history-filter-card')"
        /></label>
        <div class="field">
          <span>状态</span
          ><NSelect
            aria-label="状态"
            :value="status ?? null"
            @update:value="status = $event ?? undefined"
            clearable
            placeholder="全部"
            data-testid="history-filter-status"
            :options="Array.from({ length: 7 }, (_, value) => ({ label: String(value), value }))"
          />
        </div>
        <label class="field"
          >备注<NInput v-model:value="form.note" :input-props="fieldProps('history-filter-note')"
        /></label>
        <label class="field"
          >开始时间，含边界<NInput
            v-model:value="form.startTime"
            :input-props="fieldProps('history-start-time')"
            placeholder="YYYY-MM-DD HH:mm:ss"
        /></label>
        <label class="field"
          >结束时间，含边界<NInput
            v-model:value="form.endTime"
            :input-props="fieldProps('history-end-time')"
            placeholder="YYYY-MM-DD HH:mm:ss"
        /></label>
        <div class="business-actions">
          <NButton attr-type="submit" :disabled="busy" data-testid="history-filter-submit"
            >筛选</NButton
          ><NButton :disabled="busy" @click="resetFilter">重置筛选</NButton
          ><NButton :disabled="busy" data-testid="history-export" @click="exportText"
            >导出全部匹配记录</NButton
          ><NPopconfirm positive-text="确认" negative-text="取消" @positive-click="clear"
            ><template #trigger
              ><NButton :disabled="busy" data-testid="history-clear">清空历史</NButton></template
            >清空全部历史？</NPopconfirm
          >
        </div>
      </NForm>
      <div v-if="exported" class="export-result" data-testid="history-export-result">
        <p>已导出 {{ exported.count }} 条。旧格式 card|month|day|cvv。</p>
        <label class="field"
          >导出文本<NInput
            type="textarea"
            :value="exported.text"
            readonly
            :input-props="fieldProps('history-export-text')"
            :autosize="{ minRows: 4, maxRows: 10 }" /></label
        ><NButton @click="download" data-testid="history-download">下载 history.txt</NButton>
      </div>
    </section>
    <section class="history-panel">
      <div class="table-scroll">
        <NTable :bordered="false" :single-line="false" data-testid="history-table">
          <thead>
            <tr>
              <th>卡号</th>
              <th>月 / 日 / 年</th>
              <th>金额</th>
              <th>状态</th>
              <th>备注</th>
              <th>时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" :data-testid="`history-${row.id}`">
              <td>{{ row.card }}</td>
              <td>{{ row.month }} / {{ row.day }} / {{ row.year }}</td>
              <td>{{ row.amount ?? '未设置' }}</td>
              <td>{{ row.status ?? '未设置' }}</td>
              <td>{{ row.note }}</td>
              <td>{{ row.createTime }}</td>
              <td>
                <NPopconfirm
                  positive-text="确认"
                  negative-text="取消"
                  @positive-click="remove(row.id)"
                  ><template #trigger
                    ><NButton
                      size="small"
                      :disabled="busy"
                      :data-testid="`history-delete-${row.id}`"
                      >删除</NButton
                    ></template
                  >删除此历史记录？</NPopconfirm
                >
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="7" class="empty-state">暂无匹配历史</td>
            </tr>
          </tbody>
        </NTable>
      </div>
      <div class="business-toolbar">
        <span data-testid="history-total">共 {{ total }} 条</span
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

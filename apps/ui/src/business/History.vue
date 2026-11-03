<script setup lang="ts">
import type { History, HistoryFilter } from '@browser-2d/contracts/public';
import { onMounted, reactive, ref } from 'vue';
import {
  ElButton,
  ElPagination,
  ElPopconfirm,
  ElInput,
  ElSelect,
  ElTable,
  ElTableColumn,
} from 'element-plus';
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
      <form class="business-form" data-testid="history-filter" @submit.prevent="filter">
        <label class="field"
          >卡号<ElInput v-model="form.card" v-bind="fieldProps('history-filter-card')"
        /></label>
        <div class="field">
          <span>状态</span
          ><ElSelect
            aria-label="状态"
            :model-value="status ?? null"
            @update:model-value="status = $event ?? undefined"
            clearable
            :empty-values="[undefined, null]"
            :value-on-clear="null"
            placeholder="全部"
            data-testid="history-filter-status"
            :options="Array.from({ length: 7 }, (_, value) => ({ label: String(value), value }))"
          />
        </div>
        <label class="field"
          >备注<ElInput v-model="form.note" v-bind="fieldProps('history-filter-note')"
        /></label>
        <label class="field"
          >开始时间<ElInput
            v-model="form.startTime"
            v-bind="fieldProps('history-start-time')"
            placeholder="YYYY-MM-DD HH:mm:ss"
        /></label>
        <label class="field"
          >结束时间<ElInput
            v-model="form.endTime"
            v-bind="fieldProps('history-end-time')"
            placeholder="YYYY-MM-DD HH:mm:ss"
        /></label>
        <div class="business-actions">
          <ElButton native-type="submit" :disabled="busy" data-testid="history-filter-submit"
            >筛选</ElButton
          ><ElButton :disabled="busy" @click="resetFilter">重置筛选</ElButton
          ><ElButton :disabled="busy" data-testid="history-export" @click="exportText"
            >导出全部匹配记录</ElButton
          ><ElPopconfirm
            title="清空全部历史？"
            confirm-button-text="确认"
            cancel-button-text="取消"
            @confirm="clear"
            ><template #reference
              ><ElButton :disabled="busy" data-testid="history-clear">清空历史</ElButton></template
            ></ElPopconfirm
          >
        </div>
      </form>
      <div v-if="exported" class="export-result" data-testid="history-export-result">
        <p>已导出 {{ exported.count }} 条</p>
        <label class="field"
          >导出文本<ElInput
            type="textarea"
            :model-value="exported.text"
            readonly
            v-bind="fieldProps('history-export-text')"
            :autosize="{ minRows: 4, maxRows: 10 }" /></label
        ><ElButton @click="download" data-testid="history-download">下载 history.txt</ElButton>
      </div>
    </section>
    <section class="history-panel">
      <ElTable
        :data="rows"
        border
        row-key="id"
        data-testid="history-table"
        empty-text="暂无匹配历史记录"
      >
        <ElTableColumn label="卡号" min-width="180"
          ><template #default="{ row }"
            ><span :data-testid="`history-${row.id}`">{{ row.card }}</span></template
          ></ElTableColumn
        >
        <ElTableColumn label="月 / 日 / 年" min-width="160"
          ><template #default="{ row }"
            >{{ row.month }} / {{ row.day }} / {{ row.year }}</template
          ></ElTableColumn
        >
        <ElTableColumn label="金额" min-width="100"
          ><template #default="{ row }">{{ row.amount ?? '未设置' }}</template></ElTableColumn
        >
        <ElTableColumn label="状态" min-width="90"
          ><template #default="{ row }">{{ row.status ?? '未设置' }}</template></ElTableColumn
        >
        <ElTableColumn prop="note" label="备注" min-width="160" />
        <ElTableColumn prop="createTime" label="时间" min-width="180" />
        <ElTableColumn label="操作" width="100" fixed="right"
          ><template #default="{ row }"
            ><ElPopconfirm
              title="删除此历史记录？"
              confirm-button-text="确认"
              cancel-button-text="取消"
              @confirm="remove(row.id)"
              ><template #reference
                ><ElButton :disabled="busy" :data-testid="`history-delete-${row.id}`"
                  >删除</ElButton
                ></template
              ></ElPopconfirm
            ></template
          ></ElTableColumn
        >
      </ElTable>
      <div class="business-toolbar">
        <span data-testid="history-total">共 {{ total }} 条</span
        ><ElPagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="sizes, prev, pager, next"
          :disabled="busy"
          @update:current-page="load"
          @update:page-size="filter"
        />
      </div>
    </section>
  </BusinessPage>
</template>

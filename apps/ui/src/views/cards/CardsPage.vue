<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElInput,
  ElMessageBox,
  ElOption,
  ElPagination,
  ElPopover,
  ElSelect,
  ElSkeleton,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus';
import type { Card, CardQuery } from '@browser-2d/contracts/public';
import PageFrame from '../../components/PageFrame.vue';
import { useDesktopApi } from '../../platform/desktop-api';
import { useDesktopRequest, useLatestRefresh } from '../../composables/useDesktopRequest';
import CardEditor from './CardEditor.vue';
import CardImport from './CardImport.vue';
import { cardFields, cardStatusLabels, resultText } from './fields';

const CardColumn = ElTableColumn<Card>;
const api = useDesktopApi();
const mutation = useDesktopRequest();
const editor = ref<InstanceType<typeof CardEditor>>();
const importer = ref<InstanceType<typeof CardImport>>();
const search = ref('');
const status = ref<Card['status'] | ''>('');
const query = ref<CardQuery>({ page: 1, pageSize: 20 });
const visibleFields = ref(cardFields.map((field) => field.key));
const fields = computed(() =>
  cardFields.filter((field) => visibleFields.value.includes(field.key)),
);
const listing = useLatestRefresh(() => api.cards.list({ ...query.value }));
function applyFilters() {
  query.value = {
    page: 1,
    pageSize: query.value.pageSize,
    ...(status.value ? { status: status.value } : {}),
    ...(search.value ? { search: search.value } : {}),
  };
  void listing.refresh();
}
function resetFilters() {
  search.value = '';
  status.value = '';
  applyFilters();
}
function setPage(page: number) {
  query.value = { ...query.value, page };
  void listing.refresh();
}
function setPageSize(pageSize: number) {
  query.value = { ...query.value, page: 1, pageSize };
  void listing.refresh();
}
async function remove(row: Card) {
  try {
    await ElMessageBox.confirm('永久删除这张卡及其已提交的处理记录？此操作无法撤销。', '删除卡', {
      type: 'warning',
      confirmButtonText: '永久删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  const result = await mutation.request(() => api.cards.remove({ id: row.id }));
  if (result.ok) await listing.refresh();
}
let disconnect = () => {};
onMounted(() => {
  disconnect = api.workTasks.subscribe(() => {
    void listing.refresh();
  });
  void listing.refresh();
});
onUnmounted(() => disconnect());
</script>

<template>
  <PageFrame title="卡" description="全部字段明文显示，按导入时间和记录 ID 升序排列。">
    <template #actions
      ><ElButton :loading="listing.loading.value" @click="listing.refresh">刷新</ElButton
      ><ElButton type="primary" data-testid="card-import-open" @click="importer?.open()"
        >导入卡</ElButton
      ></template
    >
    <ElAlert
      v-if="listing.error.value || mutation.error.value"
      :title="mutation.error.value || listing.error.value"
      type="error"
      :closable="false"
      role="alert"
      class="form-message"
    />
    <form class="section-toolbar" @submit.prevent="applyFilters">
      <ElInput
        v-model="search"
        class="workspace-search"
        aria-label="搜索卡"
        placeholder="搜索卡号、持卡人或备注"
        clearable
      />
      <div class="status-select">
        <ElSelect v-model="status" aria-label="卡状态" placeholder="全部状态"
          ><ElOption label="全部状态" value="" /><ElOption
            v-for="(label, value) in cardStatusLabels"
            :key="value"
            :label="label"
            :value="value"
        /></ElSelect>
      </div>
      <ElButton native-type="submit" data-testid="card-filter">筛选</ElButton
      ><ElButton @click="resetFilters">重置</ElButton>
      <ElPopover placement="bottom-end" title="显示字段" trigger="click" :width="280"
        ><template #reference><ElButton class="columns-button">显示字段</ElButton></template
        ><ElCheckboxGroup v-model="visibleFields" class="column-options"
          ><ElCheckbox v-for="field in cardFields" :key="field.key" :value="field.key">{{
            field.label
          }}</ElCheckbox></ElCheckboxGroup
        ></ElPopover
      >
    </form>
    <ElSkeleton v-if="listing.loading.value && !listing.data.value" :rows="5" animated />
    <div v-else class="table-region">
      <ElTable
        :data="listing.data.value?.items ?? []"
        border
        row-key="id"
        :empty-text="
          query.search || query.status
            ? '没有符合筛选条件的卡'
            : '粘贴多行文本或选择 UTF-8 TXT 文件导入卡。'
        "
        data-testid="cards-table"
      >
        <CardColumn
          v-for="field in fields"
          :key="field.key"
          :label="field.label"
          :min-width="field.width"
          show-overflow-tooltip
          ><template #default="{ row }"
            ><span class="raw-value" :title="row[field.key]" :aria-label="row[field.key]">{{
              row[field.key]
            }}</span></template
          ></CardColumn
        >
        <CardColumn prop="amount" label="累计值" min-width="110" />
        <CardColumn label="状态" min-width="110"
          ><template #default="{ row }"
            ><ElTag
              :type="
                row.status === 'failed'
                  ? 'danger'
                  : row.status === 'processing'
                    ? 'warning'
                    : 'info'
              "
              >{{ cardStatusLabels[row.status] }}</ElTag
            ></template
          ></CardColumn
        >
        <CardColumn label="最新验证结果" min-width="340" show-overflow-tooltip
          ><template #default="{ row }"
            ><span class="raw-value" :title="resultText(row.lastResult)">{{
              resultText(row.lastResult)
            }}</span></template
          ></CardColumn
        >
        <CardColumn prop="createdAt" label="导入时间 (UTC)" min-width="220" />
        <CardColumn prop="updatedAt" label="更新时间 (UTC)" min-width="220" />
        <CardColumn label="操作" width="160" fixed="right"
          ><template #default="{ row }"
            ><div class="row-actions">
              <ElButton
                size="small"
                :disabled="row.status === 'processing' || mutation.busy.value"
                @click="editor?.open(row)"
                >编辑</ElButton
              ><ElButton
                size="small"
                :disabled="row.status === 'processing' || mutation.busy.value"
                @click="remove(row)"
                >删除</ElButton
              >
            </div></template
          ></CardColumn
        >
      </ElTable>
    </div>
    <div class="pagination-row">
      <span class="secondary-text">{{
        listing.data.value ? `升序 · 共 ${listing.data.value.total} 张卡` : '尚未读取卡列表'
      }}</span
      ><ElPagination
        :current-page="query.page"
        :page-size="query.pageSize"
        :page-sizes="[20, 50, 100]"
        :total="listing.data.value?.total ?? 0"
        layout="sizes, prev, pager, next"
        background
        @update:current-page="setPage"
        @update:page-size="setPageSize"
      />
    </div>
    <CardEditor ref="editor" @saved="listing.refresh" /><CardImport
      ref="importer"
      @imported="listing.refresh"
    />
  </PageFrame>
</template>

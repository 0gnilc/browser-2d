<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  ElAlert,
  ElButton,
  ElInput,
  ElMessageBox,
  ElSkeleton,
  ElTable,
  ElTableColumn,
  ElTag,
} from 'element-plus';
import type { Browser } from '@browser-2d/contracts/public';
import PageFrame from '../../components/PageFrame.vue';
import BrowserEditor from './BrowserEditor.vue';
import { useWorkTasksStore } from '../../stores/work-tasks';
import { useDesktopRequest } from '../../composables/useDesktopRequest';

const BrowserColumn = ElTableColumn<Browser>;
const work = useWorkTasksStore();
const { api, busy, error, request } = useDesktopRequest();
const editor = ref<InstanceType<typeof BrowserEditor>>();
const search = ref('');
const filtered = computed(() =>
  work.browsers.filter((row) =>
    [row.name, row.profileId, row.account, row.notes].some((value) => value.includes(search.value)),
  ),
);
async function remove(row: Browser) {
  try {
    await ElMessageBox.confirm(
      `移除“${row.name || row.profileId}”的本地记录？AdsPower 环境将保留。`,
      '移除浏览器',
      { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  const result = await request(() => api.browsers.remove({ id: row.id }));
  if (result.ok) await work.refresh();
}
</script>

<template>
  <PageFrame title="浏览器" description="管理已有环境的任务输入，按行开始或停止工作。">
    <template #actions
      ><ElButton :loading="work.loading" @click="work.refresh">刷新</ElButton
      ><ElButton type="primary" data-testid="browser-add" @click="editor?.open()"
        >添加浏览器</ElButton
      ></template
    >
    <ElAlert
      v-if="work.error || work.controlError || error"
      :title="error || work.controlError || work.error"
      type="error"
      :closable="false"
      role="alert"
      class="form-message"
    />
    <div class="section-toolbar">
      <ElInput
        v-model="search"
        class="workspace-search"
        aria-label="搜索浏览器"
        placeholder="搜索名称、环境 ID、账号或备注"
        clearable
      /><span class="secondary-text">{{
        work.connection === 'connected' || work.browsers.length
          ? `${filtered.length} 个浏览器`
          : '尚未读取浏览器'
      }}</span>
    </div>
    <ElSkeleton v-if="work.loading && !work.browsers.length" :rows="5" animated />
    <div v-else class="table-region">
      <ElTable
        :data="filtered"
        border
        row-key="id"
        :empty-text="search ? '没有匹配的浏览器' : '添加已有环境 ID，开始管理浏览器工作。'"
        data-testid="browsers-table"
      >
        <BrowserColumn prop="name" label="名称" min-width="150" show-overflow-tooltip />
        <BrowserColumn prop="profileId" label="环境 ID" min-width="140" show-overflow-tooltip />
        <BrowserColumn prop="account" label="账号" min-width="170" show-overflow-tooltip />
        <BrowserColumn prop="amount" label="任务数值" min-width="110" />
        <BrowserColumn prop="count" label="完成卡数" min-width="100" />
        <BrowserColumn label="状态" min-width="140"
          ><template #default="{ row }"
            ><ElTag
              :type="
                row.status === 'recovery_required' || row.status === 'failed'
                  ? 'danger'
                  : work.busy(row)
                    ? 'warning'
                    : 'info'
              "
              >{{ work.label(row) }}</ElTag
            ></template
          ></BrowserColumn
        >
        <BrowserColumn prop="notes" label="备注" min-width="200" show-overflow-tooltip />
        <BrowserColumn prop="lastError" label="最新错误" min-width="240" show-overflow-tooltip />
        <BrowserColumn label="操作" width="280" fixed="right"
          ><template #default="{ row }"
            ><div class="row-actions">
              <ElButton
                v-if="!work.busy(row)"
                size="small"
                type="primary"
                :disabled="work.connection !== 'connected'"
                @click="work.control(row.id, 'start')"
                >开始工作</ElButton
              >
              <ElButton
                v-else
                size="small"
                :loading="work.requesting(row.id)"
                :disabled="work.requesting(row.id)"
                @click="work.control(row.id, 'stop')"
                >{{ row.status === 'recovery_required' ? '重试停止' : '停止工作' }}</ElButton
              >
              <ElButton size="small" :disabled="work.busy(row) || busy" @click="editor?.open(row)"
                >编辑</ElButton
              >
              <ElButton size="small" :disabled="work.busy(row) || busy" @click="remove(row)"
                >移除</ElButton
              >
            </div></template
          ></BrowserColumn
        >
      </ElTable>
    </div>
    <BrowserEditor ref="editor" @saved="work.refresh" />
  </PageFrame>
</template>

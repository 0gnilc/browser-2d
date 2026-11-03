<script setup lang="ts">
import { ElAlert, ElButton, ElTable, ElTableColumn } from 'element-plus';
import { useRunsStore } from './runs';
const store = useRunsStore();
const batchLabels = {
  'not-sent': '未发送',
  sending: '发送中',
  accepted: '已受理',
  rejected: '已拒绝',
  unknown: '结果未知',
};
function batchLabel(status: keyof typeof batchLabels) {
  return batchLabels[status];
}
</script>
<template>
  <aside class="workspace work-status" aria-label="运行时状态">
    <details class="runtime-details">
      <summary>运行详情</summary>
      <div class="runtime-content flex flex-wrap items-center gap-5">
        <span
          >进程 <span data-testid="worker-pid">{{ store.snapshot?.workerPid ?? '—' }}</span></span
        >
        <span>快照 {{ store.snapshot?.revision ?? '—' }}</span>
        <span v-if="store.snapshot" data-testid="capacity-limits"
          >上限 {{ store.snapshot.policy.devices }} 台设备 /
          {{ store.snapshot.policy.pages }} 页</span
        >
        <ElButton
          data-testid="refresh"
          :disabled="store.connection === 'connecting'"
          @click="store.refresh"
          >刷新状态</ElButton
        >
      </div>
    </details>
    <ElAlert
      v-if="store.error"
      class="error-message"
      type="error"
      :title="store.error"
      :closable="false"
      show-icon
      role="alert"
    />
    <details v-if="store.notice" :open="!!store.pending" class="receipt-details">
      <summary>{{ store.pending ? '查询结果' : '指令已受理，查看回执' }}</summary>
      <p data-testid="command-receipt">{{ store.notice }}</p>
    </details>
    <section
      v-if="store.pending"
      class="pending-panel"
      data-testid="pending-command"
      aria-live="polite"
    >
      <h2>指令结果待确认</h2>
      <p>请查询结果，或使用原指令重试。</p>
      <code data-testid="command-id">{{ store.pending.input.commandId }}</code>
      <div class="business-actions mt-4">
        <ElButton data-testid="query-command" :disabled="store.busy" @click="store.queryCommand"
          >查询原指令</ElButton
        >
        <ElButton
          data-testid="retry-command"
          :disabled="store.busy || store.connection !== 'connected'"
          @click="store.retryCommand"
          >使用相同 ID 重试</ElButton
        >
      </div>
    </section>
    <details
      v-if="store.batch.length"
      :open="store.batch.some((item) => item.status === 'unknown' || item.status === 'rejected')"
      class="batch-results"
      data-testid="batch-results"
      aria-live="polite"
    >
      <summary>
        批量操作 · 已受理 {{ store.batch.filter((item) => item.status === 'accepted').length }} /
        {{ store.batch.length }} 项
      </summary>
      <p>受理不代表完成。结果未知时，请查询或用原指令重试。</p>
      <ElTable :data="store.batch" border :row-key="(item) => item.command.input.commandId">
        <ElTableColumn prop="label" label="项目" min-width="180" />
        <ElTableColumn label="状态" min-width="120"
          ><template #default="{ row: item }"
            ><span :data-status="item.status">{{ batchLabel(item.status) }}</span></template
          ></ElTableColumn
        >
        <ElTableColumn label="结果" min-width="300"
          ><template #default="{ row: item }"
            >{{ item.message
            }}<code class="run-id">{{ item.command.input.commandId }}</code></template
          ></ElTableColumn
        >
      </ElTable>
    </details>
  </aside>
</template>

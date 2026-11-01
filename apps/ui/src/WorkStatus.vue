<script setup lang="ts">
import { computed } from 'vue';
import { NAlert, NButton, NTable } from 'naive-ui';
import { useRunsStore } from './runs';
const store = useRunsStore();
const connectionLabel = computed(
  () =>
    ({ connecting: '连接中', connected: '已连接', unavailable: '连接不可用' })[store.connection],
);
</script>
<template>
  <aside class="workspace work-status" aria-label="运行时状态">
    <p class="business-note verification-scope">
      本地浏览器验证工作区。任务只运行本地验证页面，不消耗业务材料。
    </p>
    <section class="connection-panel" aria-label="运行时状态">
      <div class="connection" data-testid="connection-status" :data-state="store.connection">
        <span class="status-dot" :class="store.connection"></span
        ><strong>{{ connectionLabel }}</strong>
      </div>
      <div class="runtime-stat">
        <span>WORKER PID</span
        ><strong data-testid="worker-pid">{{ store.snapshot?.workerPid ?? '—' }}</strong>
      </div>
      <div class="runtime-stat">
        <span>快照版本</span><strong>{{ store.snapshot?.revision ?? '—' }}</strong>
      </div>
      <NButton
        secondary
        data-testid="refresh"
        :disabled="store.connection === 'connecting'"
        @click="store.refresh"
        >刷新快照</NButton
      >
    </section>
    <p v-if="store.snapshot" data-testid="capacity-limits" class="business-note capacity-note">
      执行上限 {{ store.snapshot.policy.devices }} 台设备 /
      {{ store.snapshot.policy.pages }} 页。排队任务保留设备，未清理资源继续占用容量。
    </p>
    <NAlert v-if="store.error" class="error-message" type="error" title="请求未完成" role="alert">{{
      store.error
    }}</NAlert>
    <NAlert v-if="store.notice" class="error-message" type="info" data-testid="command-receipt">{{
      store.notice
    }}</NAlert>
    <section v-if="store.pending" class="task-panel" data-testid="pending-command">
      <h2>指令结果待确认</h2>
      <p>
        请先查询或用原指令重试。当前指令 ID
        <code data-testid="command-id">{{ store.pending.input.commandId }}</code>
      </p>
      <div class="business-actions">
        <NButton data-testid="query-command" :disabled="store.busy" @click="store.queryCommand"
          >查询原指令</NButton
        >
        <NButton
          data-testid="retry-command"
          :disabled="store.busy || store.connection !== 'connected'"
          @click="store.retryCommand"
          >使用相同 ID 重试</NButton
        >
      </div>
    </section>
    <details
      v-if="store.batch.length"
      :open="store.batch.some((item) => item.status === 'unknown' || item.status === 'rejected')"
      class="task-panel batch-results"
      data-testid="batch-results"
      aria-live="polite"
    >
      <summary>
        批量操作结果 · 已受理
        {{ store.batch.filter((item) => item.status === 'accepted').length }} /
        {{ store.batch.length }} 项<span class="batch-summary-hint">查看每项指令</span>
      </summary>
      <p class="business-note">
        受理回执表示指令已记录。最终状态以任务快照为准。结果未知时，请查询或用原指令重试。
      </p>
      <div class="table-scroll">
        <NTable :bordered="false"
          ><thead>
            <tr>
              <th>项目</th>
              <th>指令状态</th>
              <th>结果 / 指令 ID</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in store.batch"
              :key="item.command.input.commandId"
              :data-status="item.status"
            >
              <td>{{ item.label }}</td>
              <td>
                {{
                  {
                    'not-sent': '未发送',
                    sending: '发送中',
                    accepted: '已受理',
                    rejected: '已拒绝',
                    unknown: '结果未知',
                  }[item.status]
                }}
              </td>
              <td>
                {{ item.message }}<code class="run-id">{{ item.command.input.commandId }}</code>
              </td>
            </tr>
          </tbody></NTable
        >
      </div>
    </details>
  </aside>
</template>

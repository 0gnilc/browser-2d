<script setup lang="ts">
import type { Run } from "@browser-2d/contracts/public";
import { computed, inject, onMounted, onUnmounted, ref } from "vue";
import { NAlert, NButton, NTag } from "naive-ui";
import { bridgeKey } from "./bridge";
import { useRunsStore } from "./runs";

const store = useRunsStore();
const api = inject(bridgeKey);
const deviceId = ref("fixture-device");
const durationMs = ref(3000);
const fixtureMode = import.meta.env.VITE_FIXTURE_MODE === "1";
const connectionLabel = computed(
  () =>
    ({ connecting: "连接中", connected: "已连接", unavailable: "连接不可用" })[
      store.connection
    ],
);
const valid = computed(
  () =>
    deviceId.value.trim().length > 0 &&
    deviceId.value.trim().length <= 64 &&
    Number.isInteger(durationMs.value) &&
    durationMs.value >= 100 &&
    durationMs.value <= 30000,
);
const stateLabels: Record<Run["state"], string> = {
  running: "运行中",
  completed: "已完成",
  cancelled: "已取消",
  interrupted: "已中断",
};
let disconnect = () => {};
onMounted(() => {
  disconnect = store.connect(api);
});
onUnmounted(() => disconnect());

function time(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <main class="workspace">
    <header class="masthead">
      <a class="brand" href="#/" aria-label="Browser 2D 首页"
        ><span class="brand-mark">2D</span>Browser 2D</a
      >
      <span class="phase">P1 / FOUNDATION</span>
    </header>
    <section class="intro">
      <p class="eyebrow">桌面运行时 · 验证工作台</p>
      <h1>基础架构验收<span class="heading-dot">.</span></h1>
      <p class="description">
        从界面到工作进程，核对任务的启动、取消与持久化记录。
      </p>
    </section>
    <div class="environment">
      <span class="environment-label">合成任务 · 独立测试数据库</span>
      <span>{{
        fixtureMode
          ? "界面预览模式 · 数据仅保存在当前页面"
          : "仅执行受控计时任务"
      }}</span>
    </div>
    <section class="connection-panel" aria-label="运行时状态">
      <div
        class="connection"
        data-testid="connection-status"
        :data-state="store.connection"
      >
        <span class="status-dot" :class="store.connection"></span
        ><strong>{{ connectionLabel }}</strong>
      </div>
      <div class="runtime-stat">
        <span>WORKER PID</span
        ><strong data-testid="worker-pid">{{
          store.snapshot?.workerPid ?? "—"
        }}</strong>
      </div>
      <div class="runtime-stat">
        <span>快照版本</span
        ><strong>{{ store.snapshot?.revision ?? "—" }}</strong>
      </div>
      <NButton
        secondary
        data-testid="refresh"
        :disabled="!api"
        @click="store.refresh"
        >刷新快照</NButton
      >
    </section>
    <NAlert
      v-if="store.error"
      class="error-message"
      type="error"
      title="请求未完成"
      role="alert"
      >{{ store.error }}</NAlert
    >
    <section class="task-panel">
      <div class="section-heading">
        <span class="section-number">01</span>
        <div>
          <h2>启动合成任务</h2>
          <p>使用独立设备标识，观察任务状态的完整变化。</p>
        </div>
      </div>
      <form
        class="task-form"
        @submit.prevent="store.start(deviceId.trim(), durationMs)"
      >
        <label class="field device-field"
          ><span>设备标识</span
          ><input
            v-model="deviceId"
            data-testid="device-id"
            maxlength="64"
            required
            placeholder="fixture-device"
            autocomplete="off"
        /></label>
        <label class="field duration-field"
          ><span>运行时长 <small>毫秒</small></span
          ><input
            v-model.number="durationMs"
            data-testid="duration-ms"
            type="number"
            min="100"
            max="30000"
            step="100"
            required
        /></label>
        <NButton
          type="primary"
          attr-type="submit"
          data-testid="start-run"
          :loading="store.busy"
          :disabled="!valid || store.connection !== 'connected' || store.busy"
          >启动合成任务 <span aria-hidden="true">↗</span></NButton
        >
      </form>
      <p class="form-note">
        100–30,000 毫秒。任务记录由工作进程写入测试数据库。
      </p>
    </section>
    <section class="history-panel">
      <div class="section-heading history-heading">
        <span class="section-number">02</span>
        <div>
          <h2>
            持久化运行记录 <span class="count">{{ store.runs.length }}</span>
          </h2>
          <p>状态以工作进程返回的快照为准。</p>
        </div>
      </div>
      <div class="table-scroll">
        <table data-testid="run-table">
          <thead>
            <tr>
              <th>设备 / 任务 ID</th>
              <th>状态</th>
              <th>时长</th>
              <th>创建时间</th>
              <th class="action-column">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="run in store.runs"
              :key="run.id"
              :data-testid="`run-${run.id}`"
              :data-state="run.state"
            >
              <td>
                <strong class="device-name">{{ run.deviceId }}</strong
                ><span class="run-id" :title="run.id">{{ run.id }}</span>
              </td>
              <td>
                <NTag
                  round
                  size="small"
                  :bordered="false"
                  :type="
                    run.state === 'running'
                      ? 'info'
                      : run.state === 'completed'
                        ? 'success'
                        : 'default'
                  "
                  >{{ stateLabels[run.state] }}</NTag
                >
              </td>
              <td class="numeric">{{ run.durationMs.toLocaleString() }} ms</td>
              <td class="time-cell">{{ time(run.createdAt) }}</td>
              <td class="action-column">
                <NButton
                  v-if="run.state === 'running'"
                  size="small"
                  :data-testid="`cancel-${run.id}`"
                  :disabled="store.busy || store.connection !== 'connected'"
                  @click="store.cancel(run.id)"
                  >取消</NButton
                ><span v-else class="muted">—</span>
              </td>
            </tr>
            <tr v-if="!store.runs.length">
              <td colspan="5" class="empty-state">
                <span class="empty-symbol">＋</span><strong>尚无运行记录</strong
                ><span>启动一个合成任务，开始验证桌面闭环。</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer class="table-footer">
        <span>当前工作进程会话</span
        ><code>{{ store.snapshot?.epoch ?? "等待连接" }}</code>
      </footer>
    </section>
    <footer class="page-footer">
      <span>Browser 2D</span><span>基础能力验证 / P1</span>
    </footer>
  </main>
</template>

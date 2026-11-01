<script setup lang="ts">
import { deviceSchema, type Device, type Run } from '@browser-2d/contracts/public';
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import { NAlert, NButton, NForm, NSelect, NTable, NTag } from 'naive-ui';
import { bridgeKey } from './bridge';
import { useRunsStore } from './runs';

const store = useRunsStore();
const api = inject(bridgeKey);
const devices = ref<Device[]>([]);
const deviceId = ref<number | null>(null);
const devicesBusy = ref(false);
const devicesError = ref('');
const fixtureMode = import.meta.env.VITE_FIXTURE_MODE === '1';
const valid = computed(() => devices.value.some((device) => device.id === deviceId.value));
const stateLabels: Record<Run['state'], string> = {
  queued: '排队中',
  starting: '启动中',
  running: '运行中',
  stopping: '停止与清理中',
  completed: '已完成',
  cancelled: '已取消',
  failed: '失败',
  interrupted: '已中断',
};
function cancellable(state: Run['state']) {
  return state === 'queued' || state === 'starting' || state === 'running' || state === 'stopping';
}
let disposed = false;
async function loadDevices() {
  if (!api || devicesBusy.value) return;
  devicesBusy.value = true;
  devicesError.value = '';
  try {
    const result = await api.devices.list();
    if (disposed) return;
    if (!result.ok) devicesError.value = `${result.error.code} · ${result.error.message}`;
    else {
      devices.value = deviceSchema.array().parse(result.value);
      if (!devices.value.some((device) => device.id === deviceId.value)) {
        deviceId.value = devices.value[0]?.id ?? null;
      }
    }
  } catch (reason) {
    if (!disposed) devicesError.value = reason instanceof Error ? reason.message : '设备加载失败。';
  } finally {
    if (!disposed) devicesBusy.value = false;
  }
}
async function createFixtureDevice() {
  if (!api || devicesBusy.value) return;
  devicesBusy.value = true;
  devicesError.value = '';
  try {
    const result = await api.devices.create({
      symbol: `local-test-${globalThis.crypto.randomUUID()}`,
      note: '本地验证测试设备，无真实账户。',
    });
    if (disposed) return;
    if (!result.ok) devicesError.value = `${result.error.code} · ${result.error.message}`;
    else {
      const device = deviceSchema.parse(result.value);
      devices.value = [...devices.value, device];
      deviceId.value = device.id;
    }
  } catch (reason) {
    if (!disposed)
      devicesError.value = reason instanceof Error ? reason.message : '测试设备创建失败。';
  } finally {
    if (!disposed) devicesBusy.value = false;
  }
}
function start() {
  if (valid.value && deviceId.value !== null) void store.start(deviceId.value);
}
onMounted(() => {
  void loadDevices();
});
onUnmounted(() => {
  disposed = true;
});
function time(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
</script>

<template>
  <main class="workspace">
    <section class="intro">
      <h1>任务与运行记录<span class="heading-dot">.</span></h1>
      <p class="description">
        观察设备排队、容量限制、取消与资源清理。任务使用业务设备 ID 和受理时的设置。
      </p>
    </section>
    <div class="environment" data-testid="controlled-mode">
      <span class="environment-label">{{
        store.snapshot?.execution === 'chrome'
          ? 'Google Chrome · 本地页面验证'
          : '本地文件验证 · 固定时长'
      }}</span>
      <span>{{
        fixtureMode
          ? '界面预览 · 调度与业务功能不可用'
          : store.snapshot?.execution === 'chrome'
            ? '使用独立上下文，只运行本地验证页面，不消耗业务材料'
            : '不启动真实浏览器，不消耗业务材料，不产生业务执行结果'
      }}</span>
    </div>
    <section class="task-panel">
      <div class="section-heading">
        <div>
          <h2>启动本地验证任务</h2>
          <p>选择已有设备，或创建无账户的测试设备。设备记录保存在业务数据库。</p>
        </div>
      </div>
      <NAlert v-if="devicesError" type="error" role="alert" data-testid="devices-error">{{
        devicesError
      }}</NAlert>
      <NForm class="task-form" @submit.prevent="start">
        <div class="field device-field">
          <span>业务设备</span>
          <NSelect
            v-model:value="deviceId"
            aria-label="业务设备"
            data-testid="device-id"
            :disabled="devicesBusy"
            placeholder="请选择设备"
            :options="
              devices.map((device) => ({
                label: `#${device.id} · ${device.symbol}`,
                value: device.id,
              }))
            "
          />
        </div>
        <NButton
          type="primary"
          attr-type="submit"
          data-testid="start-run"
          :loading="store.busy"
          :disabled="
            !valid ||
            store.connection !== 'connected' ||
            store.busy ||
            store.batching ||
            !!store.pending
          "
          >启动本地验证任务</NButton
        >
      </NForm>
      <div class="business-actions fixture-actions">
        <NButton data-testid="devices-refresh" :disabled="!api || devicesBusy" @click="loadDevices"
          >刷新设备</NButton
        >
        <NButton
          data-testid="create-fixture-device"
          :disabled="!api || devicesBusy"
          @click="createFixtureDevice"
          >创建测试设备</NButton
        >
      </div>
      <p class="form-note">
        受理回执只确认指令已记录。最终状态与资源清理结果以快照为准。修改设置只影响之后受理的任务。
      </p>
    </section>
    <section class="history-panel">
      <div class="section-heading history-heading">
        <div>
          <h2>
            运行记录 <span class="count">{{ store.runs.length }}</span>
          </h2>
          <p>包含所有活动任务和有限的终态记录。中断后不会自动重放执行。</p>
        </div>
      </div>
      <div class="table-scroll">
        <NTable :bordered="false" :single-line="false" data-testid="run-table">
          <thead>
            <tr>
              <th>设备 / 任务 ID</th>
              <th>状态</th>
              <th>冻结设置</th>
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
                <strong class="device-name">#{{ run.deviceId }}</strong
                ><span class="run-id">{{ run.id }}</span>
              </td>
              <td>
                <NTag
                  round
                  size="small"
                  :bordered="false"
                  :type="run.state === 'completed' ? 'success' : 'default'"
                  >{{ stateLabels[run.state] }}</NTag
                >
              </td>
              <td class="numeric">
                版本 {{ run.config.revision }} · {{ run.config.pageCount }} 页<br />{{
                  run.config.viewportWidth
                }}
                × {{ run.config.viewportHeight }}
              </td>
              <td class="time-cell">{{ time(run.createdAt) }}</td>
              <td class="action-column">
                <NButton
                  v-if="cancellable(run.state)"
                  size="small"
                  :data-testid="`cancel-${run.id}`"
                  :disabled="
                    store.busy ||
                    store.batching ||
                    !!store.pending ||
                    store.connection !== 'connected'
                  "
                  @click="store.cancel(run.id)"
                  >取消</NButton
                ><span v-else class="muted">—</span>
              </td>
            </tr>
            <tr v-if="!store.runs.length">
              <td colspan="5" class="empty-state">
                <strong>尚无运行记录</strong><span>选择测试设备，启动本地验证任务。</span>
              </td>
            </tr>
          </tbody>
        </NTable>
      </div>
      <footer class="table-footer">
        <span>当前工作进程会话</span><code>{{ store.snapshot?.epoch ?? '等待连接' }}</code>
      </footer>
    </section>
    <section class="history-panel resources-panel">
      <div class="section-heading history-heading">
        <div>
          <h2>
            未解决资源 <span class="count">{{ store.snapshot?.resources.length ?? 0 }}</span>
          </h2>
          <p>保留占用直到确认清理完成。未知所有权不会授权删除资源。</p>
        </div>
      </div>
      <div class="table-scroll">
        <NTable :bordered="false" :single-line="false" data-testid="resources-table">
          <thead>
            <tr>
              <th>设备 / 任务</th>
              <th>资源操作</th>
              <th>页数 / 所有权</th>
              <th>状态 / 故障</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="resource in store.snapshot?.resources ?? []"
              :key="resource.operationId"
              :data-testid="`resource-${resource.operationId}`"
            >
              <td>
                #{{ resource.deviceId }}<span class="run-id">{{ resource.runId }}</span>
              </td>
              <td>{{ resource.operationId }}</td>
              <td>{{ resource.pages }} / {{ resource.ownership }}</td>
              <td>{{ resource.state }} / {{ resource.failure ?? '无故障报告' }}</td>
            </tr>
            <tr v-if="!store.snapshot?.resources.length">
              <td colspan="4" class="empty-state">
                {{ store.connection === 'connected' ? '当前无未解决资源' : '资源状态待连接确认' }}
              </td>
            </tr>
          </tbody>
        </NTable>
      </div>
    </section>
    <footer class="page-footer"><span>Browser 2D</span><span>本地浏览器验证</span></footer>
  </main>
</template>

<script setup lang="ts">
import { deviceSchema, type Device, type Run } from '@browser-2d/contracts/public';
import { computed, inject, onMounted, onUnmounted, ref, reactive } from 'vue';
import {
  ElAlert,
  ElButton,
  ElSelect,
  ElTag,
  ElDrawer,
  ElInput,
  ElTable,
  ElTableColumn,
  ElCheckbox,
  ElRadioGroup,
  ElRadioButton,
  ElDescriptions,
  ElDescriptionsItem,
} from 'element-plus';
import { bridgeKey } from './bridge';
import { deviceUnavailable, useRunsStore } from './runs';
import { useEditor } from './business/useEditor';

const store = useRunsStore();
const api = inject(bridgeKey);
const devices = ref<Device[]>([]);
const creator = useEditor<never, { selected: number[] }>();
const draft = computed(() =>
  creator.session.value.kind === 'closed' ? { selected: [] } : creator.session.value.draft,
);
const deviceSearch = ref('');
const search = ref('');
const view = ref('all');
const density = ref<'default' | 'small' | 'large'>('default');
const detailId = ref<string>();
const detail = computed(() => store.runs.find((run) => run.id === detailId.value));
const workDisabled = computed(
  () => store.connection !== 'connected' || store.busy || store.batching || !!store.pending,
);
const filtered = computed(() =>
  store.runs.filter(
    (run) =>
      `${run.id} ${devices.value.find((device) => device.id === run.deviceId)?.symbol ?? run.deviceId}`
        .toLocaleLowerCase()
        .includes(search.value.toLocaleLowerCase()) &&
      (view.value === 'all' ||
        (view.value === 'active' ? cancellable(run.state) : !cancellable(run.state))),
  ),
);
const filteredDevices = computed(() =>
  devices.value.filter((device) =>
    `${device.symbol} ${device.account ?? ''}`
      .toLocaleLowerCase()
      .includes(deviceSearch.value.toLocaleLowerCase()),
  ),
);
async function openCreator() {
  await creator.replace({ kind: 'create', draft: reactive({ selected: [] }) });
}
const visibleEligible = computed(() =>
  filteredDevices.value.filter((device) => !deviceUnavailable(store.snapshot, device.id)),
);
function selectVisible(checked: boolean) {
  const ids = visibleEligible.value.map((device) => device.id);
  draft.value.selected = checked
    ? [...new Set([...draft.value.selected, ...ids])]
    : draft.value.selected.filter((id) => !ids.includes(id));
}
function toggle(id: number, checked: boolean) {
  draft.value.selected = checked
    ? [...new Set([...draft.value.selected, id])]
    : draft.value.selected.filter((value) => value !== id);
}
async function startSelected() {
  if (workDisabled.value) return;
  const eligible = draft.value.selected.filter(
    (id) =>
      devices.value.some((device) => device.id === id) && !deviceUnavailable(store.snapshot, id),
  );
  if (!eligible.length) {
    devicesError.value = '请选择无活动任务或待清理资源的设备。';
    return;
  }
  await creator.save(async () => {
    await store.startMany(
      draft.value.selected.filter((id) => devices.value.some((device) => device.id === id)),
    );
    return true;
  });
}
const devicesBusy = ref(false);
const devicesError = ref('');
const fixtureMode = import.meta.env.VITE_FIXTURE_MODE === '1';
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
function stateLabel(state: Run['state']) {
  return stateLabels[state];
}
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
      draft.value.selected = draft.value.selected.filter((id) =>
        devices.value.some((device) => device.id === id),
      );
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
      draft.value.selected = [...new Set([...draft.value.selected, device.id])];
    }
  } catch (reason) {
    if (!disposed)
      devicesError.value = reason instanceof Error ? reason.message : '测试设备创建失败。';
  } finally {
    if (!disposed) devicesBusy.value = false;
  }
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
    <header class="page-heading flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1>任务</h1>
        <p class="business-note">当前快照中的近期任务记录。</p>
      </div>
      <ElButton type="primary" data-testid="task-new" @click="openCreator">新建任务</ElButton>
    </header>
    <p class="scope-note" data-testid="controlled-mode">
      {{
        fixtureMode
          ? '界面预览，业务不可用'
          : store.snapshot?.execution === 'chrome'
            ? 'Chrome 本地页面，不消耗业务材料'
            : '本地文件验证，不消耗业务材料'
      }}
    </p>
    <ElAlert
      v-if="devicesError && creator.session.value.kind === 'closed'"
      :title="devicesError"
      type="error"
      :closable="false"
      show-icon
      role="alert"
      data-testid="devices-error"
    />
    <div class="business-toolbar">
      <ElRadioGroup v-model="view" aria-label="任务视图"
        ><ElRadioButton value="all">最近任务 {{ store.runs.length }}</ElRadioButton
        ><ElRadioButton value="active">活动任务</ElRadioButton
        ><ElRadioButton value="terminal">最近结束</ElRadioButton></ElRadioGroup
      ><ElButton
        :disabled="workDisabled || !store.runs.some((run) => cancellable(run.state))"
        data-testid="tasks-stop-all"
        @click="
          store.cancelMany(store.runs.filter((run) => cancellable(run.state)).map((run) => run.id))
        "
        >停止全部活动任务</ElButton
      >
    </div>
    <div class="business-toolbar">
      <ElInput
        v-model="search"
        clearable
        placeholder="搜索当前快照中的设备或任务 ID"
        aria-label="搜索最近任务"
        class="workspace-search"
      /><ElSelect
        v-model="density"
        aria-label="表格密度"
        class="density-select"
        :options="[
          { label: '标准', value: 'default' },
          { label: '紧凑', value: 'small' },
          { label: '宽松', value: 'large' },
        ]"
      /><span class="secondary-text">{{ filtered.length }} 项</span>
    </div>
    <ElTable
      :data="filtered"
      border
      row-key="id"
      :size="density"
      data-testid="run-table"
      empty-text="尚无匹配运行记录"
    >
      <ElTableColumn label="设备 / 任务" min-width="220"
        ><template #default="{ row: run }"
          ><span :data-testid="`run-${run.id}`" :data-state="run.state">{{
            devices.find((device) => device.id === run.deviceId)?.symbol ?? `设备 #${run.deviceId}`
          }}</span
          ><code class="run-id">{{ run.id.slice(0, 8) }}</code></template
        ></ElTableColumn
      >
      <ElTableColumn label="状态" min-width="120"
        ><template #default="{ row: run }"
          ><ElTag
            :type="
              run.state === 'completed'
                ? 'success'
                : run.state === 'failed' || run.state === 'interrupted'
                  ? 'danger'
                  : 'info'
            "
            >{{ stateLabel(run.state) }}</ElTag
          ></template
        ></ElTableColumn
      >
      <ElTableColumn prop="createdAt" label="创建时间" min-width="180" sortable
        ><template #default="{ row: run }">{{ time(run.createdAt) }}</template></ElTableColumn
      >
      <ElTableColumn label="操作" width="200" fixed="right"
        ><template #default="{ row: run }"
          ><div class="flex flex-wrap gap-2">
            <ElButton :data-testid="`run-details-${run.id}`" @click="detailId = run.id"
              >详情</ElButton
            ><ElButton
              v-if="cancellable(run.state)"
              :data-testid="`cancel-${run.id}`"
              :disabled="workDisabled"
              @click="store.cancel(run.id)"
              >取消任务</ElButton
            >
          </div></template
        ></ElTableColumn
      >
    </ElTable>
    <details class="resources-panel" :open="!!store.snapshot?.resources.length">
      <summary>
        资源清理<span v-if="store.snapshot?.resources.length" class="resource-warning"
          >{{ store.snapshot.resources.length }} 项待确认</span
        >
      </summary>
      <p>未清理资源继续占用容量，清理完成后释放。</p>
      <ElTable
        :data="store.snapshot?.resources ?? []"
        border
        row-key="operationId"
        data-testid="resource-table"
        :empty-text="store.connection === 'connected' ? '当前无未解决资源' : '资源状态待连接确认'"
      >
        <ElTableColumn label="设备 / 任务" min-width="220"
          ><template #default="{ row }"
            ><span :data-testid="`resource-${row.operationId}`">#{{ row.deviceId }}</span
            ><code class="run-id">{{ row.runId }}</code></template
          ></ElTableColumn
        >
        <ElTableColumn prop="operationId" label="资源操作" min-width="220" /><ElTableColumn
          label="页数 / 所有权"
          min-width="150"
          ><template #default="{ row }"
            >{{ row.pages }} / {{ row.ownership }}</template
          ></ElTableColumn
        ><ElTableColumn label="状态 / 故障" min-width="200"
          ><template #default="{ row }"
            >{{ row.state }} / {{ row.failure ?? '无故障报告' }}</template
          ></ElTableColumn
        >
      </ElTable>
    </details>
    <ElDrawer
      :model-value="creator.session.value.kind !== 'closed'"
      :before-close="creator.beforeClose"
      title="新建任务 · 本地验证"
      size="min(720px, 100%)"
      destroy-on-close
    >
      <p class="description">
        按设备启动本地验证，不消耗业务材料。已受理和结果未知的指令可在页面顶部继续查看。
      </p>
      <ElAlert
        v-if="devicesError"
        :title="devicesError"
        type="error"
        :closable="false"
        show-icon
        role="alert"
        data-testid="devices-error"
        class="mt-4"
      />
      <div class="business-toolbar">
        <ElInput
          v-model="deviceSearch"
          clearable
          placeholder="搜索设备或账户"
          aria-label="搜索任务设备"
          class="workspace-search"
        /><ElButton
          data-testid="devices-refresh"
          :disabled="!api || devicesBusy || creator.saving.value"
          @click="loadDevices"
          >刷新设备</ElButton
        ><ElButton
          data-testid="create-fixture-device"
          :disabled="!api || devicesBusy || creator.saving.value"
          @click="createFixtureDevice"
          >创建测试设备</ElButton
        >
      </div>
      <ElTable
        :data="filteredDevices"
        border
        row-key="id"
        data-testid="task-devices-table"
        empty-text="暂无设备，请先创建或刷新设备"
        ><ElTableColumn label="选择" width="60"
          ><template #header
            ><ElCheckbox
              aria-label="选择当前视图可用设备"
              :disabled="!visibleEligible.length || creator.saving.value"
              :model-value="
                !!visibleEligible.length &&
                visibleEligible.every((device) => draft.selected.includes(device.id))
              "
              :indeterminate="
                visibleEligible.some((device) => draft.selected.includes(device.id)) &&
                !visibleEligible.every((device) => draft.selected.includes(device.id))
              "
              @update:model-value="selectVisible($event === true)" /></template
          ><template #default="{ row }"
            ><ElCheckbox
              :disabled="deviceUnavailable(store.snapshot, row.id) || creator.saving.value"
              :model-value="draft.selected.includes(row.id)"
              :aria-label="`选择设备 ${row.symbol}`"
              :data-testid="`task-device-select-${row.id}`"
              @update:model-value="toggle(row.id, $event === true)" /></template></ElTableColumn
        ><ElTableColumn prop="symbol" label="设备" min-width="150" /><ElTableColumn
          prop="account"
          label="账户"
          min-width="100"
        /><ElTableColumn label="可用性" min-width="150"
          ><template #default="{ row }">{{
            deviceUnavailable(store.snapshot, row.id) ? '任务 / 资源占用中' : '可启动'
          }}</template></ElTableColumn
        ></ElTable
      >
      <div class="business-toolbar">
        <span
          >已选 {{ draft.selected.length }} 台，当前视图
          {{ filteredDevices.filter((device) => draft.selected.includes(device.id)).length }}
          台</span
        ><ElButton :disabled="creator.saving.value" @click="draft.selected = []">清除选择</ElButton
        ><ElButton
          type="primary"
          data-testid="start-run"
          :disabled="workDisabled || !draft.selected.length || creator.saving.value"
          @click="startSelected"
          >启动所选设备</ElButton
        >
      </div>
      <div class="business-actions mt-4">
        <ElButton :disabled="creator.saving.value" @click="creator.leave">关闭</ElButton>
      </div>
    </ElDrawer>
    <ElDrawer
      :model-value="!!detail"
      @close="detailId = undefined"
      title="任务详情"
      size="min(640px, 100%)"
      ><ElDescriptions v-if="detail" :column="1" border
        ><ElDescriptionsItem label="任务 ID">{{ detail.id }}</ElDescriptionsItem
        ><ElDescriptionsItem label="设备">#{{ detail.deviceId }}</ElDescriptionsItem
        ><ElDescriptionsItem label="状态">{{ stateLabels[detail.state] }}</ElDescriptionsItem
        ><ElDescriptionsItem label="设置"
          >版本 {{ detail.config.revision }} · {{ detail.config.pageCount }} 页 ·
          {{ detail.config.viewportWidth }} × {{ detail.config.viewportHeight }}</ElDescriptionsItem
        ><ElDescriptionsItem label="创建时间">{{ time(detail.createdAt) }}</ElDescriptionsItem
        ><ElDescriptionsItem label="更新时间">{{ time(detail.updatedAt) }}</ElDescriptionsItem
        ><ElDescriptionsItem label="结果">
          <pre class="whitespace-pre-wrap">{{
            detail.outcome === null ? '暂无结果' : JSON.stringify(detail.outcome, null, 2)
          }}</pre>
        </ElDescriptionsItem></ElDescriptions
      ></ElDrawer
    >
  </main>
</template>

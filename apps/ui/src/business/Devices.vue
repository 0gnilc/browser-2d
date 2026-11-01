<script setup lang="ts">
import type { Device } from '@browser-2d/contracts/public';
import { computed, onMounted, reactive, ref } from 'vue';
import {
  NButton,
  NPopconfirm,
  NCheckbox,
  NInput,
  NInputNumber,
  NForm,
  NTable,
  NTag,
} from 'naive-ui';
import { cancellable, useRunsStore } from '../runs';
import BusinessPage from './BusinessPage.vue';
import { fieldProps, nullableNumber, useBusinessRequest } from './request';

const { busy, error, request } = useBusinessRequest();
const rows = ref<Device[]>([]);
const store = useRunsStore();
const selected = ref<number[]>([]);
const workDisabled = computed(
  () => store.busy || store.batching || !!store.pending || store.connection !== 'connected',
);
const runLabels = {
  queued: '排队中',
  starting: '启动中',
  running: '运行中',
  stopping: '清理中',
  completed: '已完成',
  cancelled: '已取消',
  failed: '失败',
  interrupted: '已中断',
};
const activeRuns = computed(() => store.runs.filter((run) => cancellable(run.state)));
function select(id: number, checked: boolean) {
  selected.value = checked
    ? [...new Set([...selected.value, id])]
    : selected.value.filter((value) => value !== id);
}
const editing = ref<number | null>(null);
const form = reactive<Omit<Device, 'id' | 'createTime' | 'amount'> & { amount: string }>({
  symbol: '',
  account: null,
  amount: '',
  count: 0,
  status: 2,
  note: null,
});
function reset() {
  editing.value = null;
  Object.assign(form, { symbol: '', account: null, amount: '', count: 0, status: 2, note: null });
}
function edit(row: Device) {
  editing.value = row.id;
  Object.assign(form, {
    symbol: row.symbol,
    account: row.account,
    amount: row.amount === null ? '' : String(row.amount),
    count: row.count,
    status: row.status,
    note: row.note,
  });
}
async function load() {
  const value = await request((api) => api.devices.list());
  if (value) {
    rows.value = value;
    selected.value = selected.value.filter((id) => value.some((row) => row.id === id));
  }
}
async function save() {
  const input = { ...form, amount: nullableNumber(form.amount) };
  const value = await request((api) =>
    editing.value === null
      ? api.devices.create(input)
      : api.devices.update({ id: editing.value, ...input }),
  );
  if (value) {
    reset();
    await load();
  }
}
async function remove(id: number) {
  if (await request((api) => api.devices.delete({ id }))) {
    if (editing.value === id) reset();
    await load();
  }
}
onMounted(load);
</script>

<template>
  <BusinessPage title="设备" :error="error">
    <section class="task-panel">
      <h2>{{ editing === null ? '新增设备' : `编辑设备 #${editing}` }}</h2>
      <NForm class="business-form" data-testid="device-form" @submit.prevent="save">
        <label class="field"
          >设备标识<NInput
            v-model:value="form.symbol"
            :input-props="fieldProps('device-symbol', { required: true })"
            :maxlength="16384"
        /></label>
        <label class="field"
          >账户<NInput v-model:value="form.account" :input-props="fieldProps('device-account')"
        /></label>
        <label class="field"
          >金额，留空表示未设置<NInput
            v-model:value="form.amount"
            :input-props="fieldProps('device-amount')"
        /></label>
        <label class="field"
          >次数<NInputNumber
            :value="form.count"
            @update:value="form.count = $event ?? 0"
            :input-props="fieldProps('device-count', { required: true })"
        /></label>
        <label class="field"
          >状态<NInputNumber
            :value="form.status"
            @update:value="form.status = $event ?? 0"
            :input-props="fieldProps('device-status', { required: true })"
        /></label>
        <label class="field"
          >备注<NInput v-model:value="form.note" :input-props="fieldProps('device-note')"
        /></label>
        <div class="business-actions">
          <NButton type="primary" attr-type="submit" :disabled="busy" data-testid="device-save"
            >保存设备</NButton
          ><NButton :disabled="busy" @click="reset">取消编辑</NButton>
        </div>
      </NForm>
    </section>
    <section class="history-panel">
      <div class="business-toolbar">
        <h2>设备列表 · {{ rows.length }}</h2>
        <NButton
          type="primary"
          :disabled="workDisabled || !selected.length"
          data-testid="devices-start-selected"
          @click="store.startMany(selected)"
          >启动所选设备 ({{ selected.length }})</NButton
        >
        <NButton
          :disabled="workDisabled || !activeRuns.length"
          data-testid="devices-stop-all"
          @click="store.cancelMany(activeRuns.map((run) => run.id))"
          >停止全部活动任务 ({{ activeRuns.length }})</NButton
        >
        <NButton :disabled="busy" data-testid="devices-refresh" @click="load">刷新</NButton>
      </div>
      <div class="table-scroll">
        <NTable :bordered="false" :single-line="false" data-testid="devices-table">
          <thead>
            <tr>
              <th>选择</th>
              <th>设备 / 账户</th>
              <th>金额</th>
              <th>次数</th>
              <th>数据状态</th>
              <th>任务状态</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" :data-testid="`device-${row.id}`">
              <td>
                <NCheckbox
                  :checked="selected.includes(row.id)"
                  :aria-label="`选择设备 ${row.symbol}`"
                  :data-testid="`device-select-${row.id}`"
                  @update:checked="select(row.id, $event)"
                />
              </td>
              <td>{{ row.symbol }} / {{ row.account ?? '未设置' }}</td>
              <td>{{ row.amount ?? '未设置' }}</td>
              <td>{{ row.count }}</td>
              <td>{{ row.status }}</td>
              <td>
                <NTag
                  v-for="run in activeRuns.filter((run) => run.deviceId === row.id)"
                  :key="run.id"
                  size="small"
                  :bordered="false"
                  >{{ runLabels[run.state] }}</NTag
                ><span v-if="!activeRuns.some((run) => run.deviceId === row.id)" class="muted"
                  >无活动任务</span
                >
              </td>
              <td>{{ row.note ?? '未设置' }}</td>
              <td class="row-actions">
                <NButton
                  size="small"
                  :disabled="workDisabled || activeRuns.some((run) => run.deviceId === row.id)"
                  :data-testid="`device-start-${row.id}`"
                  @click="store.start(row.id)"
                  >启动任务</NButton
                >
                <NButton
                  v-for="run in activeRuns.filter((run) => run.deviceId === row.id)"
                  :key="run.id"
                  size="small"
                  :disabled="workDisabled"
                  :data-testid="`device-stop-${row.id}`"
                  @click="store.cancel(run.id)"
                  >取消任务</NButton
                >
                <NButton
                  size="small"
                  :disabled="busy"
                  :data-testid="`device-edit-${row.id}`"
                  @click="edit(row)"
                  >编辑</NButton
                ><NPopconfirm
                  positive-text="确认"
                  negative-text="取消"
                  @positive-click="remove(row.id)"
                  ><template #trigger
                    ><NButton size="small" :disabled="busy" :data-testid="`device-delete-${row.id}`"
                      >删除</NButton
                    ></template
                  >删除此设备？</NPopconfirm
                >
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="8" class="empty-state">暂无设备</td>
            </tr>
          </tbody>
        </NTable>
      </div>
    </section>
  </BusinessPage>
</template>

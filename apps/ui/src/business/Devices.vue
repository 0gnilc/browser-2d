<script setup lang="ts">
import type { Device } from '@browser-2d/contracts/public';
import { computed, onMounted, reactive, ref } from 'vue';
import {
  ElAlert,
  ElButton,
  ElPopconfirm,
  ElCheckbox,
  ElInput,
  ElInputNumber,
  ElTag,
  ElTable,
  ElTableColumn,
  ElDrawer,
  ElSelect,
  ElPopover,
  ElRadioGroup,
  ElRadioButton,
} from 'element-plus';
import { cancellable, deviceUnavailable, useRunsStore } from '../runs';
import BusinessPage from './BusinessPage.vue';
import { fieldProps, nullableNumber, useBusinessRequest } from './request';
import { useEditor } from './useEditor';

const { busy, error, request } = useBusinessRequest();
const rows = ref<Device[]>([]);
const store = useRunsStore();
const selected = ref<number[]>([]);
const search = ref('');
const view = ref('all');
const density = ref<'default' | 'small' | 'large'>('default');
const fields = ref(['account', 'amount', 'count', 'status', 'note']);
type Draft = Omit<Device, 'id' | 'createTime' | 'amount'> & { amount: string };
function emptyForm(): Draft {
  return { symbol: '', account: null, amount: '', count: 0, status: 2, note: null };
}
const editor = useEditor<Device, Draft>();
const editing = computed(() =>
  editor.session.value.kind === 'edit' ? editor.session.value.original.id : null,
);
const form = computed(() =>
  editor.session.value.kind === 'closed' ? emptyForm() : editor.session.value.draft,
);
const workDisabled = computed(
  () => store.busy || store.batching || !!store.pending || store.connection !== 'connected',
);
const activeRuns = computed(() => store.runs.filter((run) => cancellable(run.state)));
const filtered = computed(() =>
  rows.value.filter(
    (row) =>
      `${row.symbol} ${row.account ?? ''} ${row.note ?? ''} ${row.id}`
        .toLocaleLowerCase()
        .includes(search.value.toLocaleLowerCase()) &&
      (view.value === 'all' || (view.value === 'available' ? !blocked(row.id) : blocked(row.id))),
  ),
);
const visibleSelected = computed(
  () => filtered.value.filter((row) => selected.value.includes(row.id)).length,
);
const eligibleVisible = computed(() => filtered.value.filter((row) => !blocked(row.id)));
function selectVisible(checked: boolean) {
  const ids = eligibleVisible.value.map((row) => row.id);
  selected.value = checked
    ? [...new Set([...selected.value, ...ids])]
    : selected.value.filter((id) => !ids.includes(id));
}
function blocked(id: number) {
  return deviceUnavailable(store.snapshot, id);
}
async function create() {
  await editor.replace({ kind: 'create', draft: reactive(emptyForm()) });
}
async function edit(id: number) {
  const row = rows.value.find((value) => value.id === id);
  if (!row) return;
  if (busy.value || blocked(row.id)) return;
  await editor.replace({
    kind: 'edit',
    original: row,
    draft: reactive({
      symbol: row.symbol,
      account: row.account,
      amount: row.amount === null ? '' : String(row.amount),
      count: row.count,
      status: row.status,
      note: row.note,
    }),
  });
}
async function load() {
  if (busy.value) return;
  const value = await request((api) => api.devices.list());
  if (value) {
    rows.value = value;
    selected.value = selected.value.filter((id) => value.some((row) => row.id === id));
  }
}
async function save() {
  if (busy.value) return;
  await editor.save(async (current) => {
    if (current.kind === 'edit' && blocked(current.original.id)) {
      error.value = '设备有活动任务或待清理资源，暂不可编辑。';
      return false;
    }
    const input = { ...current.draft, amount: nullableNumber(current.draft.amount) };
    const value = await request((api) =>
      current.kind === 'create'
        ? api.devices.create(input)
        : api.devices.update({ id: current.original.id, ...input }),
    );
    if (!value) return false;
    await load();
    return true;
  });
}
async function remove(id: number) {
  if (busy.value || blocked(id)) return;
  if (editing.value === id && !(await editor.leave())) return;
  if (blocked(id)) return;
  if (await request((api) => api.devices.delete({ id }))) await load();
}
async function startSelected() {
  if (workDisabled.value) return;
  await store.startMany(selected.value.filter((id) => rows.value.some((row) => row.id === id)));
}
onMounted(load);
</script>

<template>
  <BusinessPage title="设备" :error="error">
    <p class="business-note">
      管理设备数据，选择设备后启动本地验证。活动任务与待清理资源会锁定设备。
    </p>
    <div class="business-toolbar">
      <ElRadioGroup v-model="view" aria-label="设备视图"
        ><ElRadioButton value="all">全部设备 {{ rows.length }}</ElRadioButton
        ><ElRadioButton value="available">可用</ElRadioButton
        ><ElRadioButton value="occupied">占用中</ElRadioButton></ElRadioGroup
      >
      <ElButton type="primary" data-testid="device-new" @click="create">新增设备</ElButton>
    </div>
    <div class="business-toolbar">
      <ElInput
        v-model="search"
        clearable
        placeholder="搜索设备、账户或备注"
        aria-label="搜索设备"
        data-testid="device-search"
        class="workspace-search"
      />
      <ElPopover trigger="click" width="220"
        ><template #reference><ElButton>显示字段</ElButton></template>
        <div class="flex flex-col gap-2">
          <ElCheckbox
            v-for="field in [
              { key: 'account', label: '账户' },
              { key: 'amount', label: '金额' },
              { key: 'count', label: '次数' },
              { key: 'status', label: '数据状态' },
              { key: 'note', label: '备注' },
            ]"
            :key="field.key"
            :model-value="fields.includes(field.key)"
            @update:model-value="
              fields = $event ? [...fields, field.key] : fields.filter((key) => key !== field.key)
            "
            >{{ field.label }}</ElCheckbox
          >
        </div></ElPopover
      >
      <ElSelect
        v-model="density"
        aria-label="表格密度"
        class="density-select"
        :options="[
          { label: '标准', value: 'default' },
          { label: '紧凑', value: 'small' },
          { label: '宽松', value: 'large' },
        ]"
      />
      <ElButton :disabled="busy" data-testid="devices-refresh" @click="load">刷新</ElButton>
    </div>
    <div class="business-toolbar">
      <span>已选 {{ selected.length }} 台，当前视图 {{ visibleSelected }} 台</span
      ><ElButton :disabled="!selected.length" @click="selected = []">清除选择</ElButton>
      <ElButton
        type="primary"
        :disabled="workDisabled || !selected.some((id) => !blocked(id))"
        data-testid="devices-start-selected"
        @click="startSelected"
        >启动所选设备 ({{ selected.length }})</ElButton
      >
      <ElButton
        :disabled="workDisabled || !activeRuns.length"
        data-testid="devices-stop-all"
        @click="store.cancelMany(activeRuns.map((run) => run.id))"
        >停止全部活动任务 ({{ activeRuns.length }})</ElButton
      >
    </div>
    <ElTable
      :data="filtered"
      border
      row-key="id"
      :size="density"
      data-testid="devices-table"
      empty-text="暂无匹配设备"
    >
      <ElTableColumn width="60" label="选择"
        ><template #header
          ><ElCheckbox
            aria-label="选择当前视图可用设备"
            :model-value="
              !!eligibleVisible.length && eligibleVisible.every((row) => selected.includes(row.id))
            "
            :indeterminate="
              eligibleVisible.some((row) => selected.includes(row.id)) &&
              !eligibleVisible.every((row) => selected.includes(row.id))
            "
            :disabled="!eligibleVisible.length"
            @update:model-value="selectVisible($event === true)" /></template
        ><template #default="{ row }"
          ><ElCheckbox
            :disabled="blocked(row.id)"
            :model-value="selected.includes(row.id)"
            :aria-label="`选择设备 ${row.symbol}`"
            :data-testid="`device-select-${row.id}`"
            @update:model-value="
              selected = $event
                ? [...new Set([...selected, row.id])]
                : selected.filter((id) => id !== row.id)
            " /></template
      ></ElTableColumn>
      <ElTableColumn prop="symbol" label="设备" min-width="160" sortable
        ><template #default="{ row }"
          ><span :data-testid="`device-${row.id}`">{{ row.symbol }}</span></template
        ></ElTableColumn
      >
      <ElTableColumn
        v-if="fields.includes('account')"
        prop="account"
        label="账户"
        min-width="130"
      />
      <ElTableColumn
        v-if="fields.includes('amount')"
        prop="amount"
        label="金额"
        min-width="100"
        sortable
        ><template #default="{ row }">{{ row.amount ?? '未设置' }}</template></ElTableColumn
      >
      <ElTableColumn
        v-if="fields.includes('count')"
        prop="count"
        label="次数"
        width="90"
        sortable
      />
      <ElTableColumn v-if="fields.includes('status')" prop="status" label="数据状态" width="110" />
      <ElTableColumn label="任务状态" min-width="150"
        ><template #default="{ row }"
          ><ElTag :type="blocked(row.id) ? 'warning' : 'info'">{{
            blocked(row.id) ? '任务 / 资源占用中' : '无活动任务'
          }}</ElTag></template
        ></ElTableColumn
      >
      <ElTableColumn v-if="fields.includes('note')" prop="note" label="备注" min-width="150" />
      <ElTableColumn label="操作" width="300" fixed="right"
        ><template #default="{ row }"
          ><div class="flex flex-wrap gap-2">
            <ElButton
              :disabled="workDisabled || blocked(row.id)"
              :data-testid="`device-start-${row.id}`"
              @click="store.start(row.id)"
              >启动任务</ElButton
            >
            <ElButton
              v-for="run in activeRuns.filter((run) => run.deviceId === row.id)"
              :key="run.id"
              :disabled="workDisabled"
              :data-testid="`device-stop-${row.id}`"
              @click="store.cancel(run.id)"
              >取消任务</ElButton
            >
            <ElButton
              :disabled="busy || blocked(row.id)"
              :data-testid="`device-edit-${row.id}`"
              @click="edit(row.id)"
              >编辑</ElButton
            >
            <ElPopconfirm
              title="删除此设备？"
              confirm-button-text="确认"
              cancel-button-text="取消"
              @confirm="remove(row.id)"
              ><template #reference
                ><ElButton
                  :disabled="busy || blocked(row.id)"
                  :data-testid="`device-delete-${row.id}`"
                  >删除</ElButton
                ></template
              ></ElPopconfirm
            >
          </div></template
        ></ElTableColumn
      >
    </ElTable>
    <ElDrawer
      :model-value="editor.session.value.kind !== 'closed'"
      :before-close="editor.beforeClose"
      :title="editing === null ? '新增设备' : `编辑设备 #${editing}`"
      size="min(560px, 100%)"
      destroy-on-close
    >
      <ElTag v-if="editor.dirty.value" type="warning">未保存</ElTag>
      <ElAlert v-if="error" :title="error" type="error" :closable="false" role="alert" />
      <form class="drawer-form" data-testid="device-form" @submit.prevent="save">
        <label class="field"
          >设备标识<ElInput
            :disabled="editor.saving.value || editor.deciding.value"
            v-model="form.symbol"
            v-bind="fieldProps('device-symbol', { required: true })"
            :maxlength="16384"
        /></label>
        <label class="field"
          >账户<ElInput
            :disabled="editor.saving.value || editor.deciding.value"
            :model-value="form.account ?? ''"
            @update:model-value="form.account = $event"
            v-bind="fieldProps('device-account')"
        /></label>
        <label class="field"
          >金额<ElInput
            :disabled="editor.saving.value || editor.deciding.value"
            placeholder="未设置"
            v-model="form.amount"
            v-bind="fieldProps('device-amount')"
        /></label>
        <label class="field" for="device-count"
          >次数<ElInputNumber
            :disabled="editor.saving.value || editor.deciding.value"
            id="device-count"
            :model-value="form.count"
            @update:model-value="form.count = $event ?? 0"
            v-bind="fieldProps('device-count', { required: true })"
        /></label>
        <label class="field" for="device-status"
          >状态<ElInputNumber
            :disabled="editor.saving.value || editor.deciding.value"
            id="device-status"
            :model-value="form.status"
            @update:model-value="form.status = $event ?? 0"
            v-bind="fieldProps('device-status', { required: true })"
        /></label>
        <label class="field"
          >备注<ElInput
            :disabled="editor.saving.value || editor.deciding.value"
            :model-value="form.note ?? ''"
            @update:model-value="form.note = $event"
            v-bind="fieldProps('device-note')"
        /></label>
        <div class="business-actions">
          <ElButton
            type="primary"
            native-type="submit"
            :disabled="busy || editor.saving.value"
            data-testid="device-save"
            >保存设备</ElButton
          ><ElButton :disabled="busy || editor.saving.value" @click="editor.leave"
            >取消编辑</ElButton
          >
        </div>
      </form>
    </ElDrawer>
  </BusinessPage>
</template>

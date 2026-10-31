<script setup lang="ts">
import type { Device } from '@browser-2d/contracts/public';
import { onMounted, reactive, ref } from 'vue';
import { NButton, NPopconfirm } from 'naive-ui';
import BusinessPage from './BusinessPage.vue';
import { nullableNumber, useBusinessRequest } from './request';

const { busy, error, request } = useBusinessRequest();
const rows = ref<Device[]>([]);
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
  if (value) rows.value = value;
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
      <form class="business-form" data-testid="device-form" @submit.prevent="save">
        <label class="field"
          >设备标识<input
            v-model="form.symbol"
            data-testid="device-symbol"
            required
            maxlength="16384"
        /></label>
        <label class="field"
          >账户<input v-model="form.account" data-testid="device-account"
        /></label>
        <label class="field"
          >金额，留空表示未设置<input
            v-model="form.amount"
            data-testid="device-amount"
            type="number"
            step="any"
        /></label>
        <label class="field"
          >次数<input
            v-model.number="form.count"
            data-testid="device-count"
            type="number"
            step="1"
            required
        /></label>
        <label class="field"
          >状态<input
            v-model.number="form.status"
            data-testid="device-status"
            type="number"
            step="1"
            required
        /></label>
        <label class="field">备注<input v-model="form.note" data-testid="device-note" /></label>
        <div class="business-actions">
          <NButton type="primary" attr-type="submit" :disabled="busy" data-testid="device-save"
            >保存设备</NButton
          ><NButton :disabled="busy" @click="reset">取消编辑</NButton>
        </div>
      </form>
    </section>
    <section class="history-panel">
      <div class="business-toolbar">
        <h2>设备列表 · {{ rows.length }}</h2>
        <NButton :disabled="busy" data-testid="devices-refresh" @click="load">刷新</NButton>
      </div>
      <div class="table-scroll">
        <table data-testid="devices-table">
          <thead>
            <tr>
              <th>设备 / 账户</th>
              <th>金额</th>
              <th>次数</th>
              <th>状态</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" :data-testid="`device-${row.id}`">
              <td>{{ row.symbol }} / {{ row.account ?? '未设置' }}</td>
              <td>{{ row.amount ?? '未设置' }}</td>
              <td>{{ row.count }}</td>
              <td>{{ row.status }}</td>
              <td>{{ row.note ?? '未设置' }}</td>
              <td class="row-actions">
                <NButton
                  size="small"
                  :disabled="busy"
                  :data-testid="`device-edit-${row.id}`"
                  @click="edit(row)"
                  >编辑</NButton
                ><NPopconfirm @positive-click="remove(row.id)"
                  ><template #trigger
                    ><NButton size="small" :disabled="busy" :data-testid="`device-delete-${row.id}`"
                      >删除</NButton
                    ></template
                  >删除此设备？</NPopconfirm
                >
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="6" class="empty-state">暂无设备</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </BusinessPage>
</template>

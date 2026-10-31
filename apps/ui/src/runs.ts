import {
  cancelResultSchema,
  commandLookupResultSchema,
  startResultSchema,
  workSnapshotResultSchema,
  workStateSchema,
  type Browser2dApi,
  type CancelInput,
  type CommandResult,
  type StartInput,
  type WorkSnapshot,
  type WorkState,
} from '@browser-2d/contracts/public';
import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';

type BatchItem = {
  command: PendingCommand;
  label: string;
  status: 'not-sent' | 'sending' | 'accepted' | 'rejected' | 'unknown';
  message: string;
};

export function cancellable(state: string) {
  return ['queued', 'starting', 'running', 'stopping'].includes(state);
}

type PendingCommand = { kind: 'start'; input: StartInput } | { kind: 'cancel'; input: CancelInput };

export const useRunsStore = defineStore('runs', () => {
  const snapshot = shallowRef<WorkSnapshot>();
  const connection = ref<'connecting' | 'connected' | 'unavailable'>('connecting');
  const error = ref('');
  const notice = ref('');
  const busy = ref(false);
  const pending = shallowRef<PendingCommand>();
  const batch = shallowRef<BatchItem[]>([]);
  const batching = ref(false);
  const runs = computed(() => snapshot.value?.runs ?? []);
  let api: Browser2dApi | undefined;
  let session = 0;
  let updates = 0;
  let workGeneration = -1;
  let unavailableGeneration = -1;
  const retiredEpochs = new Set<string>();

  function accept(value: WorkSnapshot) {
    if (retiredEpochs.has(value.epoch)) return;
    const current = snapshot.value;
    if (current?.epoch === value.epoch && current.revision > value.revision) return;
    if (current && current.epoch !== value.epoch) retiredEpochs.add(current.epoch);
    snapshot.value = value;
    connection.value = 'connected';
    updates++;
  }

  function unavailable(message: string) {
    unavailableGeneration = Math.max(unavailableGeneration, workGeneration);
    connection.value = 'unavailable';
    error.value = message;
    updates++;
  }

  function reject(reason: unknown) {
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'object' &&
            reason !== null &&
            'message' in reason &&
            typeof reason.message === 'string'
          ? reason.message
          : '请求失败，请重试。';
    error.value = message;
    if (
      typeof reason === 'object' &&
      reason !== null &&
      'code' in reason &&
      reason.code === 'UNAVAILABLE'
    )
      unavailable(message);
  }

  function observe(state: WorkState) {
    if (state.generation < workGeneration) return;
    workGeneration = state.generation;
    if (state.status === 'unavailable') {
      unavailable(state.reason);
      return;
    }
    if (state.generation <= unavailableGeneration) return;
    accept(state.snapshot);
  }

  async function refresh() {
    if (!api) return;
    const currentSession = session;
    const before = updates;
    try {
      const result = workSnapshotResultSchema.parse(await api.work.getSnapshot());
      if (currentSession !== session || before !== updates) return;
      if (result.ok) {
        if (connection.value !== 'unavailable') accept(result.value);
      } else reject(result.error);
    } catch (reason) {
      if (currentSession === session && before === updates) reject(reason);
    }
  }

  function connect(bridge: Browser2dApi | undefined) {
    abandonDispatch();
    const currentSession = ++session;
    api = bridge;
    connection.value = 'connecting';
    busy.value = false;
    error.value = '';
    workGeneration = -1;
    unavailableGeneration = -1;
    snapshot.value = undefined;
    retiredEpochs.clear();
    if (!bridge) {
      unavailable('桌面连接不可用，请在桌面应用中打开。');
      return () => {};
    }
    let dispose = () => {};
    try {
      dispose = bridge.work.subscribe((value) => {
        if (currentSession !== session) return;
        const parsed = workStateSchema.safeParse(value);
        if (parsed.success) observe(parsed.data);
        else unavailable('工作进程状态格式无效。');
      });
      void refresh();
    } catch (reason) {
      unavailable(reason instanceof Error ? reason.message : '无法订阅工作进程。');
    }
    return () => {
      if (currentSession === session) {
        session++;
        api = undefined;
        abandonDispatch();
      }
      dispose();
    };
  }

  function abandonDispatch() {
    busy.value = false;
    batching.value = false;
    batch.value = batch.value.map((item) =>
      item.status === 'sending'
        ? { ...item, status: 'unknown', message: '连接已断开，请查询或使用原指令重试。' }
        : item.status === 'not-sent'
          ? { ...item, message: '连接已断开，此项未发送。' }
          : item,
    );
  }

  function updateBatch(commandId: string, status: BatchItem['status'], message: string) {
    batch.value = batch.value.map((item) =>
      item.command.input.commandId === commandId ? { ...item, status, message } : item,
    );
  }

  function received(result: CommandResult) {
    if (result.ok) {
      const command = pending.value;
      if (
        command &&
        (result.value.commandId !== command.input.commandId ||
          result.value.kind !== command.kind ||
          (command.kind === 'cancel' && result.value.runId !== command.input.runId))
      ) {
        error.value = '指令回执与原指令不匹配。请查询原指令。';
        updateBatch(command.input.commandId, 'unknown', error.value);
        return;
      }
      if (command)
        updateBatch(
          command.input.commandId,
          'accepted',
          `任务 ${result.value.runId}，指令已受理。`,
        );
      pending.value = undefined;
      notice.value =
        result.value.kind === 'start'
          ? `启动指令已受理，任务 ${result.value.runId}。受理不代表执行完成。`
          : `取消指令已受理，任务 ${result.value.runId}。请等待资源清理与最终状态。`;
      return;
    }
    if (pending.value)
      updateBatch(
        pending.value.input.commandId,
        result.error.code === 'UNAVAILABLE' || result.error.code === 'INTERNAL'
          ? 'unknown'
          : 'rejected',
        `${result.error.code} · ${result.error.message}`,
      );
    if (result.error.code !== 'UNAVAILABLE' && result.error.code !== 'INTERNAL') {
      pending.value = undefined;
    }
    reject(result.error);
  }

  async function send(command: PendingCommand) {
    if (!api || busy.value) return;
    const currentSession = session;
    const bridge = api;
    busy.value = true;
    error.value = '';
    notice.value = '';
    pending.value = command;
    updateBatch(command.input.commandId, 'sending', '正在发送指令。');
    try {
      const result =
        command.kind === 'start'
          ? startResultSchema.parse(await bridge.work.start(command.input))
          : cancelResultSchema.parse(await bridge.work.cancel(command.input));
      if (currentSession !== session) return;
      received(result);
      await refresh();
    } catch (reason) {
      if (currentSession === session) {
        reject(reason);
        updateBatch(command.input.commandId, 'unknown', error.value);
      }
    } finally {
      if (currentSession === session) busy.value = false;
    }
  }

  async function queryCommand() {
    if (!api || !pending.value || busy.value) return;
    const command = pending.value;
    const currentSession = session;
    busy.value = true;
    error.value = '';
    try {
      const result = commandLookupResultSchema.parse(
        await api.work.getCommand({ commandId: command.input.commandId }),
      );
      if (currentSession !== session) return;
      if (!result.ok) reject(result.error);
      else if (result.value.status === 'recorded') {
        received(result.value.receipt);
        await refresh();
      } else notice.value = '尚未查到该指令。可使用相同指令 ID 重试，不会自动创建第二个任务。';
    } catch (reason) {
      if (currentSession === session) reject(reason);
    } finally {
      if (currentSession === session) busy.value = false;
    }
  }

  function start(deviceId: number) {
    if (pending.value || batching.value || connection.value !== 'connected') return;
    return send({ kind: 'start', input: { commandId: crypto.randomUUID(), deviceId } });
  }

  function cancel(runId: string) {
    if (pending.value || batching.value || connection.value !== 'connected') return;
    return send({ kind: 'cancel', input: { commandId: crypto.randomUUID(), runId } });
  }

  async function sendBatch(commands: { command: PendingCommand; label: string }[]) {
    if (busy.value || pending.value || batching.value || connection.value !== 'connected') return;
    const currentSession = session;
    batch.value = commands.map((item) => ({ ...item, status: 'not-sent', message: '尚未发送。' }));
    batching.value = true;
    try {
      for (const item of batch.value) {
        if (currentSession !== session || pending.value || connection.value !== 'connected') break;
        await send(item.command);
      }
    } finally {
      if (currentSession === session) {
        batch.value = batch.value.map((item) =>
          item.status === 'not-sent' ? { ...item, message: '批量操作已停止，此项未发送。' } : item,
        );
        batching.value = false;
      }
    }
  }

  function startMany(deviceIds: number[]) {
    return sendBatch(
      [...new Set(deviceIds)].map((deviceId) => ({
        label: `设备 #${deviceId}`,
        command: { kind: 'start', input: { commandId: crypto.randomUUID(), deviceId } },
      })),
    );
  }

  function cancelMany(runIds: string[]) {
    return sendBatch(
      [...new Set(runIds)].map((runId) => ({
        label: `任务 ${runId}`,
        command: { kind: 'cancel', input: { commandId: crypto.randomUUID(), runId } },
      })),
    );
  }

  function retryCommand() {
    if (pending.value && connection.value === 'connected') return send(pending.value);
  }

  return {
    snapshot,
    connection,
    error,
    notice,
    busy,
    pending,
    batch,
    batching,
    startMany,
    cancelMany,
    runs,
    connect,
    refresh,
    start,
    cancel,
    queryCommand,
    retryCommand,
  };
});

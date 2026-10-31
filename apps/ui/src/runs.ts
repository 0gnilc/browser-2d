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

type PendingCommand = { kind: 'start'; input: StartInput } | { kind: 'cancel'; input: CancelInput };

export const useRunsStore = defineStore('runs', () => {
  const snapshot = shallowRef<WorkSnapshot>();
  const connection = ref<'connecting' | 'connected' | 'unavailable'>('connecting');
  const error = ref('');
  const notice = ref('');
  const busy = ref(false);
  const pending = shallowRef<PendingCommand>();
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
      }
      dispose();
    };
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
        return;
      }
      pending.value = undefined;
      notice.value =
        result.value.kind === 'start'
          ? `启动指令已受理，任务 ${result.value.runId}。受理不代表执行完成。`
          : `取消指令已受理，任务 ${result.value.runId}。请等待资源清理与最终状态。`;
      return;
    }
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
    try {
      const result =
        command.kind === 'start'
          ? startResultSchema.parse(await bridge.work.start(command.input))
          : cancelResultSchema.parse(await bridge.work.cancel(command.input));
      if (currentSession !== session) return;
      received(result);
      await refresh();
    } catch (reason) {
      if (currentSession === session) reject(reason);
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
    if (pending.value || connection.value !== 'connected') return;
    return send({ kind: 'start', input: { commandId: crypto.randomUUID(), deviceId } });
  }

  function cancel(runId: string) {
    if (pending.value || connection.value !== 'connected') return;
    return send({ kind: 'cancel', input: { commandId: crypto.randomUUID(), runId } });
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
    runs,
    connect,
    refresh,
    start,
    cancel,
    queryCommand,
    retryCommand,
  };
});

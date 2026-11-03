import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import type { Browser, Browser2dApi, BrowserId, WorkTask } from '@browser-2d/contracts/public';

export const browserStatusLabels: Record<Browser['status'], string> = {
  idle: '空闲',
  queued: '排队中',
  starting: '启动中',
  working: '工作中',
  stopping: '停止中',
  failed: '失败',
  recovery_required: '待恢复',
};

type PendingControl = { action: 'start' | 'stop'; phase: 'requesting' | 'unconfirmed' };

export const useWorkTasksStore = defineStore('work-tasks', () => {
  const browsers = shallowRef<Browser[]>([]);
  const tasks = shallowRef<WorkTask[]>([]);
  const pending = ref(new Map<BrowserId, PendingControl>());
  const loading = ref(false);
  const error = ref('');
  const controlError = ref('');
  const connection = ref<'connecting' | 'connected' | 'unavailable'>('connecting');
  const activeBrowsers = computed(() => new Set(tasks.value.map((task) => task.browserId)));
  let source: Browser2dApi | undefined;
  let disconnect = () => {};
  let epoch = 0;
  let generation = 0;
  let running: Promise<void> | undefined;

  async function pump(api: Browser2dApi, sourceEpoch: number) {
    loading.value = true;
    while (sourceEpoch === epoch) {
      const current = generation;
      try {
        const [browserResult, taskResult] = await Promise.all([
          api.browsers.list(),
          api.workTasks.list(),
        ]);
        if (sourceEpoch !== epoch) return;
        if (current !== generation) continue;
        if (browserResult.ok && taskResult.ok) {
          browsers.value = browserResult.value;
          tasks.value = taskResult.value;
          for (const [browserId, control] of pending.value) {
            if (control.phase === 'unconfirmed') pending.value.delete(browserId);
          }
          connection.value = 'connected';
          error.value = '';
        } else {
          connection.value = 'unavailable';
          error.value = !browserResult.ok
            ? browserResult.error.message
            : !taskResult.ok
              ? taskResult.error.message
              : '';
        }
      } catch {
        if (sourceEpoch !== epoch) return;
        if (current !== generation) continue;
        connection.value = 'unavailable';
        error.value = '桌面连接不可用。请重新连接后刷新。';
      }
      break;
    }
    if (sourceEpoch === epoch) {
      loading.value = false;
      running = undefined;
    }
  }
  function refresh() {
    if (!source) return Promise.resolve();
    generation += 1;
    running ??= pump(source, epoch);
    return running;
  }
  function connect(api: Browser2dApi) {
    disconnect();
    const sourceEpoch = ++epoch;
    source = api;
    browsers.value = [];
    tasks.value = [];
    pending.value.clear();
    controlError.value = '';
    connection.value = 'connecting';
    running = undefined;
    disconnect = api.workTasks.subscribe(() => {
      void refresh();
    });
    void refresh();
    return () => {
      if (sourceEpoch !== epoch) return;
      disconnect();
      epoch += 1;
      source = undefined;
      running = undefined;
      loading.value = false;
      connection.value = 'unavailable';
    };
  }
  function busy(browser: Browser) {
    return (
      pending.value.has(browser.id) ||
      activeBrowsers.value.has(browser.id) ||
      !['idle', 'failed'].includes(browser.status)
    );
  }
  function label(browser: Browser) {
    const control = pending.value.get(browser.id);
    if (control?.phase === 'unconfirmed') return '工作状态待确认';
    return control?.action === 'stop'
      ? '停止中'
      : control?.action === 'start'
        ? '正在请求启动'
        : browserStatusLabels[browser.status];
  }
  function requesting(browserId: BrowserId) {
    return pending.value.get(browserId)?.phase === 'requesting';
  }
  async function control(browserId: BrowserId, action: 'start' | 'stop') {
    const api = source;
    const previous = pending.value.get(browserId);
    if (!api || previous?.phase === 'requesting' || (previous && action === 'start')) return;
    const sourceEpoch = epoch;
    generation += 1;
    pending.value.set(browserId, { action, phase: 'requesting' });
    controlError.value = '';
    try {
      const result = await api.workTasks[action]({ browserId });
      if (sourceEpoch !== epoch) return;
      if (result.ok || result.error.code === 'UNAVAILABLE' || result.error.code === 'INTERNAL') {
        pending.value.set(browserId, { action, phase: 'unconfirmed' });
      } else if (previous) {
        pending.value.set(browserId, previous);
      } else {
        pending.value.delete(browserId);
      }
      if (!result.ok) controlError.value = result.error.message;
    } catch {
      if (sourceEpoch === epoch) {
        controlError.value = '连接中断，工作状态尚未确认。请刷新核对。';
        pending.value.set(browserId, { action, phase: 'unconfirmed' });
      }
    }
    if (sourceEpoch === epoch) await refresh();
  }
  return {
    browsers,
    tasks,
    pending,
    loading,
    error,
    controlError,
    connection,
    connect,
    refresh,
    busy,
    label,
    requesting,
    control,
  };
});

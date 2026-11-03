import { onBeforeUnmount, ref, shallowRef } from 'vue';
import { failure, type Failure, type Result } from '@browser-2d/contracts/public';
import { useDesktopApi } from '../platform/desktop-api';

export function useDesktopRequest() {
  const api = useDesktopApi();
  const busy = ref(false);
  const error = ref('');
  const reason = ref<Failure['error']['reason']>();
  let disposed = false;
  onBeforeUnmount(() => {
    disposed = true;
  });
  async function request<T>(call: () => Promise<Result<T>>): Promise<Result<T>> {
    busy.value = true;
    error.value = '';
    reason.value = undefined;
    let result: Result<T>;
    try {
      result = await call();
    } catch {
      result = failure('UNAVAILABLE', '连接中断，操作结果尚未确认。请刷新核对后重试。');
    }
    if (!disposed) {
      busy.value = false;
      if (!result.ok) {
        error.value = result.error.message;
        reason.value = result.error.reason;
      }
    }
    return result;
  }
  return { api, busy, error, reason, request };
}

export function useLatestRefresh<T>(load: () => Promise<Result<T>>) {
  const data = shallowRef<T>();
  const loading = ref(false);
  const error = ref('');
  let generation = 0;
  let running: Promise<void> | undefined;
  let disposed = false;
  async function pump() {
    loading.value = true;
    while (!disposed) {
      const current = generation;
      let result: Result<T>;
      try {
        result = await load();
      } catch {
        result = failure('UNAVAILABLE', '连接不可用。请重新连接后刷新。');
      }
      if (disposed) break;
      if (current !== generation) continue;
      if (result.ok) {
        data.value = result.value;
        error.value = '';
      } else error.value = result.error.message;
      break;
    }
    if (!disposed) loading.value = false;
    running = undefined;
  }
  function refresh() {
    generation += 1;
    running ??= pump();
    return running;
  }
  onBeforeUnmount(() => {
    disposed = true;
    generation += 1;
  });
  return { data, loading, error, refresh };
}

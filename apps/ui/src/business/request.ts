import type { Browser2dApi, Result } from '@browser-2d/contracts/public';
import { inject, ref } from 'vue';
import { bridgeKey } from '../bridge';

export function useBusinessRequest() {
  const api = inject(bridgeKey);
  const busy = ref(false);
  const error = ref('');
  async function request<T>(call: (api: Browser2dApi) => Promise<Result<T>>) {
    error.value = '';
    if (!api) {
      error.value = '桌面业务 API 不可用。请在桌面应用中打开此页面。';
      return;
    }
    busy.value = true;
    try {
      const result = await call(api);
      if (result.ok) return result.value;
      error.value = `${result.error.code} · ${result.error.message}`;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '请求失败，请刷新后重试。';
    } finally {
      busy.value = false;
    }
  }
  return { busy, error, request };
}

export function nullableNumber(value: string) {
  return value === '' ? null : Number(value);
}

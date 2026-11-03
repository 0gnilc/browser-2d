import type { Browser2dApi } from '@browser-2d/contracts/public';
import { inject, type InjectionKey } from 'vue';
import { unavailableApi } from './unavailable-api';

export const desktopApiKey: InjectionKey<Browser2dApi> = Symbol('browser2d');

export function useDesktopApi() {
  return inject(desktopApiKey, unavailableApi);
}

import type { Browser2dApi } from '@browser-2d/contracts/public';
import type { InjectionKey } from 'vue';

export const bridgeKey: InjectionKey<Browser2dApi | undefined> = Symbol('browser2d');

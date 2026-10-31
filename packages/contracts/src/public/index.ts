import type { BusinessApi } from './business';
import type { WorkApi } from './work';
export * from './result';
export * from './business';
export * from './work';

export interface Browser2dApi extends BusinessApi {
  work: WorkApi;
}

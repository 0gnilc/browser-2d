import {
  failure,
  updateStateSchema,
  type UpdateState,
  type UpdatesApi,
} from '@browser-2d/contracts/public';
import { releaseConfigSchema } from '@browser-2d/contracts/host';
import type { ApplicationLifecycle } from './lifecycle';

export interface UpdateDriver {
  check(): Promise<{ version: string } | null>;
  download(): Promise<void>;
  install(): void;
  onProgress(listener: (percent: number) => void): void;
  onError(listener: () => void): void;
}
type EnabledState = Exclude<UpdateState, { status: 'unavailable' }>;
type StateBody<T = EnabledState> = T extends EnabledState
  ? Omit<T, 'revision' | 'currentVersion' | 'channel'>
  : never;
export type UpdatePolicy =
  | { enabled: false; reason: Extract<UpdateState, { status: 'unavailable' }>['reason'] }
  | { enabled: true; channel: 'stable' | 'test'; feedUrl: string };

export function updatePolicy(options: {
  packaged: boolean;
  config: unknown;
  platform: string;
  arch: string;
  appImage: boolean;
  packageType?: string;
}): UpdatePolicy {
  if (!options.packaged) return { enabled: false, reason: 'development' };
  if (options.platform === 'linux' && (!options.appImage || options.packageType !== undefined))
    return { enabled: false, reason: 'package-manager' };
  const parsed = releaseConfigSchema.safeParse(options.config);
  if (!parsed.success || parsed.data.mode !== 'production')
    return { enabled: false, reason: 'unconfigured' };
  const config = parsed.data;
  const target = `${options.platform === 'darwin' ? 'mac' : options.platform === 'win32' ? 'win' : options.platform}-${options.arch}`;
  if (config.target !== target) return { enabled: false, reason: 'unconfigured' };
  return {
    enabled: true,
    channel: config.channel,
    feedUrl: `${config.feedBaseUrl.replace(/\/+$/, '')}/${config.channel}/${config.target}/`,
  };
}

export function createUpdates(options: {
  currentVersion: string;
  policy: UpdatePolicy;
  driver?: UpdateDriver;
  lifecycle: ApplicationLifecycle;
  publish: (state: UpdateState) => void;
}): Omit<UpdatesApi, 'subscribe'> {
  const { policy, driver, lifecycle } = options;
  let state: UpdateState = policy.enabled
    ? {
        status: 'idle',
        revision: 0,
        currentVersion: options.currentVersion,
        channel: policy.channel,
      }
    : {
        status: 'unavailable',
        revision: 0,
        currentVersion: options.currentVersion,
        reason: policy.reason,
      };
  function currentState(): UpdateState {
    return state;
  }
  function publish(next: StateBody) {
    if (!policy.enabled) return;
    state = updateStateSchema.parse({
      ...next,
      currentVersion: options.currentVersion,
      channel: policy.channel,
      revision: state.revision + 1,
    });
    options.publish(state);
  }
  function failed(operation: 'check' | 'download' | 'install') {
    publish({
      status: 'failed',
      operation,
      message:
        operation === 'install'
          ? 'The update could not be installed. Restart the application before trying again.'
          : `The update ${operation} failed. Check for updates to try again.`,
      restartRequired: operation === 'install',
    });
  }
  driver?.onProgress((percent) => {
    if (state.status === 'downloading' && Number.isFinite(percent))
      publish({
        status: 'downloading',
        version: state.version,
        percent: Math.max(state.percent, Math.min(100, Math.max(0, percent))),
      });
  });
  driver?.onError(() => {
    if (state.status === 'installing') lifecycle.installerFailed();
    else if (state.status === 'checking') failed('check');
    else if (state.status === 'downloading') failed('download');
  });
  function unavailable() {
    if (!policy.enabled || !driver)
      return failure('UNAVAILABLE', 'Updates are unavailable for this installation');
    if (!lifecycle.acceptingWork)
      return failure('CONFLICT', 'Application shutdown has already started');
    return undefined;
  }
  let busy = false;
  return {
    async getState() {
      return { ok: true, value: state };
    },
    async check() {
      const rejected = unavailable();
      if (rejected) return rejected;
      if (busy) return failure('CONFLICT', 'An update operation is already running');
      if (!driver) return failure('UNAVAILABLE', 'Updates are unavailable');
      busy = true;
      publish({ status: 'checking' });
      try {
        const info = await driver.check();
        if (state.status === 'checking')
          publish(info ? { status: 'available', version: info.version } : { status: 'idle' });
      } catch {
        failed('check');
      } finally {
        busy = false;
      }
      return { ok: true, value: state };
    },
    async download() {
      const rejected = unavailable();
      if (rejected) return rejected;
      if (busy || state.status !== 'available')
        return failure('CONFLICT', 'Check for an available update before downloading');
      if (!driver) return failure('UNAVAILABLE', 'Updates are unavailable');
      busy = true;
      const version = state.version;
      publish({ status: 'downloading', version, percent: 0 });
      try {
        await driver.download();
        if (currentState().status === 'downloading') publish({ status: 'downloaded', version });
      } catch {
        failed('download');
      } finally {
        busy = false;
      }
      return { ok: true, value: state };
    },
    async install() {
      if (state.status === 'installing') return { ok: true, value: { accepted: true } };
      const rejected = unavailable();
      if (rejected) return rejected;
      if (busy || state.status !== 'downloaded' || !driver)
        return failure('CONFLICT', 'Download an update before installing');
      const version = state.version;
      const accepted = lifecycle.request({
        kind: 'update',
        install: () => driver.install(),
        failed: () => failed('install'),
      });
      if (!accepted) return failure('CONFLICT', 'Application shutdown has already started');
      publish({ status: 'installing', version });
      return { ok: true, value: { accepted: true } };
    },
  };
}

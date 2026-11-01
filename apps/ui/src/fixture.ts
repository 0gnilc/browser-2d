import type { Browser2dApi, Failure, UpdateState } from '@browser-2d/contracts/public';

const businessUnavailable = async (): Promise<Failure> => ({
  ok: false,
  error: { code: 'UNAVAILABLE', message: '界面预览不连接业务数据库。请在桌面应用中使用业务功能。' },
});
const workUnavailable = async (): Promise<Failure> => ({
  ok: false,
  error: {
    code: 'UNAVAILABLE',
    message: '界面预览未连接调度器。请在桌面应用中验证浏览器与恢复。',
  },
});

export function createFixtureBridge(): Browser2dApi {
  const updateState: UpdateState = {
    status: 'unavailable',
    reason: 'development',
    revision: 0,
    currentVersion: '0.1.0',
  };
  const updateView = async () =>
    ({ ok: true, value: updateState }) satisfies Awaited<
      ReturnType<Browser2dApi['updates']['getState']>
    >;
  return {
    updates: {
      getState: updateView,
      check: updateView,
      download: updateView,
      install: async () => ({
        ok: false,
        error: { code: 'UNAVAILABLE', message: '界面预览不提供应用更新。' },
      }),
      subscribe(listener) {
        listener(updateState);
        return () => {};
      },
    },
    devices: {
      list: businessUnavailable,
      create: businessUnavailable,
      update: businessUnavailable,
      delete: businessUnavailable,
    },
    materials: {
      page: businessUnavailable,
      create: businessUnavailable,
      update: businessUnavailable,
      delete: businessUnavailable,
      clear: businessUnavailable,
      reset: businessUnavailable,
      importText: businessUnavailable,
    },
    history: {
      page: businessUnavailable,
      delete: businessUnavailable,
      clear: businessUnavailable,
      exportText: businessUnavailable,
    },
    settings: { get: businessUnavailable, save: businessUnavailable },
    work: {
      start: workUnavailable,
      cancel: workUnavailable,
      getCommand: workUnavailable,
      getSnapshot: workUnavailable,
      subscribe(listener) {
        listener({ status: 'unavailable', generation: 0, reason: '界面预览未连接调度器。' });
        return () => {};
      },
    },
  };
}

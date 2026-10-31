import type { Browser2dApi, Failure } from '@browser-2d/contracts/public';

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
  return {
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

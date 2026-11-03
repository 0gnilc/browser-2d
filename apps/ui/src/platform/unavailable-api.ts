import { failure, type Browser2dApi } from '@browser-2d/contracts/public';

const unavailable = async () =>
  failure('UNAVAILABLE', '桌面连接不可用。请在 Browser 2D 桌面应用中打开，或重新连接后刷新。');

export const unavailableApi: Browser2dApi = {
  browsers: { list: unavailable, create: unavailable, update: unavailable, remove: unavailable },
  cards: { list: unavailable, importText: unavailable, update: unavailable, remove: unavailable },
  workTasks: {
    list: unavailable,
    start: unavailable,
    stop: unavailable,
    subscribe: () => () => {},
  },
  settings: { get: unavailable, save: unavailable },
  updates: {
    getState: unavailable,
    check: unavailable,
    download: unavailable,
    install: unavailable,
    subscribe: () => () => {},
  },
};

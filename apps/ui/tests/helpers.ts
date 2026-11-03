import {
  browserSchema,
  cardSchema,
  settingsViewSchema,
  type Browser2dApi,
  type SettingsView,
} from '@browser-2d/contracts/public';
import { vi } from 'vitest';
import { unavailableApi } from '../src/platform/unavailable-api';

export const browser = browserSchema.parse({
  id: 1,
  provider: 'adspower',
  profileId: 'profile-one',
  name: '工作浏览器',
  account: 'account input',
  amount: '12.34',
  count: 0,
  status: 'idle',
  notes: 'browser note',
  lastError: '',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
});
export const card = cardSchema.parse({
  id: 1,
  number: '0001  2345-6789',
  expiryMonth: '02',
  expiryYear: '29',
  securityCode: '012',
  cardholderName: '测试 姓名',
  billingAddress: '12  Main St',
  billingCity: '城市',
  billingRegion: '省份',
  billingPostalCode: '00123',
  billingCountryCode: 'CN',
  extra: '扩展 文本',
  notes: '本地 备注',
  amount: '1.00',
  inputLocked: false,
  status: 'pending',
  lastResult: {
    processor: 'baidu-check',
    kind: 'verification',
    outcome: 'success',
    message: '页面已打开',
    data: { title: '百度' },
    committedAt: '2026-11-01T01:00:00.000Z',
  },
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T01:00:00.000Z',
});
export const initialSettings = settingsViewSchema.parse({
  values: {
    apiBaseUrl: 'http://127.0.0.1:50325',
    apiKeyConfigured: true,
    maxConcurrentTasks: 2,
    sidebarCollapsed: false,
  },
  revision: 1,
});
export function createTestApi() {
  const listeners = new Set<() => void>();
  let settings: SettingsView = structuredClone(initialSettings);
  const api: Browser2dApi = {
    browsers: {
      ...unavailableApi.browsers,
      list: vi.fn<Browser2dApi['browsers']['list']>(async () => ({ ok: true, value: [browser] })),
    },
    cards: {
      ...unavailableApi.cards,
      list: vi.fn<Browser2dApi['cards']['list']>(async (query) => ({
        ok: true,
        value: { items: [card], total: 1, page: query.page, pageSize: query.pageSize },
      })),
    },
    workTasks: {
      ...unavailableApi.workTasks,
      list: vi.fn<Browser2dApi['workTasks']['list']>(async () => ({ ok: true, value: [] })),
      subscribe: vi.fn((listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    },
    settings: {
      get: vi.fn<Browser2dApi['settings']['get']>(async () => ({
        ok: true,
        value: structuredClone(settings),
      })),
      save: vi.fn<Browser2dApi['settings']['save']>(async (input) => {
        settings = {
          values: {
            ...input.values,
            apiKeyConfigured:
              input.apiKey.kind === 'keep'
                ? settings.values.apiKeyConfigured
                : input.apiKey.kind === 'replace',
          },
          revision: settings.revision + 1,
        };
        return { ok: true, value: { kind: 'saved', settings } };
      }),
    },
    updates: { ...unavailableApi.updates },
  };
  return {
    api,
    emit: () => {
      for (const listener of listeners) listener();
    },
  };
}

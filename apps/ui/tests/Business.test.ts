import type {
  Browser2dApi,
  Device,
  History,
  Material,
  SettingsView,
} from '@browser-2d/contracts/public';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import Devices from '../src/business/Devices.vue';
import Materials from '../src/business/Materials.vue';
import HistoryPage from '../src/business/History.vue';
import Settings from '../src/business/Settings.vue';
import { bridgeKey } from '../src/bridge';
import { createFixtureBridge } from '../src/fixture';

const device: Device = {
  id: 1,
  createTime: '2026-10-30 12:00:00',
  symbol: 'test-device',
  account: null,
  amount: 0,
  count: 0,
  status: 0,
  note: '',
};
const material: Material = {
  id: 2,
  createTime: '2026-10-30 12:00:00',
  card: 'test-card',
  month: '01',
  year: '2030',
  cvv: null,
  name: null,
  address: '',
  city: null,
  state: null,
  zip: null,
  country: null,
  extra: null,
  amount: null,
  status: 0,
  device: null,
  note: null,
};
const history: History = {
  id: 3,
  createTime: '2026-10-30 12:00:00',
  card: 'test-card',
  month: '01',
  day: '17',
  year: '2030',
  cvv: '123',
  extra: null,
  amount: 0,
  status: 0,
  device: null,
  note: null,
};
const settings: SettingsView = {
  revision: 7,
  adsPowerUrl: 'http://localhost:50325',
  viewportWidth: 1280,
  viewportHeight: 720,
  pageCount: 1,
  keyConfigured: true,
  credentialMode: 'persistent',
};
function fixture(): Browser2dApi {
  const api = createFixtureBridge();
  api.devices.list = vi.fn<Browser2dApi['devices']['list']>(async () => ({
    ok: true,
    value: [device],
  }));
  api.devices.update = vi.fn<Browser2dApi['devices']['update']>(async () => ({
    ok: true,
    value: device,
  }));
  api.materials.page = vi.fn<Browser2dApi['materials']['page']>(async (input) => ({
    ok: true,
    value: {
      items: [material],
      total: 65,
      page: input?.page ?? 1,
      pageSize: input?.pageSize ?? 20,
    },
  }));
  api.materials.update = vi.fn<Browser2dApi['materials']['update']>(async () => ({
    ok: true,
    value: material,
  }));
  api.history.page = vi.fn<Browser2dApi['history']['page']>(async (input) => ({
    ok: true,
    value: { items: [history], total: 1, page: input?.page ?? 1, pageSize: input?.pageSize ?? 20 },
  }));
  api.settings.get = vi.fn<Browser2dApi['settings']['get']>(async () => ({
    ok: true,
    value: settings,
  }));
  api.settings.save = vi.fn<Browser2dApi['settings']['save']>(async () => ({
    ok: true,
    value: { ...settings, revision: 8 },
  }));
  return api;
}

describe('P2 business screens', () => {
  it('preserves zero, null and an existing empty string when editing a device', async () => {
    const api = fixture();
    const wrapper = mount(Devices, { global: { provide: { [bridgeKey]: api } } });
    await flushPromises();
    await wrapper.get('[data-testid="device-edit-1"]').trigger('click');
    expect(wrapper.get<HTMLInputElement>('[data-testid="device-amount"]').element.value).toBe('0');
    await wrapper.get('[data-testid="device-form"]').trigger('submit');
    await flushPromises();
    expect(api.devices.update).toHaveBeenCalledWith({
      id: 1,
      symbol: 'test-device',
      account: null,
      amount: 0,
      count: 0,
      status: 0,
      note: '',
    });
    await wrapper.get('[data-testid="device-edit-1"]').trigger('click');
    await wrapper.get('[data-testid="device-amount"]').setValue('');
    await wrapper.get('[data-testid="device-form"]').trigger('submit');
    await flushPromises();
    expect(api.devices.update).toHaveBeenLastCalledWith(expect.objectContaining({ amount: null }));
    wrapper.unmount();
  });

  it('shows actual committed import count and each original line outcome', async () => {
    const api = fixture();
    api.materials.importText = vi.fn<Browser2dApi['materials']['importText']>(async () => ({
      ok: true,
      value: {
        committed: 1,
        lines: [
          { line: 1, outcome: 'inserted' },
          { line: 2, outcome: 'blank' },
          { line: 3, outcome: 'invalid' },
          { line: 4, outcome: 'duplicate' },
        ],
      },
    }));
    const wrapper = mount(Materials, { global: { provide: { [bridgeKey]: api } } });
    await flushPromises();
    const text = 'test-card|01|2030|123\n\ninvalid\ntest-card|01|2030|123';
    await wrapper.get('[data-testid="material-import-text"]').setValue(text);
    await wrapper.get('.import-form').trigger('submit');
    await flushPromises();
    expect(api.materials.importText).toHaveBeenCalledWith({ text });
    expect(wrapper.get('[data-testid="import-report"]').text()).toContain('实际提交 1 条');
    expect(wrapper.get('[data-testid="import-line-2"]').text()).toContain('空行');
    expect(wrapper.get('[data-testid="import-line-3"]').text()).toContain('无效');
    expect(wrapper.get('[data-testid="import-line-4"]').text()).toContain('重复');
    wrapper.unmount();
  });

  it('filters status zero, changes pages, and preserves nullable material fields on edit', async () => {
    const api = fixture();
    const wrapper = mount(Materials, { global: { provide: { [bridgeKey]: api } } });
    await flushPromises();
    await wrapper.get('[data-testid="material-filter-status"]').setValue('0');
    await wrapper.get('[data-testid="material-filter"]').trigger('submit');
    await flushPromises();
    expect(api.materials.page).toHaveBeenLastCalledWith({
      card: '',
      page: 1,
      pageSize: 20,
      status: 0,
    });
    await wrapper.get('[data-testid="material-edit-2"]').trigger('click');
    await wrapper.get('[data-testid="material-form"]').trigger('submit');
    await flushPromises();
    expect(api.materials.update).toHaveBeenCalledWith({
      id: 2,
      card: 'test-card',
      month: '01',
      year: '2030',
      cvv: null,
      name: null,
      address: '',
      city: null,
      state: null,
      zip: null,
      country: null,
      extra: null,
      amount: null,
      status: 0,
      device: null,
      note: null,
    });
    const nextPage = wrapper.findAll('.n-pagination-item').find((item) => item.text() === '2');
    expect(nextPage).toBeDefined();
    await nextPage?.trigger('click');
    await flushPromises();
    expect(api.materials.page).toHaveBeenLastCalledWith({
      card: '',
      page: 2,
      pageSize: 20,
      status: 0,
    });
    wrapper.unmount();
  });

  it('surfaces a processing conflict and keeps the material visible', async () => {
    const api = fixture();
    api.materials.reset = vi.fn<Browser2dApi['materials']['reset']>(async () => ({
      ok: false,
      error: { code: 'CONFLICT', message: '处理中材料不可重置。' },
    }));
    const wrapper = mount(Materials, { global: { provide: { [bridgeKey]: api } } });
    await flushPromises();
    await wrapper.get('[data-testid="material-reset-2"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('CONFLICT · 处理中材料不可重置。');
    expect(wrapper.get('[data-testid="material-2"]').text()).toContain('test-card');
    wrapper.unmount();
  });

  it('exports every matching history row using the returned legacy day text', async () => {
    const api = fixture();
    api.history.exportText = vi.fn<Browser2dApi['history']['exportText']>(async () => ({
      ok: true,
      value: { text: 'test-card|01|17|123\nother-card|02|18|456\n', count: 2 },
    }));
    const wrapper = mount(HistoryPage, { global: { provide: { [bridgeKey]: api } } });
    await flushPromises();
    expect(api.history.page).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(wrapper.get('[data-testid="history-3"]').text()).toContain('01 / 17 / 2030');
    await wrapper.get('[data-testid="history-filter-status"]').setValue('0');
    await wrapper.get('[data-testid="history-start-time"]').setValue('2026-10-01 00:00:00');
    await wrapper.get('[data-testid="history-end-time"]').setValue('2026-10-31 23:59:59');
    await wrapper.get('[data-testid="history-export"]').trigger('click');
    await flushPromises();
    expect(api.history.exportText).toHaveBeenCalledWith({
      status: 0,
      startTime: '2026-10-01 00:00:00',
      endTime: '2026-10-31 23:59:59',
    });
    expect(
      wrapper.get<HTMLTextAreaElement>('[data-testid="history-export-text"]').element.value,
    ).toBe('test-card|01|17|123\nother-card|02|18|456\n');
    expect(wrapper.get('[data-testid="history-export-result"]').text()).toContain('已导出 2 条');
    wrapper.unmount();
  });

  it('saves typed settings with explicit retain, session replacement and clear without echoing a key', async () => {
    const api = fixture();
    const wrapper = mount(Settings, { global: { provide: { [bridgeKey]: api } } });
    await flushPromises();
    expect(wrapper.find('[data-testid="settings-secret"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="settings-credential-state"]').text()).toContain('凭据已配置');
    await wrapper.get('[data-testid="settings-width"]').setValue('1440');
    await wrapper.get('[data-testid="settings-form"]').trigger('submit');
    await flushPromises();
    expect(api.settings.save).toHaveBeenCalledWith({
      expectedRevision: 7,
      values: {
        adsPowerUrl: settings.adsPowerUrl,
        viewportWidth: 1440,
        viewportHeight: 720,
        pageCount: 1,
      },
      secret: { action: 'retain' },
    });
    await wrapper.get('[data-testid="settings-secret-action"]').setValue('replace');
    await wrapper.get('[data-testid="settings-persistence"]').setValue('session');
    await wrapper.get('[data-testid="settings-secret"]').setValue('fixture-only-secret');
    await wrapper.get('[data-testid="settings-form"]').trigger('submit');
    await flushPromises();
    expect(api.settings.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedRevision: 8,
        secret: { action: 'replace', value: 'fixture-only-secret', persistence: 'session' },
      }),
    );
    expect(wrapper.html()).not.toContain('fixture-only-secret');
    expect(wrapper.find('[data-testid="settings-secret"]').exists()).toBe(false);
    await wrapper.get('[data-testid="settings-secret-action"]').setValue('clear');
    await wrapper.get('[data-testid="settings-form"]').trigger('submit');
    await flushPromises();
    expect(api.settings.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ secret: { action: 'clear' } }),
    );
    wrapper.unmount();
  });

  it('keeps unsaved settings visible when the expected revision conflicts', async () => {
    const api = fixture();
    api.settings.save = vi.fn<Browser2dApi['settings']['save']>(async () => ({
      ok: false,
      error: { code: 'CONFLICT', message: '设置已被其他请求更新。' },
    }));
    const wrapper = mount(Settings, { global: { provide: { [bridgeKey]: api } } });
    await flushPromises();
    await wrapper.get('[data-testid="settings-width"]').setValue('1440');
    await wrapper.get('[data-testid="settings-form"]').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('CONFLICT');
    expect(wrapper.get<HTMLInputElement>('[data-testid="settings-width"]').element.value).toBe(
      '1440',
    );
    expect(wrapper.find('[data-testid="settings-saved"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('reports an absent desktop API and an explicitly unavailable preview API', async () => {
    const missing = mount(Devices);
    await flushPromises();
    expect(missing.get('[role="alert"]').text()).toContain('桌面业务 API 不可用');
    missing.unmount();
    const preview = mount(Devices, { global: { provide: { [bridgeKey]: createFixtureBridge() } } });
    await flushPromises();
    expect(preview.get('[role="alert"]').text()).toContain('UNAVAILABLE');
    expect(preview.get('[role="alert"]').text()).toContain('界面预览不连接业务数据库');
    preview.unmount();
  });
});

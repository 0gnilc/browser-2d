import { describe, expect, it, vi } from 'vitest';
import { updateStateSchema, type UpdateState } from '@browser-2d/contracts/public';
import { createApplicationLifecycle } from '../src/main/lifecycle';
import { createUpdates, updatePolicy, type UpdateDriver } from '../src/main/updates';
function setup() {
  let progress = (_percent: number) => {};
  let error = () => {};
  const check = vi.fn(async () => ({ version: '0.2.0' }));
  const download = vi.fn(async () => {});
  const install = vi.fn();
  const driver: UpdateDriver = {
    check,
    download,
    install,
    onProgress(listener) {
      progress = listener;
    },
    onError(listener) {
      error = listener;
    },
  };
  const states: UpdateState[] = [];
  const lifecycle = createApplicationLifecycle({
    stopAcceptingWork() {},
    closeWorker: async () => {},
    report: async () => {},
    exit() {},
    logFailure() {},
  });
  const api = createUpdates({
    currentVersion: '0.1.0',
    policy: { enabled: true, channel: 'stable', feedUrl: 'https://example.com/stable/mac-arm64/' },
    driver,
    lifecycle,
    publish(state) {
      states.push(updateStateSchema.parse(state));
    },
  });
  return {
    api,
    states,
    lifecycle,
    check,
    download,
    install,
    progress: (percent: number) => progress(percent),
    error: () => error(),
  };
}
describe('manual updates', () => {
  it('requires separate check, download, and install actions', async () => {
    const t = setup();
    expect((await t.api.install()).ok).toBe(false);
    expect((await t.api.download()).ok).toBe(false);
    await t.api.check();
    expect(t.download).not.toHaveBeenCalled();
    await t.api.download();
    expect(t.install).not.toHaveBeenCalled();
    expect(await t.api.install()).toEqual({ ok: true, value: { accepted: true } });
    expect(t.lifecycle.acceptingWork).toBe(false);
    await t.api.install();
    await t.lifecycle.completion;
    expect(t.install).toHaveBeenCalledOnce();
    expect(t.states.map((s) => s.status)).toEqual([
      'checking',
      'available',
      'downloading',
      'downloaded',
      'installing',
    ]);
    expect(t.states.map((s) => s.revision)).toEqual([1, 2, 3, 4, 5]);
  });
  it('coalesces neither checks nor downloads and keeps monotonic sanitized progress', async () => {
    const t = setup();
    const pending = Promise.withResolvers<void>();
    t.download.mockImplementation(() => pending.promise);
    await t.api.check();
    const downloading = t.api.download();
    expect((await t.api.check()).ok).toBe(false);
    expect((await t.api.download()).ok).toBe(false);
    t.progress(45);
    t.progress(10);
    t.progress(Infinity);
    t.progress(130);
    expect(await t.api.getState()).toMatchObject({
      value: { status: 'downloading', percent: 100 },
    });
    pending.resolve();
    await downloading;
    expect(t.download).toHaveBeenCalledOnce();
    t.progress(1);
    expect(await t.api.getState()).toMatchObject({ value: { status: 'downloaded' } });
  });
  it('redacts errors, prevents stale completion, and supports recheck after download failure', async () => {
    const t = setup();
    await t.api.check();
    t.download.mockImplementationOnce(async () => {
      t.error();
      throw new Error('/secret/path https://user:password@feed');
    });
    await t.api.download();
    expect(await t.api.getState()).toMatchObject({
      value: { status: 'failed', operation: 'download', restartRequired: false },
    });
    expect(JSON.stringify(t.states)).not.toContain('secret');
    expect((await t.api.install()).ok).toBe(false);
    await t.api.check();
    await t.api.download();
    expect(await t.api.getState()).toMatchObject({ value: { status: 'downloaded' } });
  });
  it('does not resurrect available state when upstream emits error and resolves', async () => {
    const t = setup();
    t.check.mockImplementation(async () => {
      t.error();
      return { version: '0.2.0' };
    });
    await t.api.check();
    expect(await t.api.getState()).toMatchObject({
      value: { status: 'failed', operation: 'check' },
    });
  });
  it('rejects installing when normal quit already owns shutdown', async () => {
    const t = setup();
    await t.api.check();
    await t.api.download();
    t.lifecycle.request({ kind: 'quit' });
    expect(await t.api.install()).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    await t.lifecycle.completion;
    expect(t.install).not.toHaveBeenCalled();
  });
  it('publishes restart-required failure after installer error', async () => {
    const t = setup();
    await t.api.check();
    await t.api.download();
    await t.api.install();
    await t.lifecycle.completion;
    t.error();
    expect(await t.api.getState()).toMatchObject({
      value: { status: 'failed', operation: 'install', restartRequired: true },
    });
    expect((await t.api.check()).ok).toBe(false);
  });
});
describe('immutable build policy', () => {
  const environment = { packaged: true, platform: 'darwin', arch: 'arm64', appImage: false };
  const config = {
    mode: 'production',
    channel: 'test',
    target: 'mac-arm64',
    feedBaseUrl: 'https://updates.example.com/releases/',
  };
  it('uses only the embedded channel and target', () => {
    expect(updatePolicy({ ...environment, config })).toEqual({
      enabled: true,
      channel: 'test',
      feedUrl: 'https://updates.example.com/releases/test/mac-arm64/',
    });
  });
  it.each([
    'http://feed.example',
    'https://user:password@feed.example',
    'https://feed.example/?token=secret',
    'https://feed.example/#hash',
  ])('rejects unsafe base %s', (feedBaseUrl) => {
    expect(updatePolicy({ ...environment, config: { ...config, feedBaseUrl } }).enabled).toBe(
      false,
    );
  });
  it('disables development, preview, wrong targets and system packages', () => {
    expect(updatePolicy({ ...environment, packaged: false, config })).toEqual({
      enabled: false,
      reason: 'development',
    });
    expect(updatePolicy({ ...environment, config: { mode: 'preview' } })).toEqual({
      enabled: false,
      reason: 'unconfigured',
    });
    expect(updatePolicy({ ...environment, arch: 'x64', config }).enabled).toBe(false);
    expect(updatePolicy({ ...environment, platform: 'linux', arch: 'x64', config })).toEqual({
      enabled: false,
      reason: 'package-manager',
    });
  });
  it.each(['deb', 'rpm', 'pacman', 'unreadable'])(
    'keeps %s packages on their system channel even with an inherited AppImage variable',
    (packageType) => {
      expect(
        updatePolicy({
          ...environment,
          platform: 'linux',
          arch: 'x64',
          appImage: true,
          packageType,
          config: { ...config, target: 'linux-x64' },
        }),
      ).toEqual({ enabled: false, reason: 'package-manager' });
    },
  );
  it('permits an AppImage without a system package marker', () => {
    expect(
      updatePolicy({
        ...environment,
        platform: 'linux',
        arch: 'x64',
        appImage: true,
        config: { ...config, target: 'linux-x64' },
      }).enabled,
    ).toBe(true);
  });
});

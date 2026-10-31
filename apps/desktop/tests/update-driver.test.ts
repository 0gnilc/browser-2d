import { expect, it, vi } from 'vitest';
const updater = vi.hoisted(() => ({
  autoDownload: true,
  autoInstallOnAppQuit: true,
  allowDowngrade: true,
  allowPrerelease: false,
  logger: null,
  setFeedURL: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  on: vi.fn(),
}));
vi.mock('electron-updater', () => ({ autoUpdater: updater }));
import { createUpdateDriver } from '../src/main/update-driver';

it('rejects a prerelease advertised by a stable generic feed even if upstream accepts it', async () => {
  updater.checkForUpdates.mockResolvedValue({
    isUpdateAvailable: true,
    updateInfo: { version: '0.2.0-beta.1' },
  });
  const driver = createUpdateDriver({
    feedUrl: 'https://example.com/stable/linux-x64/',
    channel: 'stable',
  });
  expect(await driver.check()).toBeNull();
  updater.checkForUpdates.mockResolvedValue({
    isUpdateAvailable: true,
    updateInfo: { version: '0.2.0+build-test' },
  });
  expect(await driver.check()).toEqual({ version: '0.2.0+build-test' });
});

it('allows an advertised prerelease in the test channel without automatic download or install', async () => {
  updater.checkForUpdates.mockResolvedValue({
    isUpdateAvailable: true,
    updateInfo: { version: '0.2.0-beta.1' },
  });
  const driver = createUpdateDriver({
    feedUrl: 'https://example.com/test/linux-x64/',
    channel: 'test',
  });
  expect(await driver.check()).toEqual({ version: '0.2.0-beta.1' });
  expect(updater.autoDownload).toBe(false);
  expect(updater.autoInstallOnAppQuit).toBe(false);
  expect(updater.allowDowngrade).toBe(false);
});

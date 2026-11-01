import { autoUpdater } from 'electron-updater';
import type { UpdateDriver } from './updates';

export function createUpdateDriver(options: {
  feedUrl: string;
  channel: 'stable' | 'test';
}): UpdateDriver {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = options.channel === 'test';
  autoUpdater.logger = null;
  autoUpdater.setFeedURL({ provider: 'generic', url: options.feedUrl, channel: 'latest' });
  return {
    async check() {
      const result = await autoUpdater.checkForUpdates();
      if (!result?.isUpdateAvailable) return null;
      const version = result.updateInfo.version;
      if (options.channel === 'stable' && /^[^+]*-/.test(version)) return null;
      return { version };
    },
    async download() {
      await autoUpdater.downloadUpdate();
    },
    install() {
      autoUpdater.quitAndInstall(false, true);
    },
    onProgress(listener) {
      autoUpdater.on('download-progress', (progress) => listener(progress.percent));
    },
    onError(listener) {
      autoUpdater.on('error', listener);
    },
  };
}

import { app } from 'electron';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { getAppCacheDir } from 'electron-updater/out/AppAdapter.js';
import { AppImageUpdater } from 'electron-updater';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';
const directory = process.env.UPDATE_TEST_DIRECTORY;
app.setPath('userData', directory);
app.getVersion = () => '0.1.0';
const payload = Buffer.from('This is a download fixture, not an executable AppImage.');
let version = '0.1.0';
let broken = 'missing';
let payloadRequests = 0;
const server = createServer((request, response) => {
  if (request.url.split('?')[0].endsWith('.yml')) {
    response.end(
      `version: ${version}\nfiles:\n  - url: update.AppImage\n    sha512: ${createHash('sha512').update(payload).digest('base64')}\n    size: ${payload.length}\npath: update.AppImage\nsha512: ${createHash('sha512').update(payload).digest('base64')}\nreleaseDate: '2026-01-01T00:00:00.000Z'\n`,
    );
  } else {
    payloadRequests++;
    if (broken === 'missing') {
      response.writeHead(404);
      response.end();
    } else response.end(broken === 'hash' ? Buffer.alloc(payload.length, 42) : payload);
  }
});
(async () => {
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  process.env.APPIMAGE = join(directory, 'old.AppImage');
  await writeFile(process.env.APPIMAGE, 'old fixture');
  const config = join(directory, 'app-update.yml');
  await writeFile(
    config,
    `updaterCacheDirName: ${relative(getAppCacheDir(), join(directory, 'cache'))}\n`,
  );
  const updater = new AppImageUpdater({
    provider: 'generic',
    url: `http://127.0.0.1:${address.port}/`,
  });
  updater.updateConfigPath = config;
  updater.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${address.port}/` });
  updater.forceDevUpdateConfig = true;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  updater.disableDifferentialDownload = true;
  updater.logger = null;
  updater.on('error', () => {});
  assert.equal((await updater.checkForUpdates()).isUpdateAvailable, false);
  version = '0.0.9';
  assert.equal((await updater.checkForUpdates()).isUpdateAvailable, false);
  version = '0.2.0-beta.1';
  assert.equal((await updater.checkForUpdates()).isUpdateAvailable, true);
  version = '0.2.0';
  assert.equal((await updater.checkForUpdates()).isUpdateAvailable, true);
  assert.equal(payloadRequests, 0);
  await assert.rejects(updater.downloadUpdate());
  broken = 'hash';
  await updater.checkForUpdates();
  await assert.rejects(updater.downloadUpdate(), /sha512 checksum mismatch/);
  broken = 'none';
  await updater.checkForUpdates();
  const [file] = await updater.downloadUpdate();
  assert.deepEqual(await readFile(file), payload);
  assert.equal(await readFile(process.env.APPIMAGE, 'utf8'), 'old fixture');
  process.stdout.write(
    JSON.stringify({
      equal: true,
      older: true,
      newer: true,
      genericProviderRequiresPrereleaseFilter: true,
      manualDownload: true,
      missingRejected: true,
      hashRejected: true,
      retryDownloaded: true,
      originalUnchanged: true,
    }) + '\n',
  );
  server.close();
  app.exit(0);
})().catch((error) => {
  process.stderr.write(String(error.stack || error) + '\n');
  server.close();
  app.exit(1);
});

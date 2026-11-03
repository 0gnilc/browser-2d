import { existsSync, mkdirSync, readFileSync, watch } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, dialog } from 'electron';
import log from 'electron-log/main';
import {
  applicationPublicOperations,
  updateOperations,
  updateChangedChannel,
} from '@browser-2d/contracts/host';
import { failure } from '@browser-2d/contracts/public';
import { createApplicationLifecycle } from './lifecycle';
import { createUpdates, updatePolicy } from './updates';
import { createUpdateDriver } from './update-driver';
import { launchDataService } from './data-service-client';
import { createCredentialVault } from '../platform/credentials';
import { createApplicationBridge } from '../bridge/application';
import { applicationChannel, tasksChangedChannel } from '../bridge/channels';
import { createSettingsCoordinator } from './settings-coordinator';
import { createTaskCoordinator } from './task-coordinator';
import { runCrashOwner } from '../verification/crash-owner';
import { verifyTaskProcesses } from '../verification/task-process';
import { verifyAdsPower } from '../verification/adspower';
import { workbenchVerification } from '../verification/workbench';
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
declare const __PRODUCT_IDENTITY__: { productName: string; appId: string; executableName: string };
app.setName(__PRODUCT_IDENTITY__.productName);
app.setAppUserModelId(__PRODUCT_IDENTITY__.appId);
const rendererUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const workbenchReport = process.argv
  .find((value) => value.startsWith('--verify-workbench='))
  ?.slice('--verify-workbench='.length);
const verificationAppData = process.argv
  .find((value) => value.startsWith('--verify-app-data='))
  ?.slice('--verify-app-data='.length);
if (verificationAppData) {
  const suffix = relative(tmpdir(), resolve(verificationAppData));
  if (
    process.env.BROWSER2D_DATA_DIR ||
    !process.argv.some((value) => value.startsWith('--verify-workbench=')) ||
    isAbsolute(suffix) ||
    suffix.split(/[\\/]/).length !== 1 ||
    !suffix.startsWith('browser-2d-default-')
  )
    throw new Error('Default-path verification requires a dedicated temporary appData base');
  mkdirSync(verificationAppData, { recursive: true });
  app.setPath('appData', resolve(verificationAppData));
}
const dataDir = resolve(process.env.BROWSER2D_DATA_DIR || app.getPath('userData'));
mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
let verification: Awaited<ReturnType<typeof workbenchVerification>> | undefined;
let worker: ReturnType<typeof launchDataService> | undefined;
let tasks: ReturnType<typeof createTaskCoordinator> | undefined;
let bridge: ReturnType<typeof createApplicationBridge> | undefined;
let window: BrowserWindow | undefined;
function changed() {
  if (window && !window.isDestroyed()) window.webContents.send(tasksChangedChannel);
}
function allowedFrame(event: Electron.IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    return false;
  const url = new URL(event.senderFrame.url);
  return rendererUrl
    ? url.origin === new URL(rendererUrl).origin
    : url.protocol === 'app:' && url.hostname === 'ui';
}
for (const method of Object.keys(applicationPublicOperations)) {
  const operation = applicationPublicOperations[method as keyof typeof applicationPublicOperations];
  ipcMain.handle(applicationChannel(method), async (event, input: unknown) => {
    if (!allowedFrame(event)) return failure('INVALID_INPUT', 'Untrusted application frame');
    if (!operation.input.safeParse(input).success)
      return failure('INVALID_INPUT', 'Invalid application input');
    if (!bridge || !lifecycle.acceptingWork)
      return failure('UNAVAILABLE', 'Application is unavailable');
    return bridge.invoke(method as keyof typeof applicationPublicOperations, input);
  });
}
const lifecycle = createApplicationLifecycle({
  stopAcceptingWork: changed,
  async closeWorker() {
    try {
      await tasks?.shutdown();
    } finally {
      await worker?.close();
    }
  },
  report: async (exitCode) => {
    await verification?.report(exitCode);
  },
  exit: (code) => app.exit(code),
  logFailure() {
    log.error('Application cleanup is incomplete. Recovery reservations are retained');
  },
});
let releaseConfig: unknown;
if (app.isPackaged) {
  try {
    releaseConfig = JSON.parse(
      readFileSync(join(process.resourcesPath, 'release-config.json'), 'utf8'),
    );
  } catch {
    log.warn('Update configuration is unavailable');
  }
}
let packageType: string | undefined;
if (app.isPackaged && process.platform === 'linux') {
  try {
    packageType = readFileSync(join(process.resourcesPath, 'package-type'), 'utf8').trim();
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      packageType = 'unreadable';
  }
}
const policy = updatePolicy({
  packaged: app.isPackaged,
  config: releaseConfig,
  platform: process.platform,
  arch: process.arch,
  appImage: Boolean(process.env.APPIMAGE),
  packageType,
});
const updates = createUpdates({
  currentVersion: app.getVersion(),
  policy,
  lifecycle,
  driver: policy.enabled ? createUpdateDriver(policy) : undefined,
  publish(state) {
    if (window && !window.isDestroyed()) window.webContents.send(updateChangedChannel, state);
  },
});
for (const method of ['getState', 'check', 'download', 'install'] as const) {
  const operation = updateOperations[method];
  ipcMain.handle(operation.channel, async (event, input: unknown) => {
    if (!allowedFrame(event)) return failure('INVALID_INPUT', 'Untrusted application frame');
    if (!operation.input.safeParse(input).success)
      return failure('INVALID_INPUT', 'Invalid update request');
    return updates[method]();
  });
}
function closeApplication() {
  lifecycle.request({ kind: 'quit' });
  return lifecycle.completion;
}
app.on('before-quit', (event) => {
  if (lifecycle.nativeQuitAllowed) return;
  event.preventDefault();
  void closeApplication();
});
app.on('window-all-closed', () => {
  if (!lifecycle.nativeQuitAllowed) void closeApplication();
});
process.on('SIGTERM', () => {
  void closeApplication();
});
process.on('SIGINT', () => {
  void closeApplication();
});

async function startApplication() {
  const ownerArgument = process.argv
    .find((value) => value.startsWith('--verify-task-owner='))
    ?.slice('--verify-task-owner='.length);
  if (ownerArgument) {
    try {
      await runCrashOwner(JSON.parse(ownerArgument));
    } catch (error) {
      log.error('Task owner verification failed', error);
      app.exit(1);
    }
    return;
  }

  const adspowerArgument = process.argv
    .find((value) => value.startsWith('--verify-adspower='))
    ?.slice('--verify-adspower='.length);
  if (adspowerArgument) {
    try {
      await verifyAdsPower(JSON.parse(adspowerArgument));
      app.exit(0);
    } catch {
      log.error('AdsPower verification failed; inspect the redacted report');
      app.exit(1);
    }
    return;
  }
  const processReport = process.argv
    .find((value) => value.startsWith('--verify-task-processes='))
    ?.slice('--verify-task-processes='.length);
  if (processReport) {
    try {
      await verifyTaskProcesses(processReport);
      app.exit(0);
    } catch (error) {
      log.error('Task process verification failed', error);
      app.exit(1);
    }
    return;
  }
  if (workbenchReport !== undefined)
    verification = await workbenchVerification(workbenchReport, dataDir);
  await mkdir(dataDir, { recursive: true });
  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
    return;
  }
  const control = !app.isPackaged && process.env.BROWSER2D_DEV_CONTROL;
  if (control)
    watch(control, () => {
      if (existsSync(join(control, 'stop'))) void closeApplication();
    });
  if (control && existsSync(join(control, 'stop'))) {
    await closeApplication();
    return;
  }
  const rendererRoot = join(__dirname, '../renderer');
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'ui') return new Response('Forbidden', { status: 403 });
    let file: string;
    try {
      file = resolve(
        rendererRoot,
        `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
      );
    } catch {
      return new Response('Invalid path', { status: 400 });
    }
    const suffix = relative(rendererRoot, file);
    if (suffix.startsWith('..') || isAbsolute(suffix))
      return new Response('Forbidden', { status: 403 });
    const response = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(response.headers);
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    );
    return new Response(response.body, { status: response.status, headers });
  });
  const vault = createCredentialVault({
    path: join(dataDir, 'credentials.enc'),
    encryption: {
      async available() {
        const available = await safeStorage.isAsyncEncryptionAvailable();
        return (
          available &&
          (process.platform !== 'linux' ||
            !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()))
        );
      },
      encrypt: (value) => safeStorage.encryptStringAsync(value),
      async decrypt(value) {
        return (await safeStorage.decryptStringAsync(value)).result;
      },
    },
  });
  worker = launchDataService({
    dataPath: join(dataDir, 'data', 'app.sqlite'),
    ...(verification ? { entry: verification.dataEntry } : {}),
    nativeBinding: app.isPackaged ? undefined : process.env.BROWSER2D_NATIVE_BINDING,
    onChanged: changed,
    onUnavailable() {
      tasks?.unavailable();
      changed();
      log.error('DataService is unavailable');
    },
  });
  await worker.ready;
  const settings = createSettingsCoordinator(worker, vault);
  tasks = createTaskCoordinator({
    data: worker,
    ownershipDirectory: join(dataDir, 'data', 'execution-owners'),
    connection: verification?.connection ?? settings.connection,
    ...(verification ? { platform: verification.platform, spawn: verification.spawn } : {}),
    changed,
  });
  await tasks.recover();
  bridge = createApplicationBridge({ data: worker, settings, tasks });
  if (!lifecycle.acceptingWork) return;
  if (process.argv.includes('--backend-only')) {
    log.info('DataService ready');
    return;
  }
  window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 760,
    minHeight: 600,
    show: !verification,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('close', (event) => {
    if (!lifecycle.nativeQuitAllowed) {
      event.preventDefault();
      void closeApplication();
    }
  });
  if (rendererUrl) await window.loadURL(rendererUrl);
  else await window.loadURL('app://ui/index.html');
  if (verification) {
    await verification.run(window, worker.entry);
    await closeApplication();
  }
}
void app
  .whenReady()
  .then(startApplication)
  .catch(async () => {
    log.error(
      workbenchReport !== undefined
        ? 'Workbench verification failed'
        : 'Application startup failed',
    );
    if (
      workbenchReport === undefined &&
      lifecycle.acceptingWork &&
      !process.argv.includes('--backend-only')
    )
      dialog.showErrorBox(
        '应用启动失败',
        `无法完成应用初始化。请查看日志后重试：\n${log.transports.file.getFile().path}\n现有数据和待恢复任务均已保留。`,
      );
    lifecycle.request({ kind: 'quit', exitCode: 1 });
    await lifecycle.completion;
  });

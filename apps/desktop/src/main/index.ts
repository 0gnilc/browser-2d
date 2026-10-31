import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, watch } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, dialog } from 'electron';
import log from 'electron-log/main';
import {
  updateOperations,
  updateChangedChannel,
  businessChannel,
  businessMethods,
  channels,
  requestSchema,
  storageFailureCodeSchema,
} from '@browser-2d/contracts/host';
import {
  failure,
  commandResultSchema,
  commandLookupResultSchema,
  workSnapshotResultSchema,
  type WorkSnapshot,
  type WorkState,
} from '@browser-2d/contracts/public';
import { createApplicationLifecycle } from './lifecycle';
import { createUpdates, updatePolicy } from './updates';
import { createUpdateDriver } from './update-driver';
import { launchWorker } from './worker-client';
import { createCredentialVault } from '../platform/credentials';
import { createBusinessCoordinator } from '../bridge/business';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app.setName('Browser 2D Foundation');
const rendererUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const dataDir = resolve(process.env.BROWSER2D_DATA_DIR || app.getPath('userData'));
mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const reportArgument = process.argv.find((value) => value.startsWith('--verify-p1='));
const reportPath = reportArgument?.slice('--verify-p1='.length);
let worker: ReturnType<typeof launchWorker> | undefined;
let window: BrowserWindow | undefined;
let latestSnapshot: WorkSnapshot | undefined;
let workState: WorkState = { status: 'unavailable', generation: 0, reason: 'Worker is starting' };
function publishWork(state: WorkState) {
  workState = state;
  if (window && !window.isDestroyed()) window.webContents.send(channels.changed, state);
}
let coordinator: ReturnType<typeof createBusinessCoordinator> | undefined;
let verification: Record<string, unknown> | undefined;

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
for (const [method, channel] of Object.entries(channels)) {
  if (method === 'changed') continue;
  ipcMain.handle(channel, async (event, input: unknown) => {
    if (!allowedFrame(event)) return failure('INVALID_INPUT', 'Untrusted application frame');
    if (method === 'subscribe') return workState;
    const parsed = requestSchema.safeParse({
      type: 'request',
      requestId: randomUUID(),
      method,
      input,
    });
    if (!parsed.success) return failure('INVALID_INPUT', 'Invalid task request');
    if (!worker || !lifecycle.acceptingWork) return failure('UNAVAILABLE', 'Worker is unavailable');
    try {
      const result = await worker.request(parsed.data);
      return method === 'snapshot'
        ? workSnapshotResultSchema.parse(result)
        : method === 'getCommand'
          ? commandLookupResultSchema.parse(result)
          : commandResultSchema.parse(result);
    } catch {
      log.error('worker request failed');
      return failure('UNAVAILABLE', 'Worker is unavailable');
    }
  });
}

for (const method of businessMethods) {
  ipcMain.handle(businessChannel(method), async (event, input: unknown) => {
    if (!allowedFrame(event)) return failure('INVALID_INPUT', 'Untrusted application frame');
    if (!coordinator || !lifecycle.acceptingWork)
      return failure('UNAVAILABLE', 'Worker is unavailable');
    return coordinator.invoke(method, input);
  });
}

const lifecycle = createApplicationLifecycle({
  stopAcceptingWork() {
    publishWork({
      status: 'unavailable',
      generation: workState.generation + 1,
      reason: 'Worker is shutting down',
    });
  },
  closeWorker: async () => {
    await worker?.close();
  },
  async report(exitCode) {
    if (reportPath && verification)
      await writeFile(
        reportPath,
        JSON.stringify(
          {
            ...verification,
            finalSnapshot: latestSnapshot,
            exitCode,
            workerExited: exitCode === 0,
          },
          null,
          2,
        ),
      );
  },
  exit: (code) => app.exit(code),
  logFailure(error) {
    log.error('shutdown failed', {
      reason: error instanceof Error ? error.message : 'Unknown shutdown error',
      resources: latestSnapshot?.resources,
    });
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

async function verifyPackagedWindow() {
  if (!window || !reportPath) return;
  const tempRelative = relative(tmpdir(), dataDir);
  if (
    tempRelative.startsWith('..') ||
    isAbsolute(tempRelative) ||
    !tempRelative.startsWith('browser-2d-release-') ||
    resolve(reportPath) !== join(dataDir, 'report.json')
  )
    throw new Error('P1 verification requires its own temporary directory');
  const pageProof = setInterval(() => {
    if (!window || window.isDestroyed()) return;
    const pages = existsSync(join(dataDir, 'chrome-pages-ready'));
    const shutdown = existsSync(join(dataDir, 'chrome-pages-ready.shutdown'));
    void window.webContents
      .executeJavaScript(
        `document.documentElement.dataset.chromePagesVerified = '${pages}'; document.documentElement.dataset.chromeShutdownVerified = '${shutdown}'`,
      )
      .catch(() => undefined);
  }, 100);
  let result: unknown;
  try {
    const preparation: unknown = await window.webContents.executeJavaScript(
      `(async () => {
    const assert = (value, message) => { if (!value) throw new Error(message); };
    assert(typeof require === 'undefined' && typeof process === 'undefined', 'Renderer has Node access');
    assert(document.querySelector('[data-testid="start-run"]'), 'Vue application missing');
    const api = window.browser2d;
    const initial = await api.work.getSnapshot(); assert(initial.ok, 'Snapshot failed');
    const initialDevices = await api.devices.list(); assert(initialDevices.ok, 'Business device read failed');
    const devices = [];
    for (let index = 0; index < 3; index++) {
      const device = await api.devices.create({ symbol: 'release-device-' + (initialDevices.value.length + index), amount: 0 });
      assert(device.ok && device.value.amount === 0 && device.value.status === 2, 'Business device write failed');
      devices.push(device.value);
    }
    const initialMaterials = await api.materials.page({}); assert(initialMaterials.ok, 'Business material read failed');
    const material = await api.materials.create({ card: '00000000000000' + String(initialMaterials.value.total).padStart(2, '0'), month: '01', year: '2030', cvv: '000' });
    assert(material.ok, 'Business material write failed');
    const history = await api.history.exportText({}); assert(history.ok && history.value.count === 0, 'Business history read failed');
    const settings = await api.settings.get(); assert(settings.ok, 'Business settings read failed');
    const saved = await api.settings.save({ expectedRevision: settings.value.revision, values: { browser: { mode: 'launch', executablePath: ${JSON.stringify(process.env.BROWSER2D_CHROME_EXECUTABLE || '')}, headless: true }, viewportWidth: 1280, viewportHeight: 800, pageCount: 2 } });
    assert(saved.ok && saved.value.revision === settings.value.revision + 1, 'Business settings commit failed');
    let observed = 0; const dispose = api.work.subscribe(state => { if (state.status === 'ready') observed++; });
    const inputs = devices.map(device => ({ commandId: crypto.randomUUID(), deviceId: device.id }));
    const starts = [];
    for (const input of inputs) { const started = await api.work.start(input); assert(started.ok, 'Start acceptance failed'); starts.push(started.value); }
    const repeated = await api.work.start(inputs[0]);
    assert(repeated.ok && JSON.stringify(repeated.value) === JSON.stringify(starts[0]), 'Command replay changed acceptance');
    const conflict = await api.work.start({ ...inputs[0], commandId: crypto.randomUUID() });
    assert(!conflict.ok && conflict.error.code === 'CONFLICT', 'Device exclusion failed');
    async function waitFor(predicate, description = 'work state') {
      for (let attempt = 0; attempt < 400; attempt++) {
        const result = await api.work.getSnapshot(); assert(result.ok, 'Snapshot failed');
        if (predicate(result.value)) return result.value;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Timed out waiting for ' + description);
    }
    const full = await waitFor(snapshot => starts.slice(0, 2).every(item => snapshot.runs.some(run => run.id === item.runId && run.state === 'running')) && snapshot.runs.some(run => run.id === starts[2].runId && run.state === 'queued'));
    assert(full.resources.reduce((sum, resource) => sum + resource.pages, 0) === 4, 'Page capacity reservation failed');
    if (initial.value.execution === 'chrome') await waitFor(() => document.documentElement.dataset.chromePagesVerified === 'true', 'four observed Chrome pages');
    const queuedCancel = await api.work.cancel({ commandId: crypto.randomUUID(), runId: starts[2].runId });
    assert(queuedCancel.ok, 'Queued cancellation failed');
    const cancelInput = { commandId: crypto.randomUUID(), runId: starts[0].runId };
    const cancelled = await api.work.cancel(cancelInput); assert(cancelled.ok, 'Cancel acceptance failed');
    const command = await api.work.getCommand({ commandId: cancelInput.commandId });
    assert(command.ok && command.value.status === 'recorded' && JSON.stringify(command.value.receipt) === JSON.stringify(cancelled), 'Durable cancel query failed');
    await waitFor(snapshot => snapshot.runs.some(run => run.id === starts[0].runId && run.state === 'cancelled') && snapshot.runs.some(run => run.id === starts[2].runId && run.state === 'cancelled'));
    assert(observed > 0, 'Subscription received no events'); dispose();
    return { initialCount: initial.value.runs.length, completedId: starts[1].runId, cancelledId: starts[0].runId, queuedCancelledId: starts[2].runId, shutdownDeviceId: devices[0].id, workerPid: initial.value.workerPid, observed, nodeIsolation: true, capacity: { devices: 2, pages: 4, queuedObserved: true }, business: { initialDeviceCount: initialDevices.value.length, initialMaterialCount: initialMaterials.value.total, settingsRevision: saved.value.revision } };
  })()`,
    );
    if (latestSnapshot?.execution === 'chrome') {
      const [remaining] = latestSnapshot.resources;
      if (!remaining || latestSnapshot.resources.length !== 1)
        throw new Error('Expected one Chrome workload after cancellation');
      await mkdir(join(dataDir, 'chrome-checkpoints'), { recursive: true, mode: 0o700 });
      await writeFile(
        join(dataDir, 'chrome-checkpoints', `${remaining.operationId}.continue`),
        '',
        { mode: 0o600 },
      );
    }
    result = await window.webContents.executeJavaScript(`(async () => {
      const { shutdownDeviceId, ...result } = ${JSON.stringify(preparation)};
      const api = window.browser2d;
      async function waitFor(predicate, description) {
        for (let attempt = 0; attempt < 400; attempt++) {
          const snapshot = await api.work.getSnapshot();
          if (!snapshot.ok) throw new Error('Snapshot failed');
          if (predicate(snapshot.value)) return snapshot.value;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw new Error('Timed out waiting for ' + description);
      }
      const completed = await waitFor(snapshot => snapshot.runs.some(run => run.id === result.completedId && run.state === 'completed') && snapshot.resources.length === 0, 'completed Chrome workload');
      const active = await api.work.start({ commandId: crypto.randomUUID(), deviceId: shutdownDeviceId });
      if (!active.ok) throw new Error('Shutdown start failed');
      if (completed.execution === 'chrome') await waitFor(() => document.documentElement.dataset.chromeShutdownVerified === 'true', 'two observed shutdown pages');
      return { ...result, shutdownId: active.value.runId };
    })()`);
  } finally {
    clearInterval(pageProof);
  }
  verification = {
    result,
    appVersion: app.getVersion(),
    versions: process.versions,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    rendererUrl: window.webContents.getURL(),
    workerEntry: worker?.entry,
  };
  window.close();
}

async function startApplication() {
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
  const generation = workState.generation + 1;
  worker = launchWorker({
    dataDir,
    browserFixture:
      reportPath && process.env.BROWSER2D_VERIFY_CHROME === '1'
        ? { directory: join(dataDir, 'chrome-checkpoints'), hold: 'pages-ready' }
        : undefined,
    execution:
      (reportPath && process.env.BROWSER2D_VERIFY_CHROME !== '1') ||
      (process.env.BROWSER2D_DATA_DIR && process.env.BROWSER2D_EXECUTION === 'controlled')
        ? 'controlled'
        : 'chrome',
    businessPath:
      process.env.BROWSER2D_DATA_DIR || !app.isPackaged
        ? join(dataDir, 'data.db')
        : join(homedir(), 'kys', 'data.db'),
    async onCredentialChallenge(challenge) {
      const response = { type: 'credential-receipt', bootNonce: challenge.bootNonce } as const;
      if (challenge.kind === 'confirm') {
        const confirmed =
          process.argv.includes('--confirm-legacy-closed') ||
          (
            await dialog.showMessageBox({
              type: 'question',
              title: 'Upgrade local business data',
              message: 'Close the old Browser 2D application before continuing.',
              detail:
                'The worker will keep a validated recovery backup and upgrade the existing data. Confirm that the old application is closed.',
              buttons: ['Cancel', 'Old application is closed. Continue'],
              defaultId: 0,
              cancelId: 0,
            })
          ).response === 1;
        return { ...response, kind: confirmed ? 'confirmed' : 'refused' };
      }
      if (challenge.kind === 'legacy')
        return {
          ...response,
          kind: 'saved',
          secretRef: await vault.preparePersistent(challenge.value),
        };
      await vault.verify(challenge.secretRef);
      return { ...response, kind: 'verified' };
    },
    nativeBinding: app.isPackaged ? undefined : process.env.BROWSER2D_NATIVE_BINDING,
    onSnapshot(snapshot) {
      latestSnapshot = snapshot;
      if (lifecycle.acceptingWork && workState.generation <= generation)
        publishWork({ status: 'ready', generation, snapshot });
    },
    onUnavailable(message) {
      publishWork({
        status: 'unavailable',
        generation: generation + 1,
        reason: 'Worker is unavailable',
      });
      log.error(message);
    },
  });
  coordinator = createBusinessCoordinator({
    available: () => !!worker?.available && lifecycle.acceptingWork,
    request: (message) =>
      worker ? worker.request(message) : Promise.reject(new Error('Worker unavailable')),
  });
  await worker.ready;
  if (!lifecycle.acceptingWork) return;
  if (process.argv.includes('--worker-only')) {
    log.info('Worker ready', { pid: worker.pid });
    return;
  }
  window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 760,
    minHeight: 600,
    show: true,
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
  if (reportPath) await verifyPackagedWindow();
}
void app
  .whenReady()
  .then(startApplication)
  .catch(async (error: unknown) => {
    const parsed = storageFailureCodeSchema.safeParse(
      error instanceof Error ? error.message : undefined,
    );
    const code = parsed.success ? parsed.data : 'INITIALIZATION_FAILED';
    log.error('startup failed', code);
    process.stderr.write(
      JSON.stringify({
        diagnostic: 'main-failure',
        time: new Date().toISOString(),
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      }) + '\n',
    );
    if (lifecycle.acceptingWork && !reportPath && !process.argv.includes('--worker-only'))
      dialog.showErrorBox(
        'Business storage is unavailable',
        `${code}\nClose the old application and check access to the database and operating-system credential store. Existing data and recovery backups are retained.`,
      );
    if (reportPath)
      await writeFile(
        reportPath,
        JSON.stringify({
          error: code,
          detail: error instanceof Error ? error.message : 'Unknown verification failure',
          finalSnapshot: latestSnapshot,
        }),
      );
    lifecycle.request({ kind: 'quit', exitCode: 1 });
    await lifecycle.completion;
  });

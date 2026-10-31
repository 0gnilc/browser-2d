import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, chromium, expect, test } from '@playwright/test';
import {
  deviceSchema,
  resultSchema,
  startResultSchema,
  workSnapshotSchema,
} from '../../packages/contracts/src/public';
import { workerHarness } from './worker-harness';

const desktop = resolve('apps/desktop');
const require = createRequire(join(desktop, 'package.json'));
const executablePath =
  process.env.BROWSER2D_CHROME_EXECUTABLE ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
type Harness = Awaited<ReturnType<typeof workerHarness>>;
const snapshot = async (worker: Harness) =>
  workSnapshotSchema.parse(await worker.evaluate((host) => host.snapshot()));
function absent(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH';
  }
}
async function configure(
  worker: Harness,
  browser:
    | { mode: 'launch'; executablePath: string; headless: boolean }
    | { mode: 'connect'; endpoint: string },
  waitForRunning = true,
) {
  const saved = await worker.evaluate(
    (host, browser) =>
      host.request({
        type: 'business',
        method: 'settings.commit',
        input: {
          expectedRevision: 0,
          values: { browser, viewportWidth: 900, viewportHeight: 700, pageCount: 2 },
        },
      }),
    browser,
  );
  expect(saved).toMatchObject({ ok: true });
  const device = resultSchema(deviceSchema).parse(
    await worker.evaluate((host) =>
      host.request({
        type: 'business',
        method: 'devices.create',
        input: { symbol: 'chrome-crash-fixture' },
      }),
    ),
  );
  if (!device.ok) throw new Error(device.error.code);
  const started = startResultSchema.parse(
    await worker.evaluate(
      (host, input) => host.request({ type: 'request', method: 'start', input }),
      { commandId: randomUUID(), deviceId: device.value.id },
    ),
  );
  if (!started.ok) throw new Error(started.error.code);
  if (waitForRunning)
    await expect
      .poll(
        async () =>
          (await snapshot(worker)).runs.find((run) => run.id === started.value.runId)?.state,
        { timeout: 15_000 },
      )
      .toBe('running');
  return started.value.runId;
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-p4-e2e-'));
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [desktop],
    env: {
      ...process.env,
      BROWSER2D_EXECUTION: 'controlled',
      BROWSER2D_DATA_DIR: join(directory, 'host'),
    },
  });
  await expect((await app.firstWindow()).getByTestId('connection-status')).toHaveAttribute(
    'data-state',
    'connected',
  );
  return { directory, app };
}

for (const phase of ['running', 'spawned', 'cancel-spawned'] as const) {
  test(`owned Chrome ${phase} cleanup confirms actual process exit`, async () => {
    const { directory, app } = await setup();
    const dataDir = join(directory, 'worker');
    const checkpointDir = join(directory, 'checkpoint');
    let worker: Harness | undefined;
    let observer: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
    try {
      worker = await workerHarness(app, {
        dataDir,
        execution: 'chrome',
        browserProbe: { durationMs: 60_000 },
        ...(phase !== 'running'
          ? { browserFixture: { directory: checkpointDir, hold: 'spawned' as const } }
          : {}),
      });
      await worker.evaluate((host) => host.ready());
      const runId = await configure(
        worker,
        { mode: 'launch', executablePath, headless: true },
        phase === 'running',
      );
      if (phase !== 'running')
        await expect
          .poll(async () => (await readdir(checkpointDir).catch(() => [])).length)
          .toBe(1);
      const [operation] = (await snapshot(worker)).resources;
      if (!operation) throw new Error('Chrome obligation missing');
      const directoryPath = join(dataDir, 'chrome-sessions', operation.operationId);
      let port = '';
      await expect
        .poll(async () => {
          try {
            port =
              (await readFile(join(directoryPath, 'DevToolsActivePort'), 'utf8')).split('\n')[0] ??
              '';
            return Number(port) > 0;
          } catch {
            return false;
          }
        })
        .toBe(true);
      observer = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const session = await observer.newBrowserCDPSession();
      const { processInfo } = await session.send('SystemInfo.getProcessInfo');
      const browserPid = processInfo.find((item) => item.type === 'browser')?.id;
      if (!browserPid) throw new Error('Chrome browser PID missing');
      if (phase === 'running')
        await expect
          .poll(async () => observer!.contexts().flatMap((context) => context.pages()).length)
          .toBeGreaterThanOrEqual(2);
      if (phase === 'cancel-spawned') {
        await worker.evaluate(
          (host, input) => host.request({ type: 'request', method: 'cancel', input }),
          { commandId: randomUUID(), runId },
        );
      } else {
        await worker.evaluate((host) => host.kill());
        expect(absent(browserPid), 'Chrome must remain available for verified recovery').toBe(
          false,
        );
        worker = await workerHarness(app, { dataDir, execution: 'chrome' });
        await worker.evaluate((host) => host.ready());
      }
      await observer.close();
      observer = undefined;
      await expect
        .poll(async () => (await snapshot(worker!)).resources.length, { timeout: 20_000 })
        .toBe(0);
      expect((await snapshot(worker)).runs.find((run) => run.id === runId)?.state).toBe(
        phase === 'cancel-spawned' ? 'cancelled' : 'interrupted',
      );
      await expect.poll(() => absent(browserPid), { timeout: 10_000 }).toBe(true);
      expect(await readdir(join(dataDir, 'chrome-sessions'))).toEqual([]);
      expect(await worker.evaluate((host) => host.close())).toMatchObject({ code: 0 });
      worker = undefined;
    } finally {
      await observer?.close().catch(() => undefined);
      await worker?.evaluate((host) => host.close()).catch(() => undefined);
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
for (const phase of ['running', 'context-created', 'cleanup'] as const) {
  test(`borrowed Chrome ${phase} crash preserves original tab and honest cleanup state`, async () => {
    const { directory, app } = await setup();
    const dataDir = join(directory, 'worker');
    const checkpointDir = join(directory, 'checkpoint');
    const chromeDir = join(directory, 'borrowed');
    const original = await chromium.launchPersistentContext(chromeDir, {
      executablePath,
      headless: true,
      args: ['--remote-debugging-port=0'],
    });
    let worker: Harness | undefined;
    try {
      const sentinel = original.pages()[0] ?? (await original.newPage());
      await sentinel.setContent('<title>P4 borrowed sentinel</title><p>preserve me</p>');
      const port = (await readFile(join(chromeDir, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      const endpoint = `http://127.0.0.1:${port}`;
      const targets = async () => {
        const response = await fetch(`${endpoint}/json/list`);
        const value: unknown = await response.json();
        if (!Array.isArray(value)) throw new Error('Invalid target response');
        return value.filter(
          (item) => item && typeof item === 'object' && 'type' in item && item.type === 'page',
        ).length;
      };
      worker = await workerHarness(app, {
        dataDir,
        execution: 'chrome',
        browserProbe: { durationMs: 60_000 },
        ...(phase !== 'running'
          ? { browserFixture: { directory: checkpointDir, hold: phase } }
          : {}),
      });
      await worker.evaluate((host) => host.ready());
      const runId = await configure(
        worker,
        { mode: 'connect', endpoint },
        phase !== 'context-created',
      );
      if (phase === 'context-created')
        await expect
          .poll(async () => (await readdir(checkpointDir).catch(() => [])).length)
          .toBe(1);
      else await expect.poll(targets).toBe(3);
      if (phase === 'cleanup') {
        await worker.evaluate(
          (host, input) => host.request({ type: 'request', method: 'cancel', input }),
          { commandId: randomUUID(), runId },
        );
        await expect
          .poll(async () => (await readdir(checkpointDir).catch(() => [])).length)
          .toBe(1);
        await expect
          .poll(async () => (await snapshot(worker!)).resources[0]?.failure, { timeout: 12_000 })
          .toBe('CLEANUP_FAILED');
        expect((await snapshot(worker)).runs.find((run) => run.id === runId)?.state).toBe(
          'stopping',
        );
      }
      await worker.evaluate((host) => host.kill());
      await expect.poll(targets, { timeout: 10_000 }).toBe(1);
      expect(await sentinel.title()).toBe('P4 borrowed sentinel');
      worker = await workerHarness(app, { dataDir, execution: 'chrome' });
      await worker.evaluate((host) => host.ready());
      if (phase === 'context-created') {
        await expect
          .poll(async () => (await snapshot(worker!)).resources[0]?.failure, { timeout: 10_000 })
          .toBe('OWNERSHIP_UNCERTAIN');
        expect((await snapshot(worker)).resources).toHaveLength(1);
      } else
        await expect
          .poll(async () => (await snapshot(worker!)).resources.length, { timeout: 10_000 })
          .toBe(0);
      expect((await snapshot(worker)).runs.find((run) => run.id === runId)?.state).toBe(
        'interrupted',
      );
      expect(await sentinel.locator('p').innerText()).toBe('preserve me');
      expect(await worker.evaluate((host) => host.close())).toMatchObject({
        code: phase === 'context-created' ? 1 : 0,
      });
      worker = undefined;
    } finally {
      await worker?.evaluate((host) => host.close()).catch(() => undefined);
      await original.close();
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('page checkpoint releases only its operation and shutdown cancels the next held run', async () => {
  const { directory, app } = await setup();
  const dataDir = join(directory, 'worker');
  const checkpointDir = join(directory, 'checkpoint');
  let worker: Harness | undefined;
  try {
    worker = await workerHarness(app, {
      dataDir,
      execution: 'chrome',
      browserProbe: { durationMs: 0 },
      browserFixture: { directory: checkpointDir, hold: 'pages-ready' },
    });
    await worker.evaluate((host) => host.ready());
    const runId = await configure(worker, { mode: 'launch', executablePath, headless: true });
    await expect
      .poll(
        async () =>
          (await readdir(checkpointDir).catch(() => [])).filter((name) =>
            name.endsWith('.pages-ready'),
          ).length,
      )
      .toBe(1);
    const firstSnapshot = await snapshot(worker);
    const [operation] = firstSnapshot.resources;
    const firstRun = firstSnapshot.runs.find((run) => run.id === runId);
    if (!operation || !firstRun) throw new Error('Held Chrome workload missing');
    expect(firstRun.state).toBe('running');
    await writeFile(join(checkpointDir, `${operation.operationId}.continue`), '');
    await expect
      .poll(async () => (await snapshot(worker!)).runs.find((run) => run.id === runId)?.state)
      .toBe('completed');
    const next = startResultSchema.parse(
      await worker.evaluate(
        (host, input) => host.request({ type: 'request', method: 'start', input }),
        { commandId: randomUUID(), deviceId: firstRun.deviceId },
      ),
    );
    if (!next.ok) throw new Error(next.error.code);
    await expect
      .poll(
        async () =>
          (await readdir(checkpointDir)).filter((name) => name.endsWith('.pages-ready')).length,
      )
      .toBe(2);
    expect((await snapshot(worker)).runs.find((run) => run.id === next.value.runId)?.state).toBe(
      'running',
    );
    expect(await worker.evaluate((host) => host.close())).toMatchObject({ code: 0 });
    worker = await workerHarness(app, { dataDir, execution: 'chrome' });
    await worker.evaluate((host) => host.ready());
    expect((await snapshot(worker)).runs.find((run) => run.id === next.value.runId)?.state).toBe(
      'cancelled',
    );
    expect((await snapshot(worker)).resources).toEqual([]);
    expect(await readdir(join(dataDir, 'chrome-sessions'))).toEqual([]);
    expect(await worker.evaluate((host) => host.close())).toMatchObject({ code: 0 });
    worker = undefined;
  } finally {
    await worker?.evaluate((host) => host.close()).catch(() => undefined);
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

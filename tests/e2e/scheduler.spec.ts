import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import {
  deviceSchema,
  resultSchema,
  startResultSchema,
  cancelResultSchema,
  workSnapshotSchema,
  settingsViewSchema,
} from '../../packages/contracts/src/public';
import type { ControlledFixture } from '../../packages/contracts/src/host';
import { workerHarness } from './worker-harness';

const desktop = resolve('apps/desktop');
const require = createRequire(join(desktop, 'package.json'));
type Harness = Awaited<ReturnType<typeof workerHarness>>;
async function snapshot(worker: Harness) {
  return workSnapshotSchema.parse(await worker.evaluate((host) => host.snapshot()));
}
async function createDevice(worker: Harness, symbol = 'controlled-fixture') {
  const result = resultSchema(deviceSchema).parse(
    await worker.evaluate(
      (host, symbol) =>
        host.request({ type: 'business', method: 'devices.create', input: { symbol } }),
      symbol,
    ),
  );
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
async function start(worker: Harness, deviceId: number, commandId: string = randomUUID()) {
  const result = startResultSchema.parse(
    await worker.evaluate(
      (host, input) => host.request({ type: 'request', method: 'start', input }),
      { deviceId, commandId },
    ),
  );
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
async function cancel(worker: Harness, runId: string) {
  return cancelResultSchema.parse(
    await worker.evaluate(
      (host, input) => host.request({ type: 'request', method: 'cancel', input }),
      { runId, commandId: randomUUID() },
    ),
  );
}
async function files(directory: string, suffix = '') {
  try {
    return (await readdir(directory)).filter((file) => file.endsWith(suffix));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}
function absent(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return true;
    throw error;
  }
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-p3-e2e-'));
  const application = await electron.launch({
    executablePath: require('electron'),
    args: [desktop],
    env: { ...process.env, BROWSER2D_DATA_DIR: join(directory, 'host') },
  });
  const page = await application.firstWindow();
  const hostPid = await application.evaluate(() => process.pid);
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-state', 'connected');
  const hostSnapshot = await page.evaluate(async () => window.browser2d?.work.getSnapshot());
  if (!hostSnapshot?.ok) throw new Error('Host worker snapshot missing');
  const hostWorkerPid = hostSnapshot.value.workerPid;
  return {
    directory,
    application,
    async close() {
      if (!absent(hostPid)) await application.close().catch(() => undefined);
      await expect.poll(() => absent(hostWorkerPid), { timeout: 17_000 }).toBe(true);
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function opened(
  application: ElectronApplication,
  dataDir: string,
  fixture?: ControlledFixture,
) {
  const worker = await workerHarness(application, { dataDir, fixture });
  await worker.evaluate((host) => host.ready());
  return worker;
}

for (const scenario of ['acquire-result-lost', 'hold-release'] as const) {
  test(`worker crash during ${scenario} reconciles owned resources without execution replay`, async () => {
    const context = await setup();
    const dataDir = join(context.directory, 'work');
    const fixture = join(context.directory, 'fixture');
    let worker: Harness | undefined;
    try {
      worker = await opened(context.application, dataDir, { directory: fixture, scenario });
      const device = await createDevice(worker);
      const accepted = await start(worker, device.id);
      const current = worker;
      await expect
        .poll(() => files(fixture, scenario === 'acquire-result-lost' ? '.created' : '.release'), {
          timeout: 10_000,
        })
        .toHaveLength(1);
      const before = await snapshot(current);
      expect(before.runs.find((run) => run.id === accepted.runId)?.state).toBe(
        scenario === 'acquire-result-lost' ? 'starting' : 'stopping',
      );
      const executions = await files(fixture, '.execute');
      const pid = before.workerPid;
      await current.evaluate((host) => host.kill());
      await expect.poll(() => absent(pid)).toBe(true);
      expect(await files(join(dataDir, 'controlled-resources'))).toHaveLength(1);
      worker = await opened(context.application, dataDir);
      const recovered = worker;
      await expect.poll(async () => (await snapshot(recovered)).resources.length).toBe(0);
      expect((await snapshot(recovered)).runs.find((run) => run.id === accepted.runId)?.state).toBe(
        'interrupted',
      );
      expect(await files(join(dataDir, 'controlled-resources'))).toEqual([]);
      expect(await files(fixture, '.execute')).toEqual(executions);
      expect(await start(recovered, device.id, accepted.commandId)).toEqual(accepted);
      expect((await snapshot(recovered)).runs).toHaveLength(1);
      expect((await recovered.evaluate((host) => host.close())).code).toBe(0);
    } finally {
      await worker?.evaluate((host) => host.kill()).catch(() => undefined);
      await context.close();
    }
  });
}

test('borrowed fixture survives cancellation and heartbeat loss stops a live executor', async () => {
  const context = await setup();
  let worker: Harness | undefined;
  try {
    const borrowedDir = join(context.directory, 'borrowed');
    worker = await opened(context.application, join(context.directory, 'borrowed-db'), {
      directory: borrowedDir,
      scenario: 'borrowed',
    });
    const device = await createDevice(worker);
    const accepted = await start(worker, device.id);
    await expect.poll(() => files(borrowedDir, '.execute')).toHaveLength(1);
    expect((await cancel(worker, accepted.runId)).ok).toBe(true);
    const borrowed = worker;
    await expect.poll(async () => (await snapshot(borrowed)).runs[0]?.state).toBe('cancelled');
    expect((await borrowed.evaluate((host) => host.close())).code).toBe(0);
    await expect(access(join(borrowedDir, 'borrowed-resource'))).resolves.toBeUndefined();
    const fixture = join(context.directory, 'lease');
    const dataDir = join(context.directory, 'lease-db');
    worker = await opened(context.application, dataDir, {
      directory: fixture,
      scenario: 'hold-execute',
    });
    const leased = worker;
    const secondDevice = await createDevice(leased);
    await start(leased, secondDevice.id);
    await expect.poll(() => files(fixture, '.execute')).toHaveLength(1);
    const pid = (await snapshot(leased)).workerPid;
    await leased.evaluate((host) => host.pauseHeartbeat());
    await expect
      .poll(async () => (await snapshot(leased)).runs[0]?.state, { timeout: 8000 })
      .toBe('stopping');
    await writeFile(join(fixture, 'continue-execute'), 'continue');
    expect(await leased.evaluate((host) => host.exit())).toBe(1);
    await expect.poll(() => absent(pid)).toBe(true);
    expect(await files(join(dataDir, 'controlled-resources'))).toEqual([]);
  } finally {
    await worker?.evaluate((host) => host.kill()).catch(() => undefined);
    await context.close();
  }
});

test('cleanup refusal retains device and page reservations, and restart only reconciles', async () => {
  const context = await setup();
  const dataDir = join(context.directory, 'work');
  let worker: Harness | undefined;
  try {
    worker = await opened(context.application, dataDir, {
      directory: join(context.directory, 'fixture'),
      scenario: 'cleanup-fails',
    });
    const blocked = worker;
    const current = resultSchema(settingsViewSchema).parse(
      await blocked.evaluate((host) => host.request({ type: 'business', method: 'settings.get' })),
    );
    if (!current.ok) throw new Error(current.error.code);
    await blocked.evaluate(
      (host, revision) =>
        host.request({
          type: 'business',
          method: 'settings.commit',
          input: {
            expectedRevision: revision,
            values: {
              browser: { mode: 'launch', executablePath: '', headless: true },
              viewportWidth: 1280,
              viewportHeight: 800,
              pageCount: 4,
            },
          },
        }),
      current.value.revision,
    );
    const firstDevice = await createDevice(blocked, 'blocked');
    const first = await start(blocked, firstDevice.id);
    await expect
      .poll(async () => (await snapshot(blocked)).resources[0]?.failure, { timeout: 8000 })
      .toBe('CLEANUP_FAILED');
    expect((await snapshot(blocked)).runs.find((run) => run.id === first.runId)?.state).toBe(
      'stopping',
    );
    const conflict = await blocked.evaluate(
      (host, input) => host.request({ type: 'request', method: 'start', input }),
      { commandId: randomUUID(), deviceId: firstDevice.id },
    );
    expect(conflict).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const second = await start(blocked, (await createDevice(blocked, 'queued')).id);
    await expect
      .poll(
        async () => (await snapshot(blocked)).runs.find((run) => run.id === second.runId)?.state,
      )
      .toBe('queued');
    await blocked.evaluate((host) => host.kill());
    worker = await opened(context.application, dataDir);
    const recovered = worker;
    await expect.poll(async () => (await snapshot(recovered)).resources.length).toBe(0);
    expect((await snapshot(recovered)).runs.every((run) => run.state === 'interrupted')).toBe(true);
  } finally {
    await worker?.evaluate((host) => host.kill()).catch(() => undefined);
    await context.close();
  }
});

for (const phase of ['acquire', 'execute', 'release'] as const) {
  test(`portable uncooperative ${phase} cannot produce a clean shutdown acknowledgment`, async () => {
    const context = await setup();
    let worker: Harness | undefined;
    try {
      const dataDir = join(context.directory, 'work');
      const fixture = join(context.directory, 'fixture');
      worker = await opened(context.application, dataDir, {
        directory: fixture,
        scenario: `hold-${phase}`,
      });
      await start(worker, (await createDevice(worker)).id);
      await expect.poll(() => files(fixture, `.${phase}`), { timeout: 10_000 }).toHaveLength(1);
      const pid = (await snapshot(worker)).workerPid;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        worker.evaluate((host) => host.close()),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error('Shutdown exceeded the cooperative and confirmation budgets')),
            16_000,
          );
        }),
      ]).finally(() => clearTimeout(deadline));
      expect(result.code).toBe(1);
      expect(result.response).toBeNull();
      await expect.poll(() => absent(pid)).toBe(true);
      expect(await files(join(dataDir, 'controlled-resources'))).toHaveLength(
        phase === 'acquire' ? 0 : 1,
      );
    } finally {
      await worker?.evaluate((host) => host.kill()).catch(() => undefined);
      await context.close();
    }
  });
}

test('host death leaves interrupted work that a new application cleans without replay', async () => {
  const context = await setup();
  const dataDir = join(context.directory, 'work');
  const fixture = join(context.directory, 'fixture');
  let recovery: ElectronApplication | undefined;
  try {
    const worker = await opened(context.application, dataDir, {
      directory: fixture,
      scenario: 'hold-execute',
    });
    const accepted = await start(worker, (await createDevice(worker)).id);
    await expect.poll(() => files(fixture, '.execute')).toHaveLength(1);
    const pid = (await snapshot(worker)).workerPid;
    const hostPid = await context.application.evaluate(() => process.pid);
    process.kill(hostPid, 'SIGKILL');
    await expect.poll(() => absent(hostPid), { timeout: 5000 }).toBe(true);
    await expect.poll(() => absent(pid), { timeout: 17_000 }).toBe(true);
    expect(await files(join(dataDir, 'controlled-resources'))).toHaveLength(1);
    recovery = await electron.launch({
      executablePath: require('electron'),
      args: [desktop],
      env: { ...process.env, BROWSER2D_DATA_DIR: dataDir },
    });
    const page = await recovery.firstWindow();
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-state', 'connected');
    await expect.poll(() => files(join(dataDir, 'controlled-resources'))).toEqual([]);
    const result = await page.evaluate(async () => window.browser2d?.work.getSnapshot());
    expect(result?.ok && result.value.runs.find((run) => run.id === accepted.runId)?.state).toBe(
      'interrupted',
    );
    expect(await files(fixture, '.execute')).toHaveLength(1);
  } finally {
    await recovery?.close().catch(() => undefined);
    await context.close();
  }
});

test('an uninitialized child expires and a live stale owner blocks startup without being signaled', async () => {
  const context = await setup();
  let worker: Harness | undefined;
  try {
    const unauthorized = join(context.directory, 'unauthorized');
    worker = await workerHarness(context.application, { dataDir: unauthorized, initialize: false });
    expect(await worker.evaluate((host) => host.exit())).toBe(1);
    await expect(access(join(unauthorized, 'data.db'))).rejects.toMatchObject({ code: 'ENOENT' });
    const blocked = join(context.directory, 'blocked');
    const directory = join(blocked, 'worker-owners');
    await mkdir(directory, { recursive: true });
    const nonce = randomUUID();
    const path = join(directory, `${nonce}.json`);
    const record = JSON.stringify({
      format: 1,
      hostPid: process.pid,
      pid: process.pid,
      ownerNonce: nonce,
    });
    await writeFile(path, record);
    const child = spawn(require('electron'), [desktop, '--worker-only'], {
      env: { ...process.env, BROWSER2D_DATA_DIR: blocked },
      stdio: 'ignore',
    });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Blocked startup did not exit'));
      }, 10_000);
      child.on('error', reject);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    expect(code).toBe(1);
    expect(absent(process.pid)).toBe(false);
    expect(await readFile(path, 'utf8')).toBe(record);
    await expect(access(join(blocked, 'data.db'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await worker?.evaluate((host) => host.kill()).catch(() => undefined);
    await context.close();
  }
});

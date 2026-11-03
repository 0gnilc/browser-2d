import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, utilityProcess } from 'electron';
import type { Result } from '@browser-2d/contracts/public';
import type { SessionFingerprint } from '@browser-2d/contracts/host';
import { launchDataService } from '../main/data-service-client';
import { createTaskCoordinator } from '../main/task-coordinator';
import { superviseTask } from '../main/task-supervisor';
import { isolatedProcessEnvironment } from '../main/isolated-process-environment';
import type { BrowserPlatform } from '../main/browser-platforms/adspower';
function value<T>(result: Result<T>): T {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}
async function until(check: () => Promise<boolean> | boolean, label: string) {
  const deadline = Date.now() + 20_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await delay(10);
  }
}
export async function verifyDataServiceCrash(directory: string, runtime: string) {
  const root = join(directory, 'data-service-crash');
  await mkdir(root, { recursive: true });
  const sessions = new Map<string, SessionFingerprint>();
  const platform: BrowserPlatform = {
    inspect: async (profileId) =>
      sessions.has(profileId)
        ? { kind: 'active', endpoint: sessions.get(profileId)?.endpoint ?? null }
        : { kind: 'inactive' },
    async start(profileId) {
      const id = randomUUID();
      const session = { endpoint: `ws://127.0.0.1:1/devtools/browser/${id}`, browserTargetId: id };
      sessions.set(profileId, session);
      return { kind: 'opened', session };
    },
    async closeOwned({ profileId, session }) {
      assert.equal(sessions.get(profileId)?.endpoint, session.endpoint);
      sessions.delete(profileId);
      return { kind: 'closed', session };
    },
  };
  let behavior = 'cards-hold';
  let forks = 0;
  let coordinator: ReturnType<typeof createTaskCoordinator> | undefined;
  let closedAllGates = false;
  function open() {
    return launchDataService({
      dataPath: join(root, 'app.sqlite'),
      entry: join(runtime, 'verification/application-data-service.cjs'),
      nativeBinding: app.isPackaged ? undefined : process.env.BROWSER2D_NATIVE_BINDING,
      onChanged() {},
      onUnavailable() {
        coordinator?.unavailable();
        closedAllGates = coordinator?.live.every((entry) => entry.gate !== 'open') ?? false;
      },
    });
  }
  let data = open();
  const capabilities = {
    ownershipDirectory: join(root, 'execution-owners'),
    connection: async () => ({ apiBaseUrl: 'http://127.0.0.1:1', apiKey: 'isolated-only' }),
    changed() {},
    platform: () => platform,
    spawn(task: Parameters<typeof superviseTask>[2]) {
      forks++;
      const entry = join(runtime, 'verification/card-worker.cjs');
      return superviseTask(
        utilityProcess.fork(entry, [behavior], { env: isolatedProcessEnvironment('verification') }),
        entry,
        task,
      );
    },
  };
  try {
    await data.ready;
    coordinator = createTaskCoordinator({ ...capabilities, data });
    await coordinator.recover();
    const browsers = [];
    for (const profileId of ['selected', 'peer', 'queued'])
      browsers.push(
        value(
          await data.request('browsers.create', {
            provider: 'adspower',
            profileId,
            name: profileId,
            account: 'snapshot-input',
            amount: '0.29',
            notes: '',
          }),
        ),
      );
    value(
      await data.request('cards.importText', {
        text: ['A', 'B'].map((number) => `${number}|01|2030|000|||||||`).join('\n'),
      }),
    );
    for (const browser of browsers) value(await coordinator.start({ browserId: browser.id }));
    await until(
      async () =>
        value(await data.request('cards.list', { page: 1, pageSize: 20 })).items.every(
          (card) => card.status === 'processing' && card.extra === 'controlled-committed',
        ),
      'two current Cards committed before DataService crash',
    );
    assert.equal(forks, 2);
    const pid = data.pid;
    assert(pid);
    process.kill(pid, 'SIGKILL');
    await data.exit;
    assert(closedAllGates, 'DataService death closes every source gate synchronously');
    await until(
      () =>
        (coordinator?.live.every((entry) => typeof entry.evidence?.exitedAt === 'number') ??
          false) &&
        sessions.size === 0,
      'live execution exit and environment close without DataService',
    );
    const proofs = coordinator.live.map((entry) => ({
      gate: entry.gate,
      exited: !!entry.evidence?.exitedAt,
    }));
    data = open();
    await data.ready;
    coordinator = createTaskCoordinator({ ...capabilities, data });
    await coordinator.recover();
    assert.equal(
      value(await data.request('tasks.list', undefined)).length,
      0,
      'Old queued work cancels and old claims release after proof',
    );
    assert.equal(forks, 2, 'Replacement DataService does not resume old work');
    const interrupted = value(await data.request('cards.list', { page: 1, pageSize: 20 })).items;
    assert(
      interrupted.every(
        (card) =>
          card.status === 'pending' &&
          card.amount === '1.00' &&
          card.extra === 'controlled-committed' &&
          card.inputLocked,
      ),
    );
    assert(
      value(await data.request('browsers.list', undefined)).every((browser) => browser.count === 0),
    );
    const [selected] = browsers;
    assert(selected);
    behavior = 'cards';
    value(await coordinator.start({ browserId: selected.id }));
    await until(
      async () => value(await data.request('tasks.list', undefined)).length === 0,
      'deliberate reclaim after DataService restart',
    );
    assert(
      value(await data.request('cards.list', { page: 1, pageSize: 20 })).items.every(
        (card) => card.status === 'processed' && card.amount === '1.00',
      ),
    );
    assert.equal(
      value(await data.request('browsers.list', undefined)).find(
        (browser) => browser.id === selected.id,
      )?.count,
      2,
    );
    await coordinator.shutdown();
    return {
      behavior: 'data-service-crash-gates-exit-close-restart-reclaim',
      result: 'passed',
      proofs,
      preservedAmount: '1.00',
      receiptReplayAddsNothing: true,
      automaticResume: false,
    };
  } finally {
    coordinator?.unavailable();
    await data.close();
  }
}

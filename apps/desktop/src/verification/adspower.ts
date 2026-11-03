import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { app, safeStorage, utilityProcess } from 'electron';
import type { Result, BrowserId } from '@browser-2d/contracts/public';
import { createCredentialVault } from '../platform/credentials';
import { createSettingsCoordinator } from '../main/settings-coordinator';
import { launchDataService } from '../main/data-service-client';
import { createTaskCoordinator } from '../main/task-coordinator';
import { launchTask, superviseTask, type TaskLifecycle } from '../main/task-supervisor';
import { isolatedProcessEnvironment } from '../main/isolated-process-environment';
import {
  verificationDirectory,
  verificationApplicationStorage,
  verificationEntries,
} from './storage';
import {
  createAdsPowerClient,
  type BrowserPlatform,
  type CloseCheckpoint,
} from '../main/browser-platforms/adspower';
const optionsSchema = z.strictObject({
  reportPath: z.string(),
  apiBaseUrl: z.literal('http://127.0.0.1:50325'),
  profiles: z
    .tuple([
      z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-zA-Z0-9_-]+$/),
      z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-zA-Z0-9_-]+$/),
    ])
    .refine(([a, b]) => a !== b),
  clientVersion: z.string().min(1).max(100).optional(),
  credentialService: z.literal('io.github.0gnilc.browser2d.development.adspower'),
  credentialAccount: z.literal('browser-2d-development'),
});
function value<T>(result: Result<T>): T {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}
async function until(check: () => Promise<boolean> | boolean, description: string) {
  const deadline = Date.now() + 90_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(description);
    await delay(50);
  }
}
async function browserProduct(endpoint: string) {
  return new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(endpoint);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('Browser version unavailable'));
    }, 10_000);
    ws.addEventListener('open', () =>
      ws.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' })),
    );
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Browser version unavailable'));
    });
    ws.addEventListener('message', ({ data }) => {
      try {
        const response = z
          .object({ id: z.literal(1), result: z.object({ product: z.string() }) })
          .parse(JSON.parse(String(data)));
        clearTimeout(timer);
        ws.close();
        resolve(response.result.product);
      } catch {
        clearTimeout(timer);
        ws.close();
        reject(new Error('Browser version unavailable'));
      }
    });
  });
}
export async function verifyAdsPower(raw: unknown) {
  const options = optionsSchema.parse(raw);
  const directory = await verificationDirectory(
    dirname(resolve(options.reportPath)),
    'browser-2d-adspower-',
  );
  assert.equal(resolve(options.reportPath), join(directory, 'report.json'));
  await verificationApplicationStorage(join(directory, 'data'));
  await verificationEntries(directory, [
    ['report.json', 'file'],
    ['credentials.enc', 'file'],
  ]);
  if (process.platform !== 'darwin') throw new Error('The configured credential requires Keychain');
  const result = await promisify(execFile)(
    '/usr/bin/security',
    [
      'find-generic-password',
      '-s',
      options.credentialService,
      '-a',
      options.credentialAccount,
      '-w',
    ],
    { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, maxBuffer: 8192 },
  );
  const apiKey = result.stdout.trim();
  assert(apiKey);
  const closeProtocolCheckpoints: {
    attempt: number;
    at: number;
    checkpoint: CloseCheckpoint;
  }[] = [];
  const platform = createAdsPowerClient({
    apiBaseUrl: options.apiBaseUrl,
    apiKey,
    onCloseCheckpoint(attempt, checkpoint) {
      if (closeProtocolCheckpoints.length < 1024)
        closeProtocolCheckpoints.push({ attempt, at: performance.now(), checkpoint });
    },
  });
  const products = new Set<string>();
  const versionReads: Promise<void>[] = [];
  const providerClosedAt = new Map<string, number>();
  const closeAttempts: {
    profile: 'selected' | 'peer';
    startedAt: number;
    finishedAt?: number;
    outcome?: Awaited<ReturnType<BrowserPlatform['closeOwned']>>['kind'];
  }[] = [];
  const observedPlatform: BrowserPlatform = {
    inspect: platform.inspect,
    async start(profileId) {
      const opened = await platform.start(profileId);
      if (opened.kind === 'opened')
        versionReads.push(
          browserProduct(opened.session.endpoint)
            .then((product) => {
              products.add(product);
            })
            .catch(() => undefined),
        );
      return opened;
    },
    async closeOwned(input) {
      const attempt: (typeof closeAttempts)[number] = {
        profile: input.profileId === options.profiles[0] ? 'selected' : 'peer',
        startedAt: performance.now(),
      };
      closeAttempts.push(attempt);
      const closed = await platform.closeOwned(input);
      attempt.finishedAt = performance.now();
      attempt.outcome = closed.kind;
      if (closed.kind === 'closed') providerClosedAt.set(input.profileId, performance.now());
      return closed;
    },
  };
  async function activeProfiles() {
    await delay(1100);
    const response = await fetch(new URL('/api/v1/browser/local-active', options.apiBaseUrl), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    assert(response.ok);
    const parsed = z
      .object({
        code: z.literal(0),
        data: z.object({
          list: z.array(
            z.object({ user_id: z.string().optional(), profile_id: z.string().optional() }),
          ),
        }),
      })
      .parse(await response.json());
    return parsed.data.list
      .map((entry) => entry.profile_id ?? entry.user_id)
      .filter((id): id is string => typeof id === 'string');
  }
  const originalProfiles = await activeProfiles();
  for (const profileId of options.profiles)
    assert.equal(
      (await platform.inspect(profileId)).kind,
      'inactive',
      'Dedicated profiles must initially be inactive',
    );
  const vault = createCredentialVault({
    path: join(directory, 'credentials.enc'),
    encryption: {
      available: () => safeStorage.isAsyncEncryptionAvailable(),
      encrypt: (secret) => safeStorage.encryptStringAsync(secret),
      decrypt: async (bytes) => (await safeStorage.decryptStringAsync(bytes)).result,
    },
  });
  const require = createRequire(join(app.getAppPath(), 'package.json'));
  const runtime = dirname(require.resolve('@browser-2d/backend/browser-worker'));
  let tasks: ReturnType<typeof createTaskCoordinator> | undefined;
  function open(controlled: boolean) {
    return launchDataService({
      dataPath: join(directory, 'data', 'app.sqlite'),
      ...(controlled ? { entry: join(runtime, 'verification/application-data-service.cjs') } : {}),
      nativeBinding: app.isPackaged ? undefined : process.env.BROWSER2D_NATIVE_BINDING,
      onChanged() {},
      onUnavailable() {
        tasks?.unavailable();
      },
    });
  }
  let data = open(false);
  const report: Record<string, unknown> = {
    result: 'FAILED',
    phase: 'data-ready',
    closeAttempts,
    closeProtocolCheckpoints,
    packaged: app.isPackaged,
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    profiles: options.profiles,
    adspowerClientVersion: {
      value: options.clientVersion ?? null,
      source: options.clientVersion
        ? 'Operator supplied preflight, not queried by this run'
        : 'Not observed by this run',
    },
  };
  let failure: unknown;
  try {
    await data.ready;
    report.phase = 'settings-save';
    let settings = createSettingsCoordinator(data, vault);
    assert.equal(
      value(
        await settings.save({
          values: {
            apiBaseUrl: options.apiBaseUrl,
            maxConcurrentTasks: 2,
            sidebarCollapsed: false,
          },
          apiKey: { kind: 'replace', value: apiKey },
          expectedRevision: 0,
        }),
      ).kind,
      'saved',
    );
    const production: {
      forks: number;
      baiduVerified: boolean;
      settled: { at: number; state: TaskLifecycle['kind']; cleanupDeadlineExceeded: boolean }[];
    } = { forks: 0, baiduVerified: false, settled: [] };
    report.productionObservations = production;
    tasks = createTaskCoordinator({
      data,
      ownershipDirectory: join(directory, 'data', 'execution-owners'),
      connection: settings.connection,
      platform: () => observedPlatform,
      changed() {},
      spawn(task) {
        production.forks++;
        return launchTask({
          ...task,
          settled(state) {
            production.settled.push({
              at: performance.now(),
              state: state.kind,
              cleanupDeadlineExceeded:
                state.kind === 'blocked' && state.reason === 'Task cleanup deadline exceeded',
            });
            task.settled?.(state);
          },
          observe(event) {
            task.observe?.(event);
            if (event.kind === 'verified') production.baiduVerified = true;
          },
        });
      },
    });
    report.phase = 'production-recover';
    await tasks.recover();
    report.phase = 'production-seed';
    const browsers = [];
    for (const profileId of options.profiles)
      browsers.push(
        value(
          await data.request('browsers.create', {
            provider: 'adspower',
            profileId,
            name: 'Dedicated synthetic verification',
            account: 'synthetic-only',
            amount: '0.29',
            notes: '',
          }),
        ),
      );
    const [selected, peer] = browsers;
    assert(selected && peer);
    value(
      await data.request('cards.importText', {
        text: ['A', 'B', 'C'].map((id) => `${id}|01|2030|000|||||||`).join('\n'),
      }),
    );
    report.phase = 'production-start';
    value(await tasks.start({ browserId: selected.id }));
    report.phase = 'production-cleanup';
    await until(async () => {
      const remaining = value(await data.request('tasks.list', undefined));
      report.productionTasks = remaining.map((task) => ({
        state: task.state,
        environment: task.environment.kind,
      }));
      return remaining.length === 0;
    }, 'Production sequential Card loop did not clean up');
    report.phase = 'production-card-dto';
    const first = value(await data.request('cards.list', { page: 1, pageSize: 20 })).items;
    report.productionCards = first.map((card) => ({
      seed: ['A', 'B', 'C'].includes(card.number) ? card.number : 'unexpected',
      status: card.status,
      zeroAmount: card.amount === '0.00',
      expectedProcessor: card.lastResult?.processor === 'baidu-check',
      verificationResult: card.lastResult?.kind === 'verification',
    }));
    report.phase = 'production-one-worker';
    assert.equal(production.forks, 1);
    report.phase = 'production-navigation';
    assert(production.baiduVerified);
    report.phase = 'production-card-order';
    assert.deepEqual(
      first.map((card) => card.number),
      ['A', 'B', 'C'],
    );
    report.phase = 'production-card-results';
    assert(
      first.every(
        (card) =>
          card.status === 'processed' &&
          card.amount === '0.00' &&
          card.lastResult?.processor === 'baidu-check' &&
          card.lastResult.kind === 'verification',
      ),
    );
    report.phase = 'production-browser-count';
    assert.equal(
      value(await data.request('browsers.list', undefined)).find(
        (browser) => browser.id === selected.id,
      )?.count,
      3,
    );
    report.production = {
      sequentialCards: ['A', 'B', 'C'],
      oneWorker: true,
      baiduNavigation: true,
      noImplicitAmount: true,
      exactCleanup: true,
    };
    report.phase = 'production-shutdown';
    await tasks.shutdown();
    await data.close();

    report.phase = 'controlled-data-ready';
    data = open(true);
    await data.ready;
    settings = createSettingsCoordinator(data, vault);
    const pulses = new Map<BrowserId, number>();
    const verified = new Set<BrowserId>();
    const hold = new Set<BrowserId>([selected.id, peer.id]);
    const processing = new Map<BrowserId, string>();
    tasks = createTaskCoordinator({
      data,
      ownershipDirectory: join(directory, 'data', 'execution-owners'),
      connection: settings.connection,
      platform: () => observedPlatform,
      changed() {},
      spawn(task) {
        const entry = join(runtime, 'verification/card-worker.cjs');
        const child = utilityProcess.fork(
          entry,
          [hold.has(task.browser.id) ? 'baidu-hold' : 'baidu-cards'],
          { env: isolatedProcessEnvironment('verification') },
        );
        return superviseTask(child, entry, {
          ...task,
          async request(request, sequence) {
            const reply = await task.request(request, sequence);
            if (
              reply.kind === 'next_card' &&
              reply.result.ok &&
              reply.result.value.kind === 'claimed'
            )
              processing.set(task.browser.id, reply.result.value.claim.card.number);
            return reply;
          },
          observe(event) {
            task.observe?.(event);
            if (event.kind === 'verified') verified.add(task.browser.id);
            if (event.kind === 'pulse')
              pulses.set(task.browser.id, (pulses.get(task.browser.id) ?? 0) + 1);
          },
        });
      },
    });
    report.phase = 'controlled-recover-and-seed';
    await tasks.recover();
    value(
      await data.request('cards.importText', {
        text: ['D', 'E', 'F'].map((id) => `${id}|01|2030|000|||||||`).join('\n'),
      }),
    );
    report.phase = 'controlled-start';
    const selectedTask = value(await tasks.start({ browserId: selected.id }));
    value(await tasks.start({ browserId: peer.id }));
    report.phase = 'controlled-committed-cards';
    await until(
      async () =>
        verified.size === 2 &&
        value(await data.request('cards.list', { page: 1, pageSize: 20 })).items.filter(
          (card) =>
            card.status === 'processing' &&
            card.amount === '1.00' &&
            card.extra === 'controlled-committed',
        ).length === 2,
      'Both dedicated environments must hold committed current Cards',
    );
    report.phase = 'selected-stop';
    const evidence = tasks.live.find((entry) => entry.taskId === selectedTask.id)?.evidence;
    assert(evidence);
    const acceptedStopAt = performance.now();
    const stopping = tasks.stop({ browserId: selected.id });
    assert.equal(tasks.live.find((entry) => entry.taskId === selectedTask.id)?.gate, 'stopping');
    assert.equal(value(await stopping).kind, 'stopped');
    assert(
      [
        evidence.gateClosedAt,
        evidence.exitedAt,
        providerClosedAt.get(selected.profileId),
        evidence.releasedAt,
      ].every((time) => typeof time === 'number'),
    );
    report.phase = 'peer-progress';
    const beforePeer = pulses.get(peer.id) ?? 0;
    await until(
      () => (pulses.get(peer.id) ?? 0) > beforePeer,
      'Peer page must continue after selected stop',
    );
    report.phase = 'selected-requeue-and-peer-claim';
    const afterStop = value(await data.request('cards.list', { page: 1, pageSize: 20 })).items;
    assert.equal(
      afterStop.find((card) => card.number === processing.get(selected.id))?.status,
      'pending',
    );
    assert.equal(
      afterStop.find((card) => card.number === processing.get(peer.id))?.status,
      'processing',
    );
    report.phase = 'data-service-progress';
    const free = afterStop.find((card) => card.number === 'F');
    assert(free);
    value(
      await data.request('cards.update', {
        id: free.id,
        notes: 'DataService committed while peer browser remained active',
      }),
    );
    report.stop = {
      clock: 'Main performance.now milliseconds',
      origin: 'Main accepted stop call, not physical UI click',
      acceptedStopAt,
      sourceGateClosedAt: evidence.gateClosedAt,
      executionExitedAt: evidence.exitedAt,
      providerConfirmedInactiveAt: providerClosedAt.get(selected.profileId),
      claimReleasedAt: evidence.releasedAt,
      peerPageProgress: true,
      dataServiceProgress: true,
      unfinishedCardRequeued: true,
      committedAmountRetained: '1.00',
    };
    report.phase = 'peer-stop';
    assert.equal(value(await tasks.stop({ browserId: peer.id })).kind, 'stopped');
    report.phase = 'controlled-reclaim';
    hold.clear();
    value(await tasks.start({ browserId: selected.id }));
    await until(
      async () => value(await data.request('tasks.list', undefined)).length === 0,
      'Deliberate reclaim did not complete and clean up',
    );
    report.phase = 'controlled-final-results';
    const final = value(await data.request('cards.list', { page: 1, pageSize: 20 })).items;
    assert(
      final
        .filter((card) => ['D', 'E', 'F'].includes(card.number))
        .every((card) => card.status === 'processed' && card.amount === '1.00'),
    );
    assert.equal(
      value(await data.request('browsers.list', undefined)).find(
        (browser) => browser.id === selected.id,
      )?.count,
      6,
    );
    report.controlledProcessor = {
      baiduNavigation: true,
      liveAddAndPatch: true,
      retainedCommits: true,
      reclaimReceiptDedupe: true,
      noCardValuesSentToBaidu: true,
    };
    report.phase = 'final-shutdown';
    await tasks.shutdown();
    report.phase = 'dedicated-profiles-inactive';
    for (const profileId of options.profiles)
      assert.equal((await platform.inspect(profileId)).kind, 'inactive');
    report.phase = 'original-sessions-preserved';
    const finalProfiles = new Set(await activeProfiles());
    assert(originalProfiles.every((id) => finalProfiles.has(id)));
    report.phase = 'browser-version';
    await Promise.all(versionReads);
    assert(products.size > 0, 'An actual browser version must be observed');
    report.originalSessionsPreserved = true;
    report.originalOpenCount = originalProfiles.length;
    report.chromeProducts = [...products];
    report.phase = 'complete';
    report.result = 'VERIFIED';
  } catch (error) {
    failure = error;
    report.failure = {
      errorType:
        error instanceof assert.AssertionError
          ? 'AssertionError'
          : error instanceof z.ZodError
            ? 'ValidationError'
            : error instanceof TypeError
              ? 'TypeError'
              : error instanceof Error
                ? 'Error'
                : 'Unknown',
      liveTasks: tasks?.live.map((task) => ({
        gate: task.gate,
        state: task.state?.kind,
        evidence: { ...task.evidence },
      })),
    };
    report.error =
      'Platform verification did not complete; inspect dedicated task recovery reservations';
  } finally {
    try {
      await tasks?.shutdown();
      report.finalTaskShutdown = 'completed';
    } catch {
      report.finalTaskShutdown = 'blocked';
      report.result = 'BLOCKED';
    }
    try {
      await data.close();
      report.finalDataClose = 'completed';
    } catch {
      report.finalDataClose = 'blocked';
      report.result = 'BLOCKED';
    }
    report.chromeProducts = [...products];
    await writeFile(options.reportPath, JSON.stringify(report, null, 2));
  }
  if (failure || report.result !== 'VERIFIED')
    throw new Error('AdsPower verification failed; inspect the redacted report');
}

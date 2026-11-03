import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { app } from 'electron';
import {
  browserSnapshotSchema,
  taskIdSchema,
  executionNonceSchema,
  businessOperations,
} from '@browser-2d/contracts/host';
import { launchTask } from '../main/task-supervisor';
import { launchDataService } from '../main/data-service-client';
import { createAdsPowerClient } from '../main/browser-platforms/adspower';

const optionsSchema = z.strictObject({
  reportPath: z.string(),
  apiBaseUrl: z.literal('http://127.0.0.1:50325'),
  profiles: z
    .tuple([z.string().regex(/^[a-zA-Z0-9_-]+$/), z.string().regex(/^[a-zA-Z0-9_-]+$/)])
    .refine(([a, b]) => a !== b),
  credentialService: z.literal('io.github.0gnilc.browser2d.development.adspower'),
  credentialAccount: z.literal('browser-2d-development'),
});
export async function verifyAdsPower(raw: unknown) {
  const options = optionsSchema.parse(raw);
  const directory = dirname(resolve(options.reportPath));
  const suffix = relative(tmpdir(), directory);
  assert(
    !isAbsolute(suffix) && !suffix.startsWith('..') && suffix.startsWith('browser-2d-adspower-'),
  );
  assert.equal(resolve(options.reportPath), join(directory, 'report.json'));
  if (process.platform !== 'darwin')
    throw new Error('This development credential reference requires macOS Keychain');
  let apiKey: string;
  try {
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
    apiKey = result.stdout.trim();
    if (!apiKey) throw new Error();
  } catch {
    throw new Error('Development Keychain credential unavailable');
  }
  const client = createAdsPowerClient({ apiBaseUrl: options.apiBaseUrl, apiKey });
  const workers: ReturnType<typeof launchTask>[] = [];
  const environments = options.profiles.map((profile) => client.environment(profile));
  const db = launchDataService({
    dataDir: directory,
    businessPath: join(directory, 'proof.sqlite'),
    execution: 'controlled',
    nativeBinding: app.isPackaged ? undefined : process.env.BROWSER2D_NATIVE_BINDING,
    childEnvironment: { BROWSER2D_ROLE: 'data-service' },
    async onCredentialChallenge(challenge) {
      return { type: 'credential-receipt', kind: 'refused', bootNonce: challenge.bootNonce };
    },
    onSnapshot() {},
    onUnavailable() {},
  });
  let writes = 0;
  async function databaseCommit() {
    const result = businessOperations['devices.create'].result.parse(
      await db.request({
        type: 'business',
        requestId: randomUUID(),
        method: 'devices.create',
        input: { symbol: `adspower-proof-${randomUUID()}`, amount: 0 },
      }),
    );
    assert(result.ok, 'DataService commit failed');
    writes++;
    const rows = businessOperations['devices.list'].result.parse(
      await db.request({
        type: 'business',
        requestId: randomUUID(),
        method: 'devices.list',
        input: undefined,
      }),
    );
    assert(
      rows.ok && rows.value.some((row) => row.id === result.value.id),
      'DataService committed row not visible',
    );
  }
  async function until(check: () => boolean, label: string) {
    const deadline = Date.now() + 60_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(label);
      await delay(50);
    }
  }
  const verified = [false, false];
  const pulses = [0, 0];
  const released = [false, false];
  const report: {
    result: string;
    packaged: boolean;
    runtimeEntries: string[];
    profiles: readonly string[];
    verified: boolean[];
    released: boolean[];
    dataServiceCommits: number;
    peerAliveAfterSelectedStop: boolean;
    cleanup: object[];
    error?: string;
  } = {
    result: 'FAILED',
    packaged: app.isPackaged,
    runtimeEntries: [],
    profiles: options.profiles,
    verified,
    released,
    dataServiceCommits: 0,
    peerAliveAfterSelectedStop: false,
    cleanup: [],
  };
  let failure: unknown;
  try {
    await db.ready;
    await databaseCommit();
    for (const [index, profileId] of options.profiles.entries()) {
      const environment = environments[index];
      assert(environment);
      const now = new Date().toISOString();
      const worker = launchTask({
        taskId: taskIdSchema.parse(randomUUID()),
        executionNonce: executionNonceSchema.parse(randomUUID()),
        browser: browserSnapshotSchema.parse({
          id: index + 1,
          provider: 'adspower',
          profileId,
          name: `Development verification ${index + 1}`,
          account: 'synthetic-test-input',
          amount: 29,
          count: 0,
          status: 'idle',
          notes: '',
          lastError: '',
          createdAt: now,
          updatedAt: now,
        }),
        environment,
        deadlineMs: 30_000,
        fence: databaseCommit,
        async release() {
          released[index] = true;
        },
        async request() {
          throw new Error('No card operations allowed in platform verification');
        },
        observe(event) {
          if (event.kind === 'verified') verified[index] = true;
          if (event.kind === 'pulse') pulses[index] = (pulses[index] ?? 0) + 1;
        },
      });
      workers.push(worker);
      await until(
        () =>
          verified[index] === true ||
          worker.state.kind === 'exited' ||
          worker.state.kind === 'blocked',
        'Navigation confirmation timed out',
      );
      assert.equal(verified[index], true, 'Baidu navigation not confirmed');
    }
    const [selected, peer] = workers;
    assert(selected && peer);
    assert.equal((await selected.stop()).kind, 'exited');
    assert.equal(await client.status(options.profiles[0]), 'Inactive');
    const prior = pulses[1] ?? 0;
    await until(() => (pulses[1] ?? 0) > prior, 'Peer page heartbeat not observed');
    assert.equal(peer.state.kind, 'running');
    await databaseCommit();
    report.peerAliveAfterSelectedStop = true;
    assert.equal((await peer.stop()).kind, 'exited');
    assert.equal(await client.status(options.profiles[1]), 'Inactive');
    report.result = 'VERIFIED';
  } catch (error) {
    failure = error;
    report.error =
      error instanceof assert.AssertionError
        ? 'Verification assertion failed'
        : 'Platform verification did not complete';
  } finally {
    for (const worker of workers) await worker.stop();
    for (const [index, environment] of environments.entries()) {
      let closed: boolean;
      try {
        await environment.close();
        closed = await environment.closed();
      } catch {
        closed = false;
      }
      report.cleanup.push({
        profileId: options.profiles[index],
        startIssued: environment.issued,
        startResolved: environment.startResolved,
        closed,
        workerState: workers[index]?.state.kind ?? 'not-created',
      });
      if (!closed) report.result = 'BLOCKED';
    }
    report.runtimeEntries = workers.map((worker) => worker.entry);
    report.dataServiceCommits = writes;
    try {
      await db.close();
    } catch {
      report.result = 'BLOCKED';
    }
    await writeFile(options.reportPath, JSON.stringify(report, null, 2));
  }
  if (failure || report.result !== 'VERIFIED')
    throw new Error('AdsPower verification failed; inspect the redacted report');
}

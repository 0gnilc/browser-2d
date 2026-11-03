import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { app, utilityProcess } from 'electron';
import { z } from 'zod';
import { sessionFingerprintSchema } from '@browser-2d/contracts/host';
import type { Result } from '@browser-2d/contracts/public';
import { launchDataService } from '../main/data-service-client';
import { createTaskCoordinator } from '../main/task-coordinator';
import { superviseTask } from '../main/task-supervisor';
import { isolatedProcessEnvironment } from '../main/isolated-process-environment';
import { processAbsent, createExecutionOwnership } from '../main/execution-ownership';
import {
  verificationDirectory,
  verificationApplicationStorage,
  verificationEntries,
} from './storage';
import type { BrowserPlatform } from '../main/browser-platforms/adspower';
export const crashPoints = [
  'pre-fork-intent',
  'post-fork-pre-pid',
  'post-pid-pre-db-ack',
  'post-start-intent-pre-response',
  'post-success-sidecar-pre-db-ack',
  'running-current-card',
  'post-release-pre-unlink',
] as const;
const inputSchema = z.strictObject({ directory: z.string(), point: z.enum(crashPoints) });
const reportSchema = z.strictObject({
  point: z.enum(crashPoints),
  mainPid: z.number().int(),
  dataPid: z.number().int(),
});
function value<T>(result: Result<T>): T {
  assert(result.ok, JSON.stringify(result));
  return result.value;
}
async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 20_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await delay(25);
  }
}
function controlledPlatform(directory: string): BrowserPlatform {
  const path = join(directory, 'provider-session.json');
  function current() {
    return existsSync(path)
      ? sessionFingerprintSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
      : null;
  }
  return {
    inspect: async () => {
      const session = current();
      return session ? { kind: 'active', endpoint: session.endpoint } : { kind: 'inactive' };
    },
    async start() {
      const id = 'known-owned-session';
      const session = { endpoint: `ws://127.0.0.1:1/devtools/browser/${id}`, browserTargetId: id };
      writeFileSync(path, JSON.stringify(session), { mode: 0o600 });
      return { kind: 'opened', session };
    },
    async closeOwned({ session }) {
      const actual = current();
      if (actual && actual.endpoint !== session.endpoint)
        return { kind: 'foreign_session', message: 'Replacement session preserved' };
      rmSync(path, { force: true });
      return { kind: 'closed', session };
    },
  };
}
export async function runCrashOwner(raw: unknown) {
  const input = inputSchema.parse(raw);
  const directory = resolve(input.directory);
  const parent = await verificationDirectory(dirname(directory), 'browser-2d-process-');
  assert.equal(directory, join(parent, `crash-${input.point}`));
  await verificationApplicationStorage(directory);
  await verificationEntries(directory, [
    ['provider-session.json', 'file'],
    ['crashed.json', 'file'],
  ]);
  const require = createRequire(join(app.getAppPath(), 'package.json'));
  const runtime = dirname(require.resolve('@browser-2d/backend/browser-worker'));
  const data = launchDataService({
    dataPath: join(input.directory, 'app.sqlite'),
    entry: join(runtime, 'verification/application-data-service.cjs'),
    nativeBinding: app.isPackaged ? undefined : process.env.BROWSER2D_NATIVE_BINDING,
    onChanged() {},
    onUnavailable() {
      tasks?.unavailable();
    },
  });
  function crash(point: string) {
    if (point !== input.point) return;
    if (!data.pid) throw new Error('DataService PID not confirmed');
    writeFileSync(
      join(input.directory, 'crashed.json'),
      JSON.stringify({ point: input.point, mainPid: process.pid, dataPid: data.pid }),
      { mode: 0o600, flush: true },
    );
    process.kill(process.pid, 'SIGKILL');
    for (;;) Math.sqrt(Date.now());
  }
  const tasks = createTaskCoordinator({
    data,
    ownershipDirectory: join(input.directory, 'execution-owners'),
    connection: async () => ({ apiBaseUrl: 'http://127.0.0.1:1', apiKey: 'controlled-only' }),
    changed() {},
    platform: () => controlledPlatform(input.directory),
    checkpoint: crash,
    spawn(task) {
      const entry = join(runtime, 'verification/card-worker.cjs');
      const child = utilityProcess.fork(
        entry,
        [input.point === 'post-release-pre-unlink' ? 'cards' : 'cards-hold'],
        { env: isolatedProcessEnvironment('verification') },
      );
      return superviseTask(child, entry, {
        ...task,
        observe(event) {
          task.observe?.(event);
          if (event.kind === 'pulse') crash('running-current-card');
        },
      });
    },
  });
  await data.ready;
  await tasks.recover();
  const browser = value(
    await data.request('browsers.create', {
      provider: 'adspower',
      profileId: 'controlled-crash-profile',
      name: 'Crash proof',
      account: 'snapshot-input',
      amount: '0.29',
      notes: '',
    }),
  );
  value(await data.request('cards.importText', { text: 'synthetic|01|2030|000|||||||' }));
  value(await tasks.start({ browserId: browser.id }));
}
export async function verifyCrashRecovery(directory: string, runtime: string) {
  const reports: object[] = [];
  for (const point of crashPoints) {
    const root = join(directory, `crash-${point}`);
    await mkdir(root, { recursive: true });
    const args = [
      ...(app.isPackaged ? [] : [app.getAppPath()]),
      `--verify-task-owner=${JSON.stringify({ directory: root, point })}`,
    ];
    const child = spawn(process.execPath, args, {
      env: { ...process.env, BROWSER2D_DATA_DIR: root },
      stdio: 'inherit',
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.notEqual(code, 0, `Main crash fault ${point}`);
    const crashed = reportSchema.parse(
      JSON.parse(await readFile(join(root, 'crashed.json'), 'utf8')),
    );
    assert(processAbsent(crashed.mainPid));
    await until(() => processAbsent(crashed.dataPid), 'old DataService actual absence');
    const ownership = createExecutionOwnership(join(root, 'execution-owners'));
    const witnesses = ownership.list();
    if (point === 'pre-fork-intent' || point === 'post-fork-pre-pid')
      assert.equal(witnesses[0]?.pid, null);
    const data = launchDataService({
      dataPath: join(root, 'app.sqlite'),
      entry: join(runtime, 'verification/application-data-service.cjs'),
      nativeBinding: app.isPackaged ? undefined : process.env.BROWSER2D_NATIVE_BINDING,
      onChanged() {},
      onUnavailable() {
        tasks?.unavailable();
      },
    });
    let tasks: ReturnType<typeof createTaskCoordinator> | undefined;
    let launches = 0;
    try {
      await data.ready;
      tasks = createTaskCoordinator({
        data,
        ownershipDirectory: join(root, 'execution-owners'),
        connection: async () => ({ apiBaseUrl: 'http://127.0.0.1:1', apiKey: 'controlled-only' }),
        changed() {},
        platform: () => controlledPlatform(root),
        spawn(task) {
          launches++;
          const entry = join(runtime, 'verification/card-worker.cjs');
          return superviseTask(
            utilityProcess.fork(entry, ['cards'], {
              env: isolatedProcessEnvironment('verification'),
            }),
            entry,
            task,
          );
        },
      });
      await tasks.recover();
      assert.equal(launches, 0, 'Recovery never resumes old work');
      const active = value(await data.request('tasks.list', undefined));
      const cards = value(await data.request('cards.list', { page: 1, pageSize: 20 })).items;
      const browser = value(await data.request('browsers.list', undefined))[0];
      assert(browser);
      const blocked = [
        'pre-fork-intent',
        'post-fork-pre-pid',
        'post-start-intent-pre-response',
      ].includes(point);
      assert.equal(active.length, blocked ? 1 : 0, point);
      if (blocked) assert.equal(active[0]?.state, 'recovery_required');
      else
        assert(!existsSync(join(root, 'provider-session.json')), 'Exact owned environment closed');
      if (point === 'running-current-card') {
        assert.equal(cards[0]?.status, 'pending');
        assert.equal(cards[0]?.amount, '1.00');
        assert.equal(cards[0]?.extra, 'controlled-committed');
        assert.equal(cards[0]?.inputLocked, true);
        assert.equal(browser.count, 0);
        const witness = witnesses[0];
        assert(witness?.pid && processAbsent(witness.pid));
        value(await tasks.start({ browserId: browser.id }));
        const deadline = Date.now() + 15_000;
        for (;;) {
          if (!value(await data.request('tasks.list', undefined)).length) break;
          if (Date.now() > deadline) throw new Error('Reclaim did not finish');
          await delay(10);
        }
        const reclaimed = value(await data.request('cards.list', { page: 1, pageSize: 20 }))
          .items[0];
        assert.equal(reclaimed?.amount, '1.00');
        assert.equal(reclaimed?.status, 'processed');
        assert.equal(value(await data.request('browsers.list', undefined))[0]?.count, 1);
      }
      if (point === 'post-release-pre-unlink') {
        assert.equal(cards[0]?.status, 'processed');
        assert.equal(browser.count, 1);
        assert.equal(ownership.list().length, 0);
      }
      reports.push({
        behavior: `main-crash-${point}`,
        result: 'passed',
        unknownReservationRetained: blocked,
        automaticResume: false,
        amountReceiptPreserved: point === 'running-current-card',
      });
    } finally {
      tasks?.unavailable();
      await data.close();
    }
  }
  return reports;
}

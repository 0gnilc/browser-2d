import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { expect, it, vi } from 'vitest';
import type { Result } from '@browser-2d/contracts/public';
import { createChromeDriver } from '../src/browser/chrome-driver';
import { ownedEndpoint } from '../src/browser/connection';
import { observeOwnedLifetime, processAbsent } from '../src/browser/process';
import { openBusinessStore } from '../src/storage/open-business-store';
import { createWorkService } from '../src/work/service';

const executable =
  process.env.BROWSER2D_CHROME_EXECUTABLE ?? (await puppeteer.executablePath('chrome'));
const poll = { timeout: 15_000, interval: 25 };
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
function command(socket: string, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const connection = createConnection(socket);
    let output = '';
    connection.on('error', reject);
    connection.on('connect', () => connection.write(message));
    connection.on('data', (data) => {
      output += data.toString();
    });
    connection.on('end', () => resolve(output));
  });
}
function group(pid: number): number {
  return Number(
    execFileSync('/bin/ps', ['-p', String(pid), '-o', 'pgid='], { encoding: 'utf8' }).trim(),
  );
}
function shell(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

it.skipIf(process.platform === 'win32')(
  'holds cold recovery and capacity until the inherited helper exits',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'b2d-family-'));
    const root = join(directory, 'chrome-sessions');
    const socket = join(directory, 'helper.sock');
    const wrapper = join(directory, 'chrome');
    const helper = fileURLToPath(new URL('./fixtures/owned-helper.mjs', import.meta.url));
    await writeFile(
      wrapper,
      `#!/bin/sh\n${shell(process.execPath)} ${shell(helper)} ${shell(socket)} "$@" &\nexec ${shell(executable)} "$@"\n`,
    );
    await chmod(wrapper, 0o700);
    const open = () =>
      openBusinessStore({
        path: join(directory, 'data.db'),
        execution: 'chrome',
        confirmLegacy: async () => true,
        prepareLegacy: async () => {
          throw new Error('No legacy key expected');
        },
      });
    let storage = await open();
    let service: ReturnType<typeof createWorkService> | undefined;
    let helperPid: number | undefined;
    let operationId: string | undefined;
    let observer: Awaited<ReturnType<typeof puppeteer.connect>> | undefined;
    const evidence: Record<string, unknown> = {
      source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceDirty:
        execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
      runtime: process.version,
      platform: process.platform,
      workerPid: process.pid,
      workerGroup: group(process.pid),
    };
    try {
      const settings = value(storage.store.settings.get());
      value(
        storage.store.settings.commit({
          expectedRevision: settings.revision,
          values: {
            ...settings,
            pageCount: 4,
            browser: { mode: 'launch', executablePath: wrapper, headless: true },
          },
        }),
      );
      const deviceId = value(storage.store.devices.create({ symbol: randomUUID() })).id;
      value(storage.work.start({ commandId: randomUUID(), deviceId }));
      const admitted = storage.work.admit();
      if (!admitted) throw new Error('Missing admission');
      const { intent } = admitted;
      const profile = join(root, intent.operationId);
      operationId = intent.operationId;
      evidence.operationId = intent.operationId;
      evidence.profile = profile;
      const driver = createChromeDriver({ root, journal: storage.work.chrome });
      const resource = await driver.acquire(intent, AbortSignal.timeout(15_000));
      storage.work.acquired(intent, resource);
      await expect.poll(() => command(socket, 'ready').catch(() => ''), poll).toMatch(/^\d+$/);
      helperPid = Number(await command(socket, 'ready'));
      observer = await puppeteer.connect({ browserWSEndpoint: await ownedEndpoint(profile) });
      const session = await observer.target().createCDPSession();
      const { processInfo } = await session.send('SystemInfo.getProcessInfo');
      const main = processInfo.find((entry) => entry.type === 'browser');
      if (!main) throw new Error('Missing Chrome main process');
      const processGroups = new Map(
        execFileSync('/bin/ps', ['-ax', '-o', 'pid=,pgid='], { encoding: 'utf8' })
          .trim()
          .split('\n')
          .map((line) => {
            const [pid, pgid] = line.trim().split(/\s+/).map(Number);
            return [pid, pgid];
          }),
      );
      const nativeMembers = processInfo
        .filter((entry) => entry.type !== 'browser' && processGroups.has(entry.id))
        .map((entry) => ({ ...entry, pgid: processGroups.get(entry.id) }));
      evidence.chrome = await observer.version();
      evidence.mainPid = main.id;
      evidence.mainGroup = group(main.id);
      evidence.helperPid = helperPid;
      evidence.helperGroup = group(helperPid);
      evidence.nativeMembers = nativeMembers;
      evidence.attachedState = storage.work.chrome.get(intent.operationId);
      expect(group(main.id)).toBe(main.id);
      expect(group(helperPid)).toBe(main.id);
      expect(group(process.pid)).not.toBe(main.id);
      expect(nativeMembers.length).toBeGreaterThan(0);
      expect(nativeMembers.every((entry) => entry.pgid === main.id)).toBe(true);
      await observer.close();
      await expect.poll(() => processAbsent(main.id), poll).toBe(true);
      expect(processAbsent(helperPid)).toBe(false);
      evidence.mainAbsentWithHelperPresent = true;
      storage.store.close();
      storage = await open();
      const recovered = createChromeDriver({ root, journal: storage.work.chrome });
      const abort = new AbortController();
      const cleanup = recovered.cleanup(intent, abort.signal);
      await delay(100);
      abort.abort();
      expect(await Promise.race([cleanup, delay(250, 'deadline missed')])).toEqual({
        kind: 'blocked',
        reason: 'CLEANUP_FAILED',
      });
      evidence.cancelledCleanup = 'CLEANUP_FAILED';
      await access(profile);
      expect(storage.work.chrome.get(intent.operationId)?.phase).toBe('attached');
      service = createWorkService({
        repository: storage.work,
        driver: recovered,
        publish: () => {},
        policy: { executionTimeoutMs: 30_000, cleanupTimeoutMs: 500, cleanupAttempts: 1 },
      });
      await expect
        .poll(() => service?.snapshot().resources[0]?.failure, poll)
        .toBe('CLEANUP_FAILED');
      expect(service.snapshot().resources).toMatchObject([
        { operationId: intent.operationId, pages: 4 },
      ]);
      const waitingDevice = value(storage.store.devices.create({ symbol: 'waiting' })).id;
      const waiting = value(service.start({ commandId: randomUUID(), deviceId: waitingDevice }));
      await delay(50);
      expect(service.snapshot().runs.find((run) => run.id === waiting.runId)?.state).toBe('queued');
      expect(await command(socket, 'write')).toBe('written');
      expect(await readFile(join(profile, 'late-helper-write'), 'utf8')).toBe('acknowledged');
      evidence.lateHelperWrite = 'acknowledged';
      value(service.cancel({ commandId: randomUUID(), runId: waiting.runId }));
      await expect(service.stop()).rejects.toThrow('cleanup is incomplete');
      service = undefined;
      expect(await command(socket, 'exit')).toBe('exiting');
      await expect.poll(() => processAbsent(helperPid ?? 0), poll).toBe(true);
      await expect
        .poll(() => observeOwnedLifetime({ kind: 'posix-group', pgid: main.id }), poll)
        .toBe('empty');
      evidence.groupEmpty = true;
      expect(await recovered.cleanup(intent, AbortSignal.timeout(7000))).toEqual({
        kind: 'resolved',
      });
      storage.work.resolved(intent.operationId);
      expect(storage.work.snapshot().resources).toEqual([]);
      expect(await readdir(root)).toEqual([]);
      await expect(access(profile)).rejects.toMatchObject({ code: 'ENOENT' });
      evidence.releasedState = storage.work.chrome.get(intent.operationId);
      evidence.resources = storage.work.snapshot().resources;
      evidence.namespaceAbsentBeforeTeardown = true;
    } finally {
      evidence.preTeardownJournal = operationId ? storage.work.chrome.get(operationId) : undefined;
      evidence.preTeardownRootEntries = await readdir(root).catch((error: unknown) =>
        String(error),
      );
      const artifacts =
        process.env.BROWSER2D_FAMILY_EVIDENCE ??
        fileURLToPath(new URL('../../../artifacts/', import.meta.url));
      await mkdir(artifacts, { recursive: true });
      await writeFile(
        join(artifacts, `chrome-family-${process.platform}-${process.arch}.json`),
        JSON.stringify(evidence, null, 2),
      );
      await observer?.close().catch(() => {});
      await command(socket, 'exit').catch(() => {});
      if (helperPid) {
        const pid = helperPid;
        await expect.poll(() => processAbsent(pid), poll).toBe(true);
      }
      await service?.stop().catch(() => {});
      storage.store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);

it.skipIf(process.platform === 'win32').each(['checkpoint', 'publication'] as const)(
  'keeps cleanup authority after a lost spawned %s',
  async (failure) => {
    const directory = await mkdtemp(join(tmpdir(), 'b2d-spawn-'));
    const socket = join(directory, 'helper.sock');
    const root = join(directory, 'chrome-sessions');
    const wrapper = join(directory, 'chrome');
    const helper = fileURLToPath(new URL('./fixtures/owned-helper.mjs', import.meta.url));
    await writeFile(
      wrapper,
      `#!/bin/sh\n${shell(process.execPath)} ${shell(helper)} ${shell(socket)} "$@" &\nexec ${shell(executable)} "$@"\n`,
    );
    await chmod(wrapper, 0o700);
    const storage = await openBusinessStore({
      path: join(directory, 'data.db'),
      execution: 'chrome',
      confirmLegacy: async () => true,
      prepareLegacy: async () => {
        throw new Error('No legacy key expected');
      },
    });
    let observer: Awaited<ReturnType<typeof puppeteer.connect>> | undefined;
    let helperPid: number | undefined;
    try {
      const settings = value(storage.store.settings.get());
      value(
        storage.store.settings.commit({
          expectedRevision: settings.revision,
          values: {
            ...settings,
            browser: { mode: 'launch', executablePath: wrapper, headless: true },
          },
        }),
      );
      const deviceId = value(storage.store.devices.create({ symbol: randomUUID() })).id;
      value(storage.work.start({ commandId: randomUUID(), deviceId }));
      const admission = storage.work.admit();
      if (!admission) throw new Error('Missing admission');
      const { intent } = admission;
      const profile = join(root, intent.operationId);
      const save = storage.work.chrome.save;
      vi.spyOn(storage.work.chrome, 'save').mockImplementation((id, state) => {
        if (failure === 'publication' && state.phase === 'spawned')
          throw new Error('Publication failed');
        save(id, state);
      });
      const driver = createChromeDriver({
        root,
        journal: storage.work.chrome,
        checkpoint: async (stage) => {
          if (stage === 'spawned') throw new Error('Checkpoint lost');
        },
      });
      await expect(driver.acquire(intent, AbortSignal.timeout(15_000))).rejects.toThrow(
        failure === 'publication' ? 'Publication failed' : 'Checkpoint lost',
      );
      const state = storage.work.chrome.get(intent.operationId);
      expect(state).toMatchObject({
        version: 2,
        phase: failure === 'publication' ? 'attempted' : 'spawned',
      });
      if (failure === 'checkpoint')
        expect(state).toMatchObject({
          lifetime: { kind: 'posix-group', pgid: expect.any(Number) },
        });
      await expect.poll(() => command(socket, 'ready').catch(() => ''), poll).toMatch(/^\d+$/);
      helperPid = Number(await command(socket, 'ready'));
      await expect.poll(() => ownedEndpoint(profile).catch(() => ''), poll).toMatch(/^ws:/);
      observer = await puppeteer.connect({ browserWSEndpoint: await ownedEndpoint(profile) });
      const session = await observer.target().createCDPSession();
      const { processInfo } = await session.send('SystemInfo.getProcessInfo');
      const main = processInfo.find((entry) => entry.type === 'browser');
      if (!main) throw new Error('Missing main process');
      const fresh = createChromeDriver({ root, journal: storage.work.chrome });
      if (failure === 'publication') {
        expect(await fresh.cleanup(intent, AbortSignal.timeout(1000))).toEqual({
          kind: 'blocked',
          reason: 'OWNERSHIP_UNCERTAIN',
        });
        expect(processAbsent(main.id)).toBe(false);
      }
      const cleaner = failure === 'publication' ? driver : fresh;
      const abort = new AbortController();
      const cleanup = cleaner.cleanup(intent, abort.signal);
      await expect.poll(() => processAbsent(main.id), poll).toBe(true);
      abort.abort();
      expect(await Promise.race([cleanup, delay(250, 'deadline missed')])).toEqual({
        kind: 'blocked',
        reason: 'CLEANUP_FAILED',
      });
      expect(processAbsent(helperPid)).toBe(false);
      expect(await command(socket, 'write')).toBe('written');
      expect(await readFile(join(profile, 'late-helper-write'), 'utf8')).toBe('acknowledged');
      expect(await command(socket, 'exit')).toBe('exiting');
      await expect
        .poll(() => observeOwnedLifetime({ kind: 'posix-group', pgid: main.id }), poll)
        .toBe('empty');
      expect(await cleaner.cleanup(intent, AbortSignal.timeout(7000))).toEqual({
        kind: 'resolved',
      });
      expect(storage.work.chrome.get(intent.operationId)).toMatchObject({
        version: 2,
        phase: 'released',
        proof: { kind: 'posix-group-empty', pgid: main.id },
      });
      expect(await readdir(root)).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      await observer?.close().catch(() => {});
      await command(socket, 'exit').catch(() => {});
      if (helperPid) {
        const pid = helperPid;
        await expect.poll(() => processAbsent(pid), poll).toBe(true);
      }
      storage.store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);

it.skipIf(process.platform === 'win32')(
  'retains profile and capacity while the final lifetime probe is unknown',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'b2d-unknown-'));
    const root = join(directory, 'chrome-sessions');
    const socket = join(directory, 'helper.sock');
    const wrapper = join(directory, 'chrome');
    const helper = fileURLToPath(new URL('./fixtures/owned-helper.mjs', import.meta.url));
    await writeFile(
      wrapper,
      `#!/bin/sh\n${shell(process.execPath)} ${shell(helper)} ${shell(socket)} "$@" &\nexec ${shell(executable)} "$@"\n`,
    );
    await chmod(wrapper, 0o700);
    const storage = await openBusinessStore({
      path: join(directory, 'data.db'),
      execution: 'chrome',
      confirmLegacy: async () => true,
      prepareLegacy: async () => {
        throw new Error('No legacy key expected');
      },
    });
    let service: ReturnType<typeof createWorkService> | undefined;
    let helperPid: number | undefined;
    const abort = new AbortController();
    try {
      const settings = value(storage.store.settings.get());
      value(
        storage.store.settings.commit({
          expectedRevision: settings.revision,
          values: {
            ...settings,
            pageCount: 4,
            browser: { mode: 'launch', executablePath: wrapper, headless: true },
          },
        }),
      );
      const deviceId = value(storage.store.devices.create({ symbol: randomUUID() })).id;
      value(storage.work.start({ commandId: randomUUID(), deviceId }));
      const admitted = storage.work.admit();
      if (!admitted) throw new Error('Missing admission');
      const { intent } = admitted;
      const profile = join(root, intent.operationId);
      const driver = createChromeDriver({ root, journal: storage.work.chrome });
      storage.work.acquired(intent, await driver.acquire(intent, AbortSignal.timeout(15_000)));
      await expect.poll(() => command(socket, 'ready').catch(() => ''), poll).toMatch(/^\d+$/);
      helperPid = Number(await command(socket, 'ready'));
      const state = storage.work.chrome.get(intent.operationId);
      if (!state || !('lifetime' in state) || state.lifetime.kind !== 'posix-group')
        throw new Error('Missing spawned process group');
      const { lifetime } = state;
      expect(group(helperPid)).toBe(lifetime.pgid);
      expect(group(process.pid)).not.toBe(lifetime.pgid);
      const kill = process.kill.bind(process);
      let groupProbes = 0;
      let allowObservation = false;
      let observedUnknown = () => {};
      let unknownObserved = new Promise<void>((resolve) => {
        observedUnknown = resolve;
      });
      const probes = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
        if (pid === -lifetime.pgid) {
          expect(signal).toBe(0);
          groupProbes++;
          if (groupProbes > 1 && !allowObservation) {
            if (groupProbes === 3) observedUnknown();
            throw Object.assign(new Error('Final observation denied'), { code: 'EPERM' });
          }
        }
        return kill(pid, signal);
      });
      const cleanup = driver.cleanup(intent, abort.signal);
      const outcome = await Promise.race([
        unknownObserved.then(() => 'waiting'),
        cleanup.then(() => 'settled'),
      ]);
      expect(processAbsent(lifetime.pgid)).toBe(true);
      expect(processAbsent(helperPid)).toBe(false);
      expect(storage.work.chrome.get(intent.operationId)?.phase).toBe('attached');
      await access(profile);
      expect(outcome).toBe('waiting');
      abort.abort();
      expect(await cleanup).toEqual({ kind: 'blocked', reason: 'CLEANUP_FAILED' });
      expect(storage.work.chrome.get(intent.operationId)?.phase).toBe('attached');
      await access(profile);
      groupProbes = 0;
      unknownObserved = new Promise<void>((resolve) => {
        observedUnknown = resolve;
      });
      const serviceCleanup = vi.spyOn(driver, 'cleanup');
      service = createWorkService({ repository: storage.work, driver, publish: () => {} });
      await unknownObserved;
      expect(service.snapshot().resources).toMatchObject([
        { operationId: intent.operationId, pages: 4, state: 'release-pending' },
      ]);
      const waitingDevice = value(storage.store.devices.create({ symbol: 'waiting' })).id;
      const waiting = value(service.start({ commandId: randomUUID(), deviceId: waitingDevice }));
      expect(await command(socket, 'write')).toBe('written');
      expect(await readFile(join(profile, 'late-helper-write'), 'utf8')).toBe('acknowledged');
      expect(service.snapshot().runs.find((run) => run.id === waiting.runId)?.state).toBe('queued');
      expect(storage.work.chrome.get(intent.operationId)?.phase).toBe('attached');
      value(service.cancel({ commandId: randomUUID(), runId: waiting.runId }));
      expect(await command(socket, 'exit')).toBe('exiting');
      allowObservation = true;
      await service.stop();
      expect(serviceCleanup).toHaveBeenCalledTimes(1);
      expect(processAbsent(helperPid)).toBe(true);
      expect(observeOwnedLifetime(lifetime)).toBe('empty');
      expect(storage.work.chrome.get(intent.operationId)).toMatchObject({
        phase: 'released',
        proof: { kind: 'posix-group-empty', pgid: lifetime.pgid },
      });
      expect(service.snapshot().resources).toEqual([]);
      expect(await readdir(root)).toEqual([]);
      await expect(access(profile)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(
        probes.mock.calls
          .filter(([pid]) => pid === -lifetime.pgid)
          .every(([, signal]) => signal === 0),
      ).toBe(true);
    } finally {
      abort.abort();
      vi.restoreAllMocks();
      await command(socket, 'exit').catch(() => {});
      if (helperPid) {
        const pid = helperPid;
        await expect.poll(() => processAbsent(pid), poll).toBe(true);
      }
      await service?.stop().catch(() => {});
      storage.store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);

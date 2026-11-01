import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { workerOwnerSchema } from '@browser-2d/contracts/host';
import { claimWorkerOwnership } from '../src/main/worker-ownership';

let directory: string;
let path: string;
let owners: string;
let compiled: string;
beforeAll(async () => {
  compiled = mkdtempSync(join(tmpdir(), 'browser-2d-ownership-module-'));
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      ssr: fileURLToPath(new URL('../src/main/worker-ownership.ts', import.meta.url)),
      outDir: compiled,
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: 'ownership.cjs', inlineDynamicImports: true },
      },
    },
    ssr: { noExternal: ['@browser-2d/contracts', 'zod'] },
  });
});
afterAll(() => rmSync(compiled, { recursive: true, force: true }));
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'browser-2d-ownership-'));
  path = join(directory, 'data.db');
  owners = join(directory, 'worker-owners');
  mkdirSync(owners);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
function recordPath(ownerNonce: string) {
  return join(owners, `${ownerNonce}.json`);
}
function read(ownerNonce: string) {
  return workerOwnerSchema.parse(JSON.parse(readFileSync(recordPath(ownerNonce), 'utf8')));
}
function fixture(hostPid: number, pid: number | null) {
  const ownerNonce = randomUUID();
  writeFileSync(recordPath(ownerNonce), JSON.stringify({ format: 1, hostPid, pid, ownerNonce }));
  return ownerNonce;
}
async function deadPid() {
  const child = spawn(process.execPath, ['-e', '']);
  if (!child.pid) throw new Error('Missing child pid');
  const pid = child.pid;
  await once(child, 'exit');
  return pid;
}
describe('worker ownership authorization', () => {
  it('publishes its unique pending claim before spawn and authorizes the exact child PID', () => {
    const ownership = claimWorkerOwnership(path);
    expect(read(ownership.ownerNonce)).toEqual({
      format: 1,
      hostPid: process.pid,
      pid: null,
      ownerNonce: ownership.ownerNonce,
    });
    expect(() => claimWorkerOwnership(path)).toThrow('exit is not confirmed');
    ownership.authorize(process.pid);
    expect(read(ownership.ownerNonce).pid).toBe(process.pid);
    expect(() => ownership.authorize(process.pid)).toThrow('already authorized');
    expect(() => claimWorkerOwnership(path)).toThrow('exit is not confirmed');
    ownership.release();
    expect(existsSync(recordPath(ownership.ownerNonce))).toBe(false);
  });
  it('permits a new pending claim after the old host is confirmed absent without modifying its record', async () => {
    const pid = await deadPid();
    const old = fixture(pid, null);
    const original = readFileSync(recordPath(old));
    const replacement = claimWorkerOwnership(path);
    expect(read(replacement.ownerNonce).pid).toBeNull();
    expect(readFileSync(recordPath(old))).toEqual(original);
    replacement.release();
  });
  it('permits takeover of an absent child but never signals a surviving unrelated PID', async () => {
    const pid = await deadPid();
    fixture(process.pid, pid);
    const replacement = claimWorkerOwnership(path);
    replacement.release();
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    if (!sentinel.pid) throw new Error('Missing sentinel pid');
    try {
      fixture(pid, sentinel.pid);
      expect(() => claimWorkerOwnership(path)).toThrow('exit is not confirmed');
      expect(sentinel.exitCode).toBeNull();
      expect(() => process.kill(sentinel.pid ?? 0, 0)).not.toThrow();
    } finally {
      sentinel.kill();
      await once(sentinel, 'exit');
    }
  });
  it('never overwrites or removes a record whose nonce changed', () => {
    const first = claimWorkerOwnership(path);
    const newer = { ...read(first.ownerNonce), ownerNonce: randomUUID() };
    writeFileSync(recordPath(first.ownerNonce), JSON.stringify(newer));
    expect(() => first.authorize(process.pid)).toThrow('ownership changed');
    expect(() => first.release()).toThrow('ownership changed');
    expect(JSON.parse(readFileSync(recordPath(first.ownerNonce), 'utf8'))).toEqual(newer);
  });
  it('rechecks the child if another record changes from pending to authorized during its absence probe', async () => {
    const dead = await deadPid();
    const old = fixture(dead, null);
    const kill = process.kill;
    let changed = false;
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === dead && !changed) {
        changed = true;
        writeFileSync(recordPath(old), JSON.stringify({ ...read(old), pid: process.pid }));
        throw Object.assign(new Error('Absent host'), { code: 'ESRCH' });
      }
      return kill(pid, signal);
    });
    expect(() => claimWorkerOwnership(path)).toThrow('exit is not confirmed');
    expect(read(old).pid).toBe(process.pid);
    expect(readdirSync(owners)).toEqual([`${old}.json`]);
  });
  it('never authorizes both concurrent host processes even when they observe the same stale owner', async () => {
    fixture(await deadPid(), null);
    for (let round = 0; round < 5; round++) {
      const children = Array.from({ length: 2 }, () =>
        spawn(
          process.execPath,
          [
            '-e',
            `const { claimWorkerOwnership } = require(process.argv[1]); let owner; process.send('ready'); process.on('message', message => { if (message === 'claim') { try { owner = claimWorkerOwnership(process.argv[2]); process.send('accepted'); } catch { process.send('blocked'); } } else { owner?.release(); process.exit(0); } });`,
            join(compiled, 'ownership.cjs'),
            path,
          ],
          { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
        ),
      );
      try {
        await Promise.all(children.map((child) => once(child, 'message')));
        const results = children.map((child) => once(child, 'message'));
        for (const child of children) child.send('claim');
        const outcomes = await Promise.all(results);
        expect(outcomes.filter(([result]) => result === 'accepted').length).toBeLessThanOrEqual(1);
      } finally {
        const exits = children.map((child) => once(child, 'exit'));
        for (const child of children) child.send('release');
        await Promise.all(exits);
      }
    }
  });
});

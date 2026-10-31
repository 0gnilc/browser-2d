import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { workerOwnerSchema } from '@browser-2d/contracts/host';
import { claimWorkerOwnership } from '../src/main/worker-ownership';

let directory: string;
let path: string;
let record: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'browser-2d-ownership-'));
  path = join(directory, 'data.db');
  record = join(directory, 'worker-owner.json');
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function read() {
  return workerOwnerSchema.parse(JSON.parse(readFileSync(record, 'utf8')));
}
async function deadPid() {
  const child = spawn(process.execPath, ['-e', '']);
  if (!child.pid) throw new Error('Missing child pid');
  const pid = child.pid;
  await once(child, 'exit');
  return pid;
}
describe('worker ownership authorization', () => {
  it('claims exclusively before spawn and publishes the exact PID before initialization', () => {
    const ownership = claimWorkerOwnership(path);
    expect(read()).toEqual({
      format: 1,
      hostPid: process.pid,
      pid: null,
      ownerNonce: ownership.ownerNonce,
    });
    expect(() => claimWorkerOwnership(path)).toThrow('exit is not confirmed');
    ownership.authorize(process.pid);
    expect(read().pid).toBe(process.pid);
    expect(() => claimWorkerOwnership(path)).toThrow('exit is not confirmed');
    ownership.release();
    expect(existsSync(record)).toBe(false);
  });
  it('retires a pending launch only after its host is confirmed absent', async () => {
    const pid = await deadPid();
    writeFileSync(
      record,
      JSON.stringify({ format: 1, hostPid: pid, pid: null, ownerNonce: randomUUID() }),
    );
    const replacement = claimWorkerOwnership(path);
    expect(read().ownerNonce).toBe(replacement.ownerNonce);
    replacement.release();
  });
  it('retires a confirmed absent child but does not signal a surviving unrelated PID', async () => {
    const pid = await deadPid();
    writeFileSync(
      record,
      JSON.stringify({ format: 1, hostPid: process.pid, pid, ownerNonce: randomUUID() }),
    );
    const replacement = claimWorkerOwnership(path);
    replacement.release();
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    if (!sentinel.pid) throw new Error('Missing sentinel pid');
    try {
      writeFileSync(
        record,
        JSON.stringify({ format: 1, hostPid: pid, pid: sentinel.pid, ownerNonce: randomUUID() }),
      );
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
    const newer = { ...read(), ownerNonce: randomUUID() };
    writeFileSync(record, JSON.stringify(newer));
    expect(() => first.authorize(process.pid)).toThrow('ownership changed');
    expect(() => first.release()).toThrow('ownership changed');
    expect(read()).toEqual(newer);
  });
});

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSchema, type RunResult, type Snapshot } from '@browser-2d/contracts/public';
import { createRunService } from '../src/service';

let dataDir: string;
const services: ReturnType<typeof createRunService>[] = [];
function open(onSnapshot: (snapshot: Snapshot) => void = () => {}) {
  const service = createRunService({ dataDir, onSnapshot });
  services.push(service);
  return service;
}
function accepted(result: RunResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
function input(deviceId = 'device-1') {
  return { commandId: randomUUID(), deviceId, durationMs: 100 };
}
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'browser-2d-worker-'));
  vi.useFakeTimers();
});
afterEach(() => {
  for (const service of services.splice(0)) service.close();
  vi.useRealTimers();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('synthetic run storage', () => {
  it('persists acceptance before returning and publishes completion with an increasing revision', () => {
    const snapshots: Snapshot[] = [];
    const service = open((snapshot) => snapshots.push(snapshot));
    const run = accepted(service.start(input()));
    const reader = new Database(join(dataDir, 'synthetic.sqlite3'), { readonly: true });
    try {
      expect(runSchema.parse(reader.prepare('SELECT * FROM runs WHERE id = ?').get(run.id))).toEqual(run);
    } finally {
      reader.close();
    }
    expect(snapshots.map((snapshot) => snapshot.revision)).toEqual([1]);
    vi.advanceTimersByTime(100);
    expect(service.snapshot().runs[0]?.state).toBe('completed');
    expect(snapshots.map((snapshot) => snapshot.revision)).toEqual([1, 2]);
    expect(new Set(snapshots.map((snapshot) => snapshot.epoch)).size).toBe(1);
  });

  it('replays the original acceptance for duplicate commands and rejects conflicting payloads or active devices', () => {
    const service = open();
    const command = input();
    const first = service.start(command);
    expect(service.start(command)).toEqual(first);
    expect(service.snapshot().revision).toBe(1);
    expect(service.start({ ...command, durationMs: 200 })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(service.start({ ...command, deviceId: 'device-2' })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(service.start(input())).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    vi.advanceTimersByTime(100);
    expect(service.start(command)).toEqual(first);
    expect(service.snapshot().runs).toHaveLength(1);
    expect(service.snapshot().revision).toBe(2);
    service.close();
    const reopened = open();
    expect(reopened.start(command)).toEqual(first);
    expect(reopened.snapshot().runs[0]?.state).toBe('completed');
    expect(reopened.snapshot().revision).toBe(0);
  });

  it('cancels a timer, persists cancellation, and allows a new task on that device', () => {
    const service = open();
    const run = accepted(service.start(input()));
    expect(service.cancel({ runId: run.id })).toMatchObject({ ok: true, value: { state: 'cancelled' } });
    const revision = service.snapshot().revision;
    vi.advanceTimersByTime(100);
    expect(service.snapshot().revision).toBe(revision);
    expect(service.cancel({ runId: run.id })).toMatchObject({ ok: true, value: { state: 'cancelled' } });
    expect(service.cancel({ runId: randomUUID() })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    accepted(service.start(input()));
    service.close();
    const reopened = open();
    expect(reopened.snapshot().runs.map((item) => item.state)).toEqual(['cancelled', 'cancelled']);
  });

  it('changes epochs on restart, preserves completed runs, and cancels every pending timer on normal close', () => {
    const service = open();
    const epoch = service.snapshot().epoch;
    accepted(service.start(input()));
    vi.advanceTimersByTime(100);
    accepted(service.start(input('device-2')));
    accepted(service.start(input('device-3')));
    service.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(service.start(input())).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    const reopened = open();
    expect(reopened.snapshot().epoch).not.toBe(epoch);
    expect(reopened.snapshot().runs.map((run) => run.state)).toEqual(['cancelled', 'cancelled', 'completed']);
  });

  it('classifies persisted running rows left by a crash as interrupted without replaying them', () => {
    const service = open();
    const run = accepted(service.start(input()));
    service.close();
    const fixture = new Database(join(dataDir, 'synthetic.sqlite3'));
    fixture.prepare("UPDATE runs SET state = 'running', updatedAt = createdAt WHERE id = ?").run(run.id);
    fixture.close();
    const reopened = open();
    expect(reopened.snapshot().runs[0]).toMatchObject({ id: run.id, state: 'interrupted' });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(30_000);
    expect(reopened.snapshot().runs[0]?.state).toBe('interrupted');
    reopened.close();
    expect(open().snapshot().runs[0]?.state).toBe('interrupted');
  });

  it('returns only the newest 100 runs while retaining older persisted command results', () => {
    const service = open();
    const first = input();
    const result = service.start(first);
    vi.advanceTimersByTime(100);
    for (let index = 0; index < 100; index += 1) {
      accepted(service.start(input()));
      vi.advanceTimersByTime(100);
    }
    const newest = service.snapshot().runs;
    expect(newest).toHaveLength(100);
    expect(newest[0]?.createdAt).not.toBe(newest[99]?.createdAt);
    expect(service.start(first)).toEqual(result);
    expect(service.snapshot().runs).toEqual(newest);
  });

  it('refuses newer or unrelated databases without changing their schema', () => {
    const file = join(dataDir, 'synthetic.sqlite3');
    const fixture = new Database(file);
    fixture.exec('PRAGMA user_version = 2');
    expect(() => open()).toThrow('Unsupported synthetic database schema');
    expect(fixture.pragma('user_version', { simple: true })).toBe(2);
    fixture.exec('PRAGMA user_version = 0; CREATE TABLE unrelated (value TEXT)');
    expect(() => open()).toThrow('Synthetic database must be empty');
    expect(fixture.pragma('user_version', { simple: true })).toBe(0);
    fixture.close();
  });
});

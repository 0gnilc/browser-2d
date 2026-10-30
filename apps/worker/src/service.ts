import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { failure, runSchema, type CancelInput, type Run, type RunResult, type Snapshot, type StartInput } from '@browser-2d/contracts/public';

declare const __WORKER_MIGRATION__: string;

export function createRunService({ dataDir, nativeBinding, onSnapshot }: {
  dataDir: string;
  nativeBinding?: string;
  onSnapshot: (snapshot: Snapshot) => void;
}) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'synthetic.sqlite3'), nativeBinding ? { nativeBinding } : {});
  try {
    const version = db.pragma('user_version', { simple: true });
    if (version !== 0 && version !== 1) throw new Error('Unsupported synthetic database schema');
    if (version === 0) {
      if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get() !== undefined) {
        throw new Error('Synthetic database must be empty before initialization');
      }
      const migration = typeof __WORKER_MIGRATION__ === 'string'
        ? __WORKER_MIGRATION__
        : fileURLToPath(new URL('../migrations/001-runs.sql', import.meta.url));
      db.transaction(() => db.exec(readFileSync(migration, 'utf8')))();
    }
    db.pragma('journal_mode = WAL');
    db.prepare("UPDATE runs SET state = 'interrupted', updatedAt = ? WHERE state = 'running'").run(new Date().toISOString());
  } catch (error) {
    db.close();
    throw error;
  }

  const epoch = randomUUID();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let revision = 0;
  let closed = false;
  const byId = db.prepare('SELECT * FROM runs WHERE id = ?');
  const byCommand = db.prepare('SELECT * FROM runs WHERE commandId = ?');
  const activeDevice = db.prepare("SELECT * FROM runs WHERE deviceId = ? AND state = 'running'");
  const recent = db.prepare('SELECT * FROM runs ORDER BY rowid DESC LIMIT 100');
  const insert = db.prepare('INSERT INTO runs (id, commandId, deviceId, durationMs, state, createdAt, updatedAt) VALUES (@id, @commandId, @deviceId, @durationMs, @state, @createdAt, @updatedAt)');
  const finish = db.prepare("UPDATE runs SET state = ?, updatedAt = ? WHERE id = ? AND state = 'running'");
  const readRun = (runId: string) => runSchema.parse(byId.get(runId));
  function snapshot(): Snapshot {
    return { epoch, revision, workerPid: process.pid, runs: runSchema.array().parse(recent.all()) };
  }
  function changed() {
    revision += 1;
    onSnapshot(snapshot());
  }
  const accept = db.transaction((input: StartInput): RunResult => {
    const existing = byCommand.get(input.commandId);
    if (existing !== undefined) {
      const run = runSchema.parse(existing);
      if (run.deviceId !== input.deviceId || run.durationMs !== input.durationMs) {
        return failure('CONFLICT', 'Command ID was already used for a different task');
      }
      return { ok: true, value: { ...run, state: 'running', updatedAt: run.createdAt } };
    }
    const active = activeDevice.get(input.deviceId);
    if (active !== undefined) {
      runSchema.parse(active);
      return failure('CONFLICT', 'Device already has an active task');
    }
    const now = new Date().toISOString();
    const run: Run = { ...input, id: randomUUID(), state: 'running', createdAt: now, updatedAt: now };
    insert.run(run);
    return { ok: true, value: run };
  });
  function start(input: StartInput): RunResult {
    if (closed) return failure('UNAVAILABLE', 'Worker is shutting down');
    const previous = byCommand.get(input.commandId);
    const result = accept(input);
    if (!result.ok || previous !== undefined) return result;
    const runId = result.value.id;
    timers.set(runId, setTimeout(() => {
      timers.delete(runId);
      finish.run('completed', new Date().toISOString(), runId);
      changed();
    }, input.durationMs));
    changed();
    return result;
  }
  function cancel({ runId }: CancelInput): RunResult {
    if (closed) return failure('UNAVAILABLE', 'Worker is shutting down');
    const row = byId.get(runId);
    if (row === undefined) return failure('NOT_FOUND', 'Task does not exist');
    const run = runSchema.parse(row);
    if (run.state !== 'running') return { ok: true, value: run };
    finish.run('cancelled', new Date().toISOString(), runId);
    clearTimeout(timers.get(runId));
    timers.delete(runId);
    const cancelled = readRun(runId);
    changed();
    return { ok: true, value: cancelled };
  }
  function close() {
    if (closed) return;
    closed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    try {
      const result = db.prepare("UPDATE runs SET state = 'cancelled', updatedAt = ? WHERE state = 'running'").run(new Date().toISOString());
      if (result.changes > 0) changed();
    } finally {
      db.close();
    }
  }
  return { snapshot, start, cancel, close };
}

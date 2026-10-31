import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import {
  cancelResultSchema,
  commandResultSchema,
  failure,
  resourceSchema,
  runConfigSchema,
  runSchema,
  startResultSchema,
  type CancelInput,
  type CancelResult,
  type CommandLookupResult,
  type CommandResult,
  type Run,
  type SettingsView,
  type StartInput,
  type StartResult,
  type WorkSnapshot,
} from '@browser-2d/contracts/public';

export const capacityPolicy = { devices: 2, pages: 4 };
const active = "'queued','starting','running','stopping'";
const runColumns =
  'id, device_id AS deviceId, state, config, outcome, created_at AS createdAt, updated_at AS updatedAt';
const resourceColumns =
  'operation_id AS operationId, run_id AS runId, device_id AS deviceId, owner_token AS ownerToken, pages, state, ownership, external_id AS externalId, failure';
const obligationSchema = resourceSchema.extend({
  ownerToken: z.uuid(),
  externalId: z.string().nullable(),
});
export type Obligation = z.infer<typeof obligationSchema>;
export type Acquisition = { ownership: 'owned' | 'borrowed'; externalId: string };
export type Reconciliation =
  { kind: 'present'; resource: Acquisition } | { kind: 'absent-final' } | { kind: 'unknown' };
const storedRunSchema = runSchema
  .omit({ config: true })
  .extend({ config: z.string().transform((value) => runConfigSchema.parse(JSON.parse(value))) });

export function createWorkRepository(db: Database.Database, settings: () => SettingsView) {
  const epoch = randomUUID();
  let revision = 0;
  const touch = () => {
    revision += 1;
  };
  const now = () => new Date().toISOString();
  function run(id: string): Run | undefined {
    const row = db.prepare(`SELECT ${runColumns} FROM work_runs WHERE id = ?`).get(id);
    return row === undefined ? undefined : storedRunSchema.parse(row);
  }
  function obligations(): Obligation[] {
    return obligationSchema
      .array()
      .parse(
        db
          .prepare(
            `SELECT ${resourceColumns} FROM work_resources WHERE state != 'resolved' ORDER BY rowid`,
          )
          .all(),
      );
  }
  function existing(commandId: string, canonical: string): CommandResult | undefined {
    const raw = db
      .prepare('SELECT canonical_input, result FROM work_commands WHERE command_id = ?')
      .get(commandId);
    if (raw === undefined) return undefined;
    const row = z.object({ canonical_input: z.string(), result: z.string() }).parse(raw);
    return row.canonical_input === canonical
      ? commandResultSchema.parse(JSON.parse(row.result))
      : failure('CONFLICT', 'Command ID was already used for another input');
  }
  function record(commandId: string, canonical: string, result: CommandResult) {
    db.prepare(
      'INSERT INTO work_commands (command_id, canonical_input, result) VALUES (?, ?, ?)',
    ).run(commandId, canonical, JSON.stringify(result));
    touch();
  }
  const start = db.transaction((input: StartInput): StartResult => {
    const canonical = JSON.stringify({ kind: 'start', deviceId: input.deviceId });
    const previous = existing(input.commandId, canonical);
    if (previous) return startResultSchema.parse(previous);
    let result: StartResult;
    if (!db.prepare('SELECT 1 FROM device WHERE id = ?').get(input.deviceId))
      result = failure('NOT_FOUND', 'Device does not exist');
    else if (
      db
        .prepare(
          `SELECT 1 FROM work_runs WHERE device_id = ? AND state IN (${active}) UNION ALL SELECT 1 FROM work_resources WHERE device_id = ? AND state != 'resolved' LIMIT 1`,
        )
        .get(input.deviceId, input.deviceId)
    )
      result = failure('CONFLICT', 'Device has active work or unresolved cleanup');
    else {
      const { revision, pageCount, viewportWidth, viewportHeight } = settings();
      const config = runConfigSchema.parse({ revision, pageCount, viewportWidth, viewportHeight });
      if (config.pageCount > capacityPolicy.pages)
        result = failure('CONFLICT', 'Page demand exceeds controlled capacity');
      else {
        const id = randomUUID();
        const acceptedAt = now();
        db.prepare(
          "INSERT INTO work_runs (id, device_id, state, config, outcome, created_at, updated_at) VALUES (?, ?, 'queued', ?, NULL, ?, ?)",
        ).run(id, input.deviceId, JSON.stringify(config), acceptedAt, acceptedAt);
        result = {
          ok: true,
          value: { kind: 'start', commandId: input.commandId, runId: id, acceptedAt },
        };
      }
    }
    record(input.commandId, canonical, result);
    return result;
  });
  const cancel = db.transaction((input: CancelInput): CancelResult => {
    const canonical = JSON.stringify({ kind: 'cancel', runId: input.runId });
    const previous = existing(input.commandId, canonical);
    if (previous) return cancelResultSchema.parse(previous);
    const found = run(input.runId);
    let result: CancelResult;
    if (!found) result = failure('NOT_FOUND', 'Run does not exist');
    else {
      const terminal = !['queued', 'starting', 'running', 'stopping'].includes(found.state);
      if (!terminal) stopRun(found.id);
      result = {
        ok: true,
        value: {
          kind: 'cancel',
          commandId: input.commandId,
          runId: input.runId,
          acceptedAt: now(),
          disposition: terminal ? 'already-terminal' : 'stop-requested',
        },
      };
    }
    record(input.commandId, canonical, result);
    return result;
  });
  function stopRun(id: string) {
    db.prepare(
      "UPDATE work_runs SET state = CASE WHEN state = 'queued' THEN 'cancelled' ELSE 'stopping' END, outcome = 'cancelled', updated_at = ? WHERE id = ? AND state IN ('queued','starting','running','stopping')",
    ).run(now(), id);
    db.prepare(
      "UPDATE work_resources SET state = 'release-pending' WHERE run_id = ? AND state != 'resolved'",
    ).run(id);
  }
  const admit = db.transaction((): { run: Run; intent: Obligation } | undefined => {
    const occupancy = z
      .object({ devices: z.number(), pages: z.number() })
      .parse(
        db
          .prepare(
            `SELECT (SELECT COUNT(*) FROM (SELECT device_id FROM work_runs WHERE state IN ('starting','running','stopping') UNION SELECT device_id FROM work_resources WHERE state != 'resolved')) AS devices, COALESCE((SELECT SUM(pages) FROM work_resources WHERE state != 'resolved'), 0) AS pages`,
          )
          .get(),
      );
    if (occupancy.devices >= capacityPolicy.devices) return;
    const queued = storedRunSchema
      .array()
      .parse(
        db
          .prepare(`SELECT ${runColumns} FROM work_runs WHERE state = 'queued' ORDER BY rowid`)
          .all(),
      );
    const next = queued.find(
      (item) => occupancy.pages + item.config.pageCount <= capacityPolicy.pages,
    );
    if (!next) return;
    const intent: Obligation = {
      operationId: randomUUID(),
      runId: next.id,
      deviceId: next.deviceId,
      ownerToken: randomUUID(),
      pages: next.config.pageCount,
      state: 'intent',
      ownership: 'unknown',
      externalId: null,
      failure: null,
    };
    db.prepare(
      'INSERT INTO work_resources (operation_id,run_id,device_id,owner_token,pages,state,ownership,external_id,failure) VALUES (@operationId,@runId,@deviceId,@ownerToken,@pages,@state,@ownership,@externalId,@failure)',
    ).run(intent);
    db.prepare("UPDATE work_runs SET state = 'starting', updated_at = ? WHERE id = ?").run(
      now(),
      next.id,
    );
    touch();
    return { run: { ...next, state: 'starting' }, intent };
  });
  const acquired = db.transaction((intent: Obligation, resource: Acquisition): boolean => {
    db.prepare(
      "UPDATE work_resources SET ownership = ?, external_id = ?, state = CASE WHEN state = 'intent' THEN 'held' ELSE state END, failure = NULL WHERE operation_id = ? AND state != 'resolved'",
    ).run(resource.ownership, resource.externalId, intent.operationId);
    const result = db
      .prepare(
        "UPDATE work_runs SET state = 'running', updated_at = ? WHERE id = ? AND state = 'starting'",
      )
      .run(now(), intent.runId);
    touch();
    return result.changes === 1;
  });
  const finish = db.transaction((id: string, outcome: 'completed' | 'failed') => {
    db.prepare(
      "UPDATE work_runs SET state = 'stopping', outcome = ?, updated_at = ? WHERE id = ? AND state IN ('starting','running')",
    ).run(outcome, now(), id);
    db.prepare(
      "UPDATE work_resources SET state = 'release-pending' WHERE run_id = ? AND state != 'resolved'",
    ).run(id);
    touch();
  });
  const resolved = db.transaction((operationId: string) => {
    db.prepare(
      "UPDATE work_resources SET state = 'resolved', failure = NULL WHERE operation_id = ?",
    ).run(operationId);
    db.prepare(
      "UPDATE work_runs SET state = outcome, updated_at = ? WHERE state = 'stopping' AND id = (SELECT run_id FROM work_resources WHERE operation_id = ?) AND NOT EXISTS (SELECT 1 FROM work_resources WHERE run_id = work_runs.id AND state != 'resolved')",
    ).run(now(), operationId);
    touch();
  });
  return {
    start,
    cancel,
    admit,
    acquired,
    finish,
    resolved,
    run,
    obligations,
    getCommand({ commandId }: { commandId: string }): CommandLookupResult {
      const raw = db
        .prepare('SELECT result FROM work_commands WHERE command_id = ?')
        .pluck()
        .get(commandId);
      return {
        ok: true,
        value:
          raw === undefined
            ? { status: 'unknown' }
            : {
                status: 'recorded',
                receipt: commandResultSchema.parse(JSON.parse(z.string().parse(raw))),
              },
      };
    },
    cleanupFailure(operationId: string, failure: Obligation['failure']) {
      db.prepare(
        "UPDATE work_resources SET state = 'release-pending', failure = ? WHERE operation_id = ? AND state != 'resolved'",
      ).run(failure, operationId);
      touch();
    },
    recover: db.transaction(() => {
      db.prepare(
        `UPDATE work_runs SET state = 'interrupted', updated_at = ? WHERE state IN (${active})`,
      ).run(now());
      db.prepare(
        "UPDATE work_resources SET state = 'release-pending' WHERE state != 'resolved'",
      ).run();
      touch();
    }),
    stopAll: db.transaction(() => {
      const runs = z
        .object({ id: z.string() })
        .array()
        .parse(db.prepare(`SELECT id FROM work_runs WHERE state IN (${active})`).all());
      for (const item of runs) stopRun(item.id);
      touch();
    }),
    snapshot(): WorkSnapshot {
      const runs = storedRunSchema
        .array()
        .parse(
          db
            .prepare(
              `SELECT ${runColumns} FROM work_runs WHERE state IN (${active}) OR id IN (SELECT run_id FROM work_resources WHERE state != 'resolved') OR id IN (SELECT id FROM work_runs WHERE state NOT IN (${active}) ORDER BY rowid DESC LIMIT 100) ORDER BY rowid DESC`,
            )
            .all(),
        );
      return {
        epoch,
        revision,
        workerPid: process.pid,
        execution: 'controlled',
        policy: { ...capacityPolicy },
        runs,
        resources: obligations().map((item) =>
          resourceSchema.parse({
            operationId: item.operationId,
            runId: item.runId,
            deviceId: item.deviceId,
            pages: item.pages,
            state: item.state,
            ownership: item.ownership,
            failure: item.failure,
          }),
        ),
      };
    },
  };
}
export type WorkRepository = ReturnType<typeof createWorkRepository>;

import { z } from 'zod';
import type Database from 'better-sqlite3';
import { chromeSettingsSchema, type ChromeSettings } from '@browser-2d/contracts/public';

const browserHash = z.string().regex(/^[a-f0-9]{64}$/);
export const chromeStateSchema = z.union([
  z.strictObject({
    mode: z.literal('launch'),
    phase: z.enum(['prepared', 'attempted', 'stopped', 'released']),
  }),
  z.strictObject({
    mode: z.literal('launch'),
    phase: z.literal('attached'),
    browserHash,
    pid: z.number().int().positive(),
    processIdentity: z.string().nullable(),
  }),
  z.strictObject({ mode: z.literal('connect'), phase: z.enum(['prepared', 'released']) }),
  z.strictObject({ mode: z.literal('connect'), phase: z.literal('creating'), browserHash }),
  z.strictObject({
    mode: z.literal('connect'),
    phase: z.literal('known'),
    browserHash,
    contextId: z.string().min(1),
  }),
]);
export type ChromeState = z.infer<typeof chromeStateSchema>;

export function createChromeJournal(db: Database.Database) {
  function config(runId: string): ChromeSettings {
    const row = db
      .prepare('SELECT config FROM chrome_run_configs WHERE run_id = ?')
      .pluck()
      .get(runId);
    return chromeSettingsSchema.parse(JSON.parse(z.string().parse(row)));
  }
  function get(operationId: string): ChromeState | undefined {
    const row = db
      .prepare('SELECT state FROM chrome_operations WHERE operation_id = ?')
      .pluck()
      .get(operationId);
    return row === undefined
      ? undefined
      : chromeStateSchema.parse(JSON.parse(z.string().parse(row)));
  }
  function save(operationId: string, state: ChromeState) {
    const next = chromeStateSchema.parse(state);
    const current = get(operationId);
    if (!current || current.mode !== next.mode) throw new Error('Chrome operation is not prepared');
    const transitions: Record<ChromeState['phase'], ChromeState['phase'][]> = {
      prepared: ['attempted', 'creating', 'stopped', 'released'],
      attempted: ['attached', 'stopped'],
      attached: ['stopped'],
      stopped: ['released'],
      creating: ['known', 'released'],
      known: ['released'],
      released: [],
    };
    if (!transitions[current.phase].includes(next.phase))
      throw new Error('Invalid Chrome transition');
    db.prepare('UPDATE chrome_operations SET state = ? WHERE operation_id = ?').run(
      JSON.stringify(next),
      operationId,
    );
  }
  return {
    hasRun(runId: string) {
      return (
        db.prepare('SELECT 1 FROM chrome_run_configs WHERE run_id = ?').get(runId) !== undefined
      );
    },
    config,
    get,
    save,
    prepare(operationId: string): ChromeState {
      const previous = get(operationId);
      if (previous) return previous;
      const runId = z
        .string()
        .parse(
          db
            .prepare('SELECT run_id FROM work_resources WHERE operation_id = ?')
            .pluck()
            .get(operationId),
        );
      const state: ChromeState = { mode: config(runId).mode, phase: 'prepared' };
      db.prepare('INSERT INTO chrome_operations (operation_id, state) VALUES (?, ?)').run(
        operationId,
        JSON.stringify(state),
      );
      return state;
    },
  };
}
export type ChromeJournal = ReturnType<typeof createChromeJournal>;

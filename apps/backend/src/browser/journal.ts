import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import type Database from 'better-sqlite3';
import {
  launchContractSchema,
  ownedLifetimeSchema,
  stoppedProofSchema,
  type OwnedLifetime,
  type StoppedProof,
} from './process';
import { chromeSettingsSchema, type ChromeSettings } from '@browser-2d/contracts/public';

const browserHash = z.string().regex(/^[a-f0-9]{64}$/);
const launch = { version: z.literal(2), mode: z.literal('launch') };
const identity = {
  browserHash,
  pid: z.number().int().positive(),
  processIdentity: z.string().nullable(),
};
export const chromeStateSchema = z.union([
  z.strictObject({ ...launch, phase: z.literal('attempted'), contract: launchContractSchema }),
  z.strictObject({ ...launch, phase: z.literal('spawned'), lifetime: ownedLifetimeSchema }),
  z.strictObject({
    ...launch,
    phase: z.literal('attached'),
    lifetime: ownedLifetimeSchema,
    ...identity,
  }),
  z.strictObject({ ...launch, phase: z.enum(['stopped', 'released']), proof: stoppedProofSchema }),
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

function matchesLifetime(lifetime: OwnedLifetime, proof: StoppedProof): boolean {
  return lifetime.kind === 'posix-group'
    ? proof.kind === 'posix-group-empty' && proof.pgid === lifetime.pgid
    : proof.kind === 'windows-main-exited' && proof.pid === lifetime.pid;
}
function validLaunchTransition(
  current: Extract<ChromeState, { mode: 'launch' }>,
  next: Extract<ChromeState, { mode: 'launch' }>,
): boolean {
  if (!('version' in next)) return false;
  if (current.phase === 'prepared')
    return (
      next.phase === 'attempted' ||
      (next.phase === 'stopped' && next.proof.kind === 'never-spawned')
    );
  if (!('version' in current)) return false;
  switch (current.phase) {
    case 'attempted':
      if (next.phase === 'spawned') return next.lifetime.kind === current.contract;
      return (
        next.phase === 'stopped' &&
        (next.proof.kind === 'never-spawned' ||
          (current.contract === 'posix-group'
            ? next.proof.kind === 'posix-group-empty'
            : next.proof.kind === 'windows-main-exited'))
      );
    case 'spawned':
      if (next.phase === 'attached')
        return (
          isDeepStrictEqual(current.lifetime, next.lifetime) &&
          next.pid ===
            (current.lifetime.kind === 'posix-group' ? current.lifetime.pgid : current.lifetime.pid)
        );
      return next.phase === 'stopped' && matchesLifetime(current.lifetime, next.proof);
    case 'attached':
      return next.phase === 'stopped' && matchesLifetime(current.lifetime, next.proof);
    case 'stopped':
      return next.phase === 'released' && isDeepStrictEqual(current.proof, next.proof);
    case 'released':
      return false;
  }
}

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
      attempted: ['spawned', 'stopped'],
      spawned: ['attached', 'stopped'],
      attached: ['stopped'],
      stopped: ['released'],
      creating: ['known', 'released'],
      known: ['released'],
      released: [],
    };
    if (
      !transitions[current.phase].includes(next.phase) ||
      (current.mode === 'launch' && next.mode === 'launch' && !validLaunchTransition(current, next))
    )
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

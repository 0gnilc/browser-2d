export * from './business';
import { z } from 'zod';
import {
  businessResultSchema,
  credentialChallengeSchema,
  storageFailureCodeSchema,
} from './business';
import {
  cancelInputSchema,
  commandInputSchema,
  commandResultSchema,
  commandLookupResultSchema,
  failureSchema,
  workSnapshotResultSchema,
  workSnapshotSchema,
  startInputSchema,
} from '../public/index';

export const channels = {
  snapshot: 'work:snapshot',
  start: 'work:start',
  cancel: 'work:cancel',
  getCommand: 'work:get-command',
  subscribe: 'work:subscribe',
  changed: 'work:changed',
} as const;
export const controlledFixtureSchema = z.strictObject({
  directory: z.string().min(1),
  scenario: z.enum([
    'hold-acquire',
    'hold-execute',
    'hold-release',
    'acquire-result-lost',
    'cleanup-fails',
    'borrowed',
  ]),
});
export type ControlledFixture = z.infer<typeof controlledFixtureSchema>;
export const workerOwnerSchema = z.strictObject({
  format: z.literal(1),
  hostPid: z.number().int().positive(),
  pid: z.number().int().positive().nullable(),
  ownerNonce: z.uuid(),
});
export const initializeSchema = z.strictObject({
  type: z.literal('initialize'),
  ownerNonce: z.uuid(),
  dataDir: z.string().min(1),
  businessPath: z.string().min(1),
  nativeBinding: z.string().min(1).optional(),
  fixture: controlledFixtureSchema.optional(),
  execution: z.enum(['controlled', 'chrome']).optional(),
  browserProbe: z
    .strictObject({
      url: z.string().optional(),
      durationMs: z.number().int().min(0).max(60_000).optional(),
    })
    .optional(),
  browserFixture: z
    .strictObject({
      directory: z.string().min(1),
      hold: z.enum(['spawned', 'context-created', 'cleanup']),
    })
    .optional(),
});
export const heartbeatSchema = z.strictObject({
  type: z.literal('heartbeat'),
  ownerNonce: z.uuid(),
});
export const requestSchema = z.discriminatedUnion('method', [
  z.strictObject({
    type: z.literal('request'),
    requestId: z.uuid(),
    method: z.literal('snapshot'),
  }),
  z.strictObject({
    type: z.literal('request'),
    requestId: z.uuid(),
    method: z.literal('start'),
    input: startInputSchema,
  }),
  z.strictObject({
    type: z.literal('request'),
    requestId: z.uuid(),
    method: z.literal('cancel'),
    input: cancelInputSchema,
  }),
  z.strictObject({
    type: z.literal('request'),
    requestId: z.uuid(),
    method: z.literal('getCommand'),
    input: commandInputSchema,
  }),
  z.strictObject({
    type: z.literal('request'),
    requestId: z.uuid(),
    method: z.literal('shutdown'),
  }),
]);
export type WorkerRequest = z.infer<typeof requestSchema>;
export const shutdownResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), value: z.null() }),
  failureSchema,
]);
export const workerEventSchema = z.union([
  credentialChallengeSchema,
  z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('blocked'), code: storageFailureCodeSchema }),
    z.strictObject({
      type: z.literal('business-response'),
      requestId: z.uuid(),
      result: businessResultSchema,
    }),
    z.strictObject({ type: z.literal('ready'), snapshot: workSnapshotSchema }),
    z.strictObject({ type: z.literal('snapshot'), snapshot: workSnapshotSchema }),
    z.strictObject({ type: z.literal('fatal'), message: z.string() }),
    z.strictObject({
      type: z.literal('response'),
      requestId: z.uuid(),
      result: z.union([
        commandResultSchema,
        commandLookupResultSchema,
        workSnapshotResultSchema,
        shutdownResultSchema,
      ]),
    }),
  ]),
]);
export type WorkerEvent = z.infer<typeof workerEventSchema>;

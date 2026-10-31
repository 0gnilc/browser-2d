export * from './business';
import { z } from 'zod';
import {
  cancelInputSchema,
  failureSchema,
  runResultSchema,
  snapshotResultSchema,
  snapshotSchema,
  startInputSchema,
} from '../public/index';

export const channels = {
  snapshot: 'work:snapshot',
  start: 'work:start',
  cancel: 'work:cancel',
  changed: 'work:changed',
} as const;

export const initializeSchema = z.object({
  type: z.literal('initialize'),
  dataDir: z.string().min(1),
  nativeBinding: z.string().min(1).optional(),
});
export const requestSchema = z.discriminatedUnion('method', [
  z.object({ type: z.literal('request'), requestId: z.uuid(), method: z.literal('snapshot') }),
  z.object({
    type: z.literal('request'),
    requestId: z.uuid(),
    method: z.literal('start'),
    input: startInputSchema,
  }),
  z.object({
    type: z.literal('request'),
    requestId: z.uuid(),
    method: z.literal('cancel'),
    input: cancelInputSchema,
  }),
  z.object({ type: z.literal('request'), requestId: z.uuid(), method: z.literal('shutdown') }),
]);
export type WorkerRequest = z.infer<typeof requestSchema>;
export const shutdownResultSchema = z.union([
  z.object({ ok: z.literal(true), value: z.null() }),
  failureSchema,
]);
export const workerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), snapshot: snapshotSchema }),
  z.object({ type: z.literal('snapshot'), snapshot: snapshotSchema }),
  z.object({ type: z.literal('fatal'), message: z.string() }),
  z.object({
    type: z.literal('response'),
    requestId: z.uuid(),
    result: z.union([runResultSchema, snapshotResultSchema, shutdownResultSchema]),
  }),
]);
export type WorkerEvent = z.infer<typeof workerEventSchema>;

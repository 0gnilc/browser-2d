import { z } from 'zod';
import { idInputSchema, resultSchema } from './business';

export const runStateSchema = z.enum([
  'queued',
  'starting',
  'running',
  'stopping',
  'completed',
  'cancelled',
  'failed',
  'interrupted',
]);
export const runConfigSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  pageCount: z.number().int().positive(),
  viewportWidth: z.number().int().positive(),
  viewportHeight: z.number().int().positive(),
});
export const runSchema = z.strictObject({
  id: z.uuid(),
  deviceId: idInputSchema.shape.id,
  state: runStateSchema,
  config: runConfigSchema,
  outcome: z.enum(['completed', 'cancelled', 'failed']).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Run = z.infer<typeof runSchema>;
export const resourceSchema = z.strictObject({
  operationId: z.uuid(),
  runId: z.uuid(),
  deviceId: idInputSchema.shape.id,
  pages: z.number().int().positive(),
  state: z.enum(['intent', 'held', 'release-pending']),
  ownership: z.enum(['unknown', 'owned', 'borrowed']),
  failure: z.enum(['ACQUISITION_UNCERTAIN', 'CLEANUP_FAILED', 'OWNERSHIP_UNCERTAIN']).nullable(),
});
export type Resource = z.infer<typeof resourceSchema>;
export const workSnapshotSchema = z.strictObject({
  epoch: z.uuid(),
  revision: z.number().int().nonnegative(),
  workerPid: z.number().int().positive(),
  execution: z.enum(['controlled', 'chrome']),
  policy: z.strictObject({
    devices: z.number().int().positive(),
    pages: z.number().int().positive(),
  }),
  runs: z.array(runSchema),
  resources: z.array(resourceSchema),
});
export type WorkSnapshot = z.infer<typeof workSnapshotSchema>;
export const workStateSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    generation: z.number().int().nonnegative(),
    snapshot: workSnapshotSchema,
  }),
  z.strictObject({
    status: z.literal('unavailable'),
    generation: z.number().int().nonnegative(),
    reason: z.string(),
  }),
]);
export type WorkState = z.infer<typeof workStateSchema>;
export const startInputSchema = z.strictObject({
  commandId: z.uuid(),
  deviceId: idInputSchema.shape.id,
});
export const cancelInputSchema = z.strictObject({ commandId: z.uuid(), runId: z.uuid() });
export const commandInputSchema = z.strictObject({ commandId: z.uuid() });
export type StartInput = z.infer<typeof startInputSchema>;
export type CancelInput = z.infer<typeof cancelInputSchema>;
const receipt = { commandId: z.uuid(), runId: z.uuid(), acceptedAt: z.iso.datetime() };
export const startReceiptSchema = z.strictObject({ kind: z.literal('start'), ...receipt });
export const cancelReceiptSchema = z.strictObject({
  kind: z.literal('cancel'),
  ...receipt,
  disposition: z.enum(['stop-requested', 'already-terminal']),
});
export const startResultSchema = resultSchema(startReceiptSchema);
export const cancelResultSchema = resultSchema(cancelReceiptSchema);
export const commandReceiptSchema = z.union([startReceiptSchema, cancelReceiptSchema]);
export const commandResultSchema = resultSchema(commandReceiptSchema);
export const commandLookupSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unknown') }),
  z.strictObject({ status: z.literal('recorded'), receipt: commandResultSchema }),
]);
export const commandLookupResultSchema = resultSchema(commandLookupSchema);
export const workSnapshotResultSchema = resultSchema(workSnapshotSchema);
export type StartResult = z.infer<typeof startResultSchema>;
export type CancelResult = z.infer<typeof cancelResultSchema>;
export type CommandResult = z.infer<typeof commandResultSchema>;
export type CommandLookupResult = z.infer<typeof commandLookupResultSchema>;
export type WorkSnapshotResult = z.infer<typeof workSnapshotResultSchema>;
export interface WorkApi {
  start(input: StartInput): Promise<StartResult>;
  cancel(input: CancelInput): Promise<CancelResult>;
  getCommand(input: z.infer<typeof commandInputSchema>): Promise<CommandLookupResult>;
  getSnapshot(): Promise<WorkSnapshotResult>;
  subscribe(listener: (state: WorkState) => void): () => void;
}

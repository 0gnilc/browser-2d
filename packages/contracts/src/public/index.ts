import { z } from 'zod';
import { failureSchema } from './result';
import type { BusinessApi } from './business';
export * from './result';
export * from './business';

export const runSchema = z.object({
  id: z.uuid(),
  commandId: z.uuid(),
  deviceId: z.string().min(1).max(64),
  durationMs: z.number().int().min(100).max(30_000),
  state: z.enum(['running', 'completed', 'cancelled', 'interrupted']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Run = z.infer<typeof runSchema>;

export const snapshotSchema = z.object({
  epoch: z.uuid(),
  revision: z.number().int().nonnegative(),
  workerPid: z.number().int().positive(),
  runs: z.array(runSchema),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const startInputSchema = z.object({
  commandId: z.uuid(),
  deviceId: z.string().trim().min(1).max(64),
  durationMs: z.number().int().min(100).max(30_000),
});
export const cancelInputSchema = z.object({ runId: z.uuid() });
export type StartInput = z.infer<typeof startInputSchema>;
export type CancelInput = z.infer<typeof cancelInputSchema>;

export const runResultSchema = z.union([
  z.object({ ok: z.literal(true), value: runSchema }),
  failureSchema,
]);
export const snapshotResultSchema = z.union([
  z.object({ ok: z.literal(true), value: snapshotSchema }),
  failureSchema,
]);
export type RunResult = z.infer<typeof runResultSchema>;
export type SnapshotResult = z.infer<typeof snapshotResultSchema>;

export interface Browser2dApi extends BusinessApi {
  getSnapshot(): Promise<SnapshotResult>;
  start(input: StartInput): Promise<RunResult>;
  cancel(input: CancelInput): Promise<RunResult>;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
}

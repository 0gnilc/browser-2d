import { z } from 'zod';
import { failureSchema } from './result';

export const updateChannelSchema = z.enum(['stable', 'test']);
const base = { revision: z.number().int().nonnegative(), currentVersion: z.string().max(100) };
const enabled = { ...base, channel: updateChannelSchema };
const candidate = { ...enabled, version: z.string().min(1).max(100) };
export const updateStateSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ...base,
    status: z.literal('unavailable'),
    reason: z.enum(['development', 'unconfigured', 'package-manager']),
  }),
  z.strictObject({ ...enabled, status: z.literal('idle') }),
  z.strictObject({ ...enabled, status: z.literal('checking') }),
  z.strictObject({ ...candidate, status: z.literal('available') }),
  z.strictObject({
    ...candidate,
    status: z.literal('downloading'),
    percent: z.number().min(0).max(100),
  }),
  z.strictObject({ ...candidate, status: z.literal('downloaded') }),
  z.strictObject({ ...candidate, status: z.literal('installing') }),
  z.strictObject({
    ...enabled,
    status: z.literal('failed'),
    operation: z.enum(['check', 'download', 'install']),
    message: z.string().max(200),
    restartRequired: z.boolean(),
  }),
]);
export type UpdateState = z.infer<typeof updateStateSchema>;
export const updateStateResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), value: updateStateSchema }),
  failureSchema,
]);
export const updateInstallResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), value: z.strictObject({ accepted: z.literal(true) }) }),
  failureSchema,
]);
export interface UpdatesApi {
  getState(): Promise<z.infer<typeof updateStateResultSchema>>;
  check(): Promise<z.infer<typeof updateStateResultSchema>>;
  download(): Promise<z.infer<typeof updateStateResultSchema>>;
  install(): Promise<z.infer<typeof updateInstallResultSchema>>;
  subscribe(listener: (state: UpdateState) => void): () => void;
}

import { z } from 'zod';
import { browserIdSchema } from './browsers';
export const taskIdSchema = z.uuid().brand<'TaskId'>();
export type TaskId = z.infer<typeof taskIdSchema>;
export const workTaskStateSchema = z.enum([
  'queued',
  'starting',
  'running',
  'stopping',
  'recovery_required',
]);
export const workTaskSchema = z.strictObject({
  id: taskIdSchema,
  browserId: browserIdSchema,
  state: workTaskStateSchema,
  stopRequestedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type WorkTask = z.infer<typeof workTaskSchema>;

export const browserIdInputSchema = z.strictObject({ browserId: browserIdSchema });
export const stopViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('stopped'), browserId: browserIdSchema }),
  z.strictObject({ kind: z.literal('stopping'), task: workTaskSchema }),
  z.strictObject({
    kind: z.literal('recovery_required'),
    task: workTaskSchema,
    message: z.string(),
  }),
]);
export type StopView = z.infer<typeof stopViewSchema>;

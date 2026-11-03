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

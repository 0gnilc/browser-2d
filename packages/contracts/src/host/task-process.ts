import { z } from 'zod';

import { browserSchema } from '../public/browsers';
import { taskIdSchema } from '../public/work-tasks';
import { isAmountUnits, type AmountUnits } from '@browser-2d/amount';
export { taskIdSchema } from '../public/work-tasks';
export type { TaskId } from '../public/work-tasks';
export const executionNonceSchema = z.uuid().brand<'ExecutionNonce'>();
export type ExecutionNonce = z.infer<typeof executionNonceSchema>;
export const browserSnapshotSchema = browserSchema
  .extend({
    amount: z.custom<AmountUnits>((value) => typeof value === 'number' && isAmountUnits(value)),
  })
  .readonly();
export type BrowserSnapshot = z.infer<typeof browserSnapshotSchema>;

export const automationSchema = z.strictObject({
  processor: z.literal('baidu-check'),
  endpoint: z.url(),
  url: z.url(),
});
export type Automation = z.infer<typeof automationSchema>;

export const taskProcessCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('launch'),
    taskId: taskIdSchema,
    executionNonce: executionNonceSchema,
    browser: browserSnapshotSchema,
    automation: automationSchema,
  }),
  z.strictObject({ kind: z.literal('stop') }),
  z.strictObject({ kind: z.literal('heartbeat') }),
  z.strictObject({ kind: z.literal('cancel') }),
  z.strictObject({ kind: z.literal('receipt'), sequence: z.number().int().nonnegative() }),
]);
export type TaskProcessCommand = z.infer<typeof taskProcessCommandSchema>;

export const taskProcessEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('host-ready') }),
  z.strictObject({ kind: z.literal('running') }),
  z.strictObject({ kind: z.literal('pulse'), sequence: z.number().int().nonnegative() }),
  z.strictObject({ kind: z.literal('verified') }),
  z.strictObject({
    kind: z.literal('request'),
    taskId: taskIdSchema,
    executionNonce: executionNonceSchema,
    sequence: z.number().int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal('failed') }),
]);
export type TaskProcessEvent = z.infer<typeof taskProcessEventSchema>;

import { z } from 'zod';

import { browserSnapshotSchema, executionNonceSchema } from './execution';
import { taskIdSchema } from '../public/work-tasks';
import { cardRequestSchema, cardReplySchema } from './application';
export * from './execution';

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
  z.strictObject({ kind: z.literal('work-ready') }),
  z.strictObject({
    kind: z.literal('receipt'),
    sequence: z.number().int().nonnegative().safe(),
    reply: cardReplySchema,
  }),
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
    sequence: z.number().int().nonnegative().safe(),
    request: cardRequestSchema,
  }),
  z.strictObject({ kind: z.literal('exhausted') }),
  z.strictObject({ kind: z.literal('failed') }),
]);
export type TaskProcessEvent = z.infer<typeof taskProcessEventSchema>;

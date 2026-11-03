import { z } from 'zod';

export const taskIdSchema = z.uuid().brand<'TaskId'>();
export const executionNonceSchema = z.uuid().brand<'ExecutionNonce'>();
export type TaskId = z.infer<typeof taskIdSchema>;
export type ExecutionNonce = z.infer<typeof executionNonceSchema>;

export const browserSnapshotSchema = z
  .strictObject({
    id: z.number().int().positive().safe(),
    provider: z.literal('adspower'),
    profileId: z.string().min(1),
    name: z.string(),
    account: z.string(),
    amount: z.number().int().nonnegative().safe(),
    count: z.number().int().nonnegative().safe(),
    status: z.enum([
      'idle',
      'queued',
      'starting',
      'working',
      'stopping',
      'failed',
      'recovery_required',
    ]),
    notes: z.string(),
    lastError: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
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

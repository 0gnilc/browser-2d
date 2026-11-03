import { z } from 'zod';

export const failureSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: z.enum(['INVALID_INPUT', 'CONFLICT', 'NOT_FOUND', 'UNAVAILABLE', 'INTERNAL']),
    message: z.string(),
    reason: z
      .enum([
        'ACTIVE_TASK',
        'ACTIVE_CLAIM',
        'INPUT_LOCKED',
        'RECOVERY_REQUIRED',
        'BINDINGS_CHANGED',
        'OPERATION_CONFLICT',
      ])
      .optional(),
  }),
});
export type Failure = z.infer<typeof failureSchema>;

export function failure(
  code: Failure['error']['code'],
  message: string,
  reason?: Failure['error']['reason'],
): Failure {
  return { ok: false, error: { code, message, ...(reason ? { reason } : {}) } };
}

export type Result<T> = { ok: true; value: T } | Failure;
export const resultSchema = <T extends z.ZodType>(value: T) =>
  z.union([z.strictObject({ ok: z.literal(true), value }), failureSchema]);

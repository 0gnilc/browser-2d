import { z } from 'zod';

export const failureSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(['INVALID_INPUT', 'CONFLICT', 'NOT_FOUND', 'UNAVAILABLE', 'INTERNAL']),
    message: z.string(),
  }),
});
export type Failure = z.infer<typeof failureSchema>;

export function failure(code: Failure['error']['code'], message: string): Failure {
  return { ok: false, error: { code, message } };
}

export type Result<T> = { ok: true; value: T } | Failure;
export const resultSchema = <T extends z.ZodType>(value: T) =>
  z.union([z.strictObject({ ok: z.literal(true), value }), failureSchema]);

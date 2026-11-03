import { z } from 'zod';
export const secretRefSchema = z.uuid().brand<'SecretRef'>();
export type SecretRef = z.infer<typeof secretRefSchema>;
export const credentialVaultSchema = z.strictObject({
  version: z.literal(1),
  records: z.record(secretRefSchema, z.string().min(1).max(100_000)),
});

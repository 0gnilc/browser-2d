import { z } from 'zod';
import { to } from '@browser-2d/amount';
import { limits } from './limits';
export const fieldTextSchema = z.string().max(limits.fieldLength);
export const browserIdSchema = z.number().int().positive().safe().brand<'BrowserId'>();
export type BrowserId = z.infer<typeof browserIdSchema>;
export const amountTextSchema = z
  .string()
  .max(limits.fieldLength)
  .refine((value) => {
    try {
      to(value);
      return true;
    } catch {
      return false;
    }
  }, 'Expected a nonnegative exact amount with at most two decimal places');
export const browserStatusSchema = z.enum([
  'idle',
  'queued',
  'starting',
  'working',
  'stopping',
  'failed',
  'recovery_required',
]);
export const browserSchema = z.strictObject({
  id: browserIdSchema,
  provider: z.literal('adspower'),
  profileId: fieldTextSchema.min(1),
  name: fieldTextSchema,
  account: fieldTextSchema,
  amount: amountTextSchema,
  count: z.number().int().nonnegative().safe(),
  status: browserStatusSchema,
  notes: fieldTextSchema,
  lastError: fieldTextSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const browserCreateSchema = browserSchema.pick({
  provider: true,
  profileId: true,
  name: true,
  account: true,
  amount: true,
  notes: true,
});
export const browserUpdateSchema = browserCreateSchema.partial().extend({ id: browserIdSchema });
export type Browser = z.infer<typeof browserSchema>;
export type BrowserCreate = z.infer<typeof browserCreateSchema>;
export type BrowserUpdate = z.infer<typeof browserUpdateSchema>;

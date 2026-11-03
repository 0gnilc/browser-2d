import { z } from 'zod';
import { to } from '@browser-2d/amount';
export const browserIdSchema = z.number().int().positive().safe().brand<'BrowserId'>();
export type BrowserId = z.infer<typeof browserIdSchema>;
export const amountTextSchema = z.string().refine((value) => {
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
  profileId: z.string().min(1),
  name: z.string(),
  account: z.string(),
  amount: amountTextSchema,
  count: z.number().int().nonnegative().safe(),
  status: browserStatusSchema,
  notes: z.string(),
  lastError: z.string(),
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

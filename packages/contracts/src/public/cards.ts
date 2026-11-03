import { z } from 'zod';
import { amountTextSchema } from './browsers';
export const cardIdSchema = z.number().int().positive().safe().brand<'CardId'>();
export type CardId = z.infer<typeof cardIdSchema>;
export const cardStatusSchema = z.enum(['pending', 'processing', 'processed', 'failed']);
export const cardResultSchema = z.strictObject({
  processor: z.literal('baidu-check'),
  kind: z.literal('verification'),
  outcome: z.enum(['success', 'failure']),
  message: z.string(),
  data: z.record(z.string(), z.json()).optional(),
  committedAt: z.iso.datetime(),
});
export const cardSchema = z.strictObject({
  id: cardIdSchema,
  number: z.string(),
  expiryMonth: z.string(),
  expiryYear: z.string(),
  securityCode: z.string(),
  cardholderName: z.string(),
  billingAddress: z.string(),
  billingCity: z.string(),
  billingRegion: z.string(),
  billingPostalCode: z.string(),
  billingCountryCode: z.string(),
  amount: amountTextSchema,
  status: cardStatusSchema,
  extra: z.string(),
  notes: z.string(),
  lastResult: cardResultSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const cardUpdateSchema = cardSchema
  .omit({ amount: true, status: true, lastResult: true, createdAt: true, updatedAt: true })
  .partial()
  .extend({ id: cardIdSchema });
export type Card = z.infer<typeof cardSchema>;
export type CardUpdate = z.infer<typeof cardUpdateSchema>;
export type CardResult = z.infer<typeof cardResultSchema>;

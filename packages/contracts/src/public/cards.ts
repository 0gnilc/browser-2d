import { z } from 'zod';
import { amountTextSchema, fieldTextSchema } from './browsers';
import { limits } from './limits';
export const cardIdSchema = z.number().int().positive().safe().brand<'CardId'>();
export type CardId = z.infer<typeof cardIdSchema>;
export const cardStatusSchema = z.enum(['pending', 'processing', 'processed', 'failed']);
export const cardResultSchema = z.strictObject({
  processor: z.enum(['baidu-check', 'controlled-test']),
  kind: z.literal('verification'),
  outcome: z.enum(['success', 'failure']),
  message: fieldTextSchema,
  data: z.record(fieldTextSchema, z.json()).optional(),
  committedAt: z.iso.datetime(),
});
export const cardSchema = z.strictObject({
  id: cardIdSchema,
  number: fieldTextSchema.min(1),
  expiryMonth: fieldTextSchema.min(1),
  expiryYear: fieldTextSchema.min(1),
  securityCode: fieldTextSchema.min(1),
  cardholderName: fieldTextSchema,
  billingAddress: fieldTextSchema,
  billingCity: fieldTextSchema,
  billingRegion: fieldTextSchema,
  billingPostalCode: fieldTextSchema,
  billingCountryCode: fieldTextSchema,
  amount: amountTextSchema,
  status: cardStatusSchema,
  extra: fieldTextSchema,
  notes: fieldTextSchema,
  lastResult: cardResultSchema.nullable(),
  inputLocked: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const cardUpdateSchema = cardSchema
  .omit({
    inputLocked: true,
    amount: true,
    status: true,
    lastResult: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial()
  .extend({ id: cardIdSchema });
export type Card = z.infer<typeof cardSchema>;
export type CardUpdate = z.infer<typeof cardUpdateSchema>;
export type CardResult = z.infer<typeof cardResultSchema>;

export const cardQuerySchema = z
  .strictObject({
    page: z.number().int().min(1).safe(),
    pageSize: z.number().int().min(1).max(limits.pageSize),
    status: cardStatusSchema.optional(),
    search: fieldTextSchema.optional(),
  })
  .refine(
    ({ page, pageSize }) => Number.isSafeInteger((page - 1) * pageSize),
    'Page offset exceeds safe range',
  );
export const cardPageSchema = z.strictObject({
  items: z.array(cardSchema),
  total: z.number().int().nonnegative().safe(),
  page: z.number().int().positive().safe(),
  pageSize: z.number().int().positive().max(limits.pageSize),
});
export const importTextSchema = z.strictObject({ text: z.string().max(limits.importBytes) });
export const importLineResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    line: z.number().int().positive().max(limits.importLines),
    kind: z.literal('inserted'),
    cardId: cardIdSchema,
  }),
  z.strictObject({
    line: z.number().int().positive().max(limits.importLines),
    kind: z.literal('duplicate'),
  }),
  z.strictObject({
    line: z.number().int().positive().max(limits.importLines),
    kind: z.literal('invalid'),
    message: z.string(),
  }),
  z.strictObject({
    line: z.number().int().positive().max(limits.importLines),
    kind: z.literal('blank'),
  }),
]);
export const cardImportReportSchema = z.strictObject({
  outcome: z.enum(['complete', 'partial']),
  inserted: z.number().int().nonnegative().safe(),
  duplicates: z.number().int().nonnegative().safe(),
  invalid: z.number().int().nonnegative().safe(),
  blank: z.number().int().nonnegative().safe(),
  lines: z.array(importLineResultSchema).max(limits.importLines),
  unprocessedFromLine: z.number().int().positive().max(limits.importLines).nullable(),
  message: z.string(),
});
export type CardQuery = z.infer<typeof cardQuerySchema>;
export type CardPage = z.infer<typeof cardPageSchema>;
export type ImportReport = z.infer<typeof cardImportReportSchema>;
export type ImportLineResult = z.infer<typeof importLineResultSchema>;

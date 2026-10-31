import { z } from 'zod';
import { failureSchema } from './result';

export type Result<T> = { ok: true; value: T } | z.infer<typeof failureSchema>;
export const resultSchema = <T extends z.ZodType>(value: T) =>
  z.union([z.strictObject({ ok: z.literal(true), value }), failureSchema]);
export const idInputSchema = z.strictObject({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const text = z.string().max(16_384);
const requiredText = text.trim().min(1);
const nullableText = z.string().nullable();
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const materialStatusSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
const row = { id: idInputSchema.shape.id, createTime: z.string() };
const deviceFields = {
  symbol: requiredText,
  account: nullableText,
  amount: z.number().finite().nullable(),
  count: integer,
  status: integer,
  note: nullableText,
};
export const deviceSchema = z.strictObject({
  ...row,
  ...deviceFields,
  symbol: z.string(),
  account: z.string().nullable(),
  note: z.string().nullable(),
});
export const deviceCreateSchema = z.strictObject({
  symbol: requiredText,
  account: nullableText.optional(),
  amount: z.number().finite().nullable().optional(),
  count: integer.optional(),
  status: integer.optional(),
  note: nullableText.optional(),
});
export const deviceUpdateSchema = deviceCreateSchema.partial().extend(idInputSchema.shape).strict();
const materialFields = {
  card: requiredText,
  month: requiredText,
  year: requiredText,
  cvv: nullableText,
  name: nullableText,
  address: nullableText,
  city: nullableText,
  state: nullableText,
  zip: nullableText,
  country: nullableText,
  extra: nullableText,
  amount: z.number().finite().nullable(),
  status: materialStatusSchema.nullable(),
  device: nullableText,
  note: nullableText,
};
export const materialSchema = z.strictObject({
  ...row,
  ...materialFields,
  status: integer.nullable(),
  card: z.string(),
  month: z.string(),
  year: z.string(),
});
const materialIdentity = {
  card: requiredText.regex(/^\d{10,}$/),
  month: requiredText.regex(/^(0?[1-9]|1[0-2])$/),
  year: requiredText.regex(/^\d+$/),
  cvv: requiredText.regex(/^\d{3,}$/),
};
export const materialCreateSchema = z.strictObject({
  ...z.object(materialFields).partial().shape,
  ...materialIdentity,
});
export const materialUpdateSchema = z.strictObject({
  ...z.object(materialFields).partial().shape,
  ...z.object(materialIdentity).partial().shape,
  ...idInputSchema.shape,
});
export const historySchema = z.strictObject({
  ...row,
  card: z.string(),
  month: nullableText,
  day: nullableText,
  year: nullableText,
  cvv: nullableText,
  extra: nullableText,
  amount: z.number().finite().nullable(),
  status: integer.nullable(),
  device: nullableText,
  note: nullableText,
});
const pagination = {
  page: z.number().int().min(1).max(1_000_000).optional(),
  pageSize: z.number().int().min(1).max(500).optional(),
};
export const materialQuerySchema = z.strictObject({
  ...pagination,
  card: text.optional(),
  status: materialStatusSchema.optional(),
});
export const historyFilterSchema = z.strictObject({
  card: text.optional(),
  status: materialStatusSchema.optional(),
  note: text.optional(),
  startTime: z.string().max(64).optional(),
  endTime: z.string().max(64).optional(),
});
export const historyQuerySchema = historyFilterSchema.extend(pagination);
const pageSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  });
export const materialPageSchema = pageSchema(materialSchema);
export const historyPageSchema = pageSchema(historySchema);
export const deletedSchema = z.strictObject({ deleted: z.number().int().nonnegative() });
export const importInputSchema = z.strictObject({ text: z.string().max(10_000_000) });
export const importReportSchema = z.strictObject({
  committed: z.number().int().nonnegative(),
  lines: z.array(
    z.strictObject({
      line: z.number().int().positive(),
      outcome: z.enum(['inserted', 'invalid', 'duplicate', 'blank']),
    }),
  ),
});
export const exportTextSchema = z.strictObject({
  text: z.string(),
  count: z.number().int().nonnegative(),
});
export const settingsValuesSchema = z.strictObject({
  adsPowerUrl: z
    .string()
    .max(2048)
    .refine((value) => {
      if (value === '') return true;
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
      } catch {
        return false;
      }
    }),
  viewportWidth: z.number().int().min(1).max(16_384),
  viewportHeight: z.number().int().min(1).max(16_384),
  pageCount: z.number().int().min(1).max(10_000),
});
export const secretChangeSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('retain') }),
  z.strictObject({ action: z.literal('clear') }),
  z.strictObject({
    action: z.literal('replace'),
    value: z.string().min(1).max(16_384),
    persistence: z.enum(['persistent', 'session']),
  }),
]);
export const settingsViewSchema = settingsValuesSchema.extend({
  revision: z.number().int().nonnegative(),
  keyConfigured: z.boolean(),
  credentialMode: z.enum(['none', 'persistent', 'session']),
});
export const settingsSaveSchema = z.strictObject({
  values: settingsValuesSchema,
  expectedRevision: z.number().int().nonnegative(),
  secret: secretChangeSchema,
});
export type Device = z.infer<typeof deviceSchema>;
export type DeviceCreate = z.infer<typeof deviceCreateSchema>;
export type DeviceUpdate = z.infer<typeof deviceUpdateSchema>;
export type Material = z.infer<typeof materialSchema>;
export type MaterialCreate = z.infer<typeof materialCreateSchema>;
export type MaterialUpdate = z.infer<typeof materialUpdateSchema>;
export type MaterialQuery = z.infer<typeof materialQuerySchema>;
export type History = z.infer<typeof historySchema>;
export type HistoryFilter = z.infer<typeof historyFilterSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type SettingsValues = z.infer<typeof settingsValuesSchema>;
export type SettingsView = z.infer<typeof settingsViewSchema>;
export type SettingsSave = z.infer<typeof settingsSaveSchema>;
export type ImportReport = z.infer<typeof importReportSchema>;
export interface BusinessApi {
  devices: {
    list(): Promise<Result<Device[]>>;
    create(input: DeviceCreate): Promise<Result<Device>>;
    update(input: DeviceUpdate): Promise<Result<Device>>;
    delete(input: z.infer<typeof idInputSchema>): Promise<Result<z.infer<typeof deletedSchema>>>;
  };
  materials: {
    page(input?: MaterialQuery): Promise<Result<z.infer<typeof materialPageSchema>>>;
    create(input: MaterialCreate): Promise<Result<Material>>;
    update(input: MaterialUpdate): Promise<Result<Material>>;
    delete(input: z.infer<typeof idInputSchema>): Promise<Result<z.infer<typeof deletedSchema>>>;
    clear(): Promise<Result<z.infer<typeof deletedSchema>>>;
    reset(input: z.infer<typeof idInputSchema>): Promise<Result<Material>>;
    importText(input: z.infer<typeof importInputSchema>): Promise<Result<ImportReport>>;
  };
  history: {
    page(input?: HistoryQuery): Promise<Result<z.infer<typeof historyPageSchema>>>;
    delete(input: z.infer<typeof idInputSchema>): Promise<Result<z.infer<typeof deletedSchema>>>;
    clear(): Promise<Result<z.infer<typeof deletedSchema>>>;
    exportText(input?: HistoryFilter): Promise<Result<z.infer<typeof exportTextSchema>>>;
  };
  settings: {
    get(): Promise<Result<SettingsView>>;
    save(input: SettingsSave): Promise<Result<SettingsView>>;
  };
}

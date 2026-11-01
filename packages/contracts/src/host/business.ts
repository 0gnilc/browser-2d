import { z } from 'zod';
import {
  deletedSchema,
  deviceCreateSchema,
  deviceSchema,
  deviceUpdateSchema,
  exportTextSchema,
  historyFilterSchema,
  historyPageSchema,
  historyQuerySchema,
  idInputSchema,
  importInputSchema,
  importReportSchema,
  materialCreateSchema,
  materialPageSchema,
  materialQuerySchema,
  materialSchema,
  materialUpdateSchema,
  resultSchema,
  settingsSaveSchema,
  settingsValuesSchema,
  settingsViewSchema,
} from '../public/index';

export const businessOperations = {
  'devices.list': { input: z.undefined(), result: resultSchema(z.array(deviceSchema)) },
  'devices.create': { input: deviceCreateSchema, result: resultSchema(deviceSchema) },
  'devices.update': { input: deviceUpdateSchema, result: resultSchema(deviceSchema) },
  'devices.delete': { input: idInputSchema, result: resultSchema(deletedSchema) },
  'materials.page': { input: materialQuerySchema, result: resultSchema(materialPageSchema) },
  'materials.create': { input: materialCreateSchema, result: resultSchema(materialSchema) },
  'materials.update': { input: materialUpdateSchema, result: resultSchema(materialSchema) },
  'materials.delete': { input: idInputSchema, result: resultSchema(deletedSchema) },
  'materials.clear': { input: z.undefined(), result: resultSchema(deletedSchema) },
  'materials.reset': { input: idInputSchema, result: resultSchema(materialSchema) },
  'materials.importText': { input: importInputSchema, result: resultSchema(importReportSchema) },
  'history.page': { input: historyQuerySchema, result: resultSchema(historyPageSchema) },
  'history.delete': { input: idInputSchema, result: resultSchema(deletedSchema) },
  'history.clear': { input: z.undefined(), result: resultSchema(deletedSchema) },
  'history.exportText': { input: historyFilterSchema, result: resultSchema(exportTextSchema) },
  'settings.get': { input: z.undefined(), result: resultSchema(settingsViewSchema) },
  'settings.save': { input: settingsSaveSchema, result: resultSchema(settingsViewSchema) },
};
export type BusinessMethod = keyof typeof businessOperations;
export const businessMethods = Object.keys(businessOperations).filter(
  (key): key is BusinessMethod => key in businessOperations,
);
export const businessChannel = (method: BusinessMethod) => `business:${method}`;
export const secretRefSchema = z.uuid().brand<'SecretRef'>();
export type SecretRef = z.infer<typeof secretRefSchema>;
export const settingsCommitSchema = z.strictObject({
  values: settingsValuesSchema,
  expectedRevision: z.number().int().nonnegative(),
});
export type SettingsCommit = z.infer<typeof settingsCommitSchema>;
const request = <M extends string, T extends z.ZodType>(method: M, input: T) =>
  z.strictObject({
    type: z.literal('business'),
    requestId: z.uuid(),
    method: z.literal(method),
    input,
  });
export const businessRequestSchema = z.discriminatedUnion('method', [
  request('devices.list', z.undefined()),
  request('devices.create', deviceCreateSchema),
  request('devices.update', deviceUpdateSchema),
  request('devices.delete', idInputSchema),
  request('materials.page', materialQuerySchema),
  request('materials.create', materialCreateSchema),
  request('materials.update', materialUpdateSchema),
  request('materials.delete', idInputSchema),
  request('materials.clear', z.undefined()),
  request('materials.reset', idInputSchema),
  request('materials.importText', importInputSchema),
  request('history.page', historyQuerySchema),
  request('history.delete', idInputSchema),
  request('history.clear', z.undefined()),
  request('history.exportText', historyFilterSchema),
  request('settings.get', z.undefined()),
  request('settings.commit', settingsCommitSchema),
]);
export type BusinessRequest = z.infer<typeof businessRequestSchema>;
export const businessResultSchema = z.union([
  resultSchema(z.array(deviceSchema)),
  resultSchema(deviceSchema),
  resultSchema(materialSchema),
  resultSchema(materialPageSchema),
  resultSchema(historyPageSchema),
  resultSchema(deletedSchema),
  resultSchema(importReportSchema),
  resultSchema(exportTextSchema),
  resultSchema(settingsViewSchema),
]);
export const credentialChallengeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    type: z.literal('credential-challenge'),
    kind: z.literal('confirm'),
    bootNonce: z.uuid(),
  }),
  z.strictObject({
    type: z.literal('credential-challenge'),
    kind: z.literal('legacy'),
    bootNonce: z.uuid(),
    value: z.string().min(1).max(16_384),
  }),
  z.strictObject({
    type: z.literal('credential-challenge'),
    kind: z.literal('verify'),
    bootNonce: z.uuid(),
    secretRef: secretRefSchema,
  }),
]);
export const credentialReceiptSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    type: z.literal('credential-receipt'),
    kind: z.literal('confirmed'),
    bootNonce: z.uuid(),
  }),
  z.strictObject({
    type: z.literal('credential-receipt'),
    kind: z.literal('saved'),
    bootNonce: z.uuid(),
    secretRef: secretRefSchema,
  }),
  z.strictObject({
    type: z.literal('credential-receipt'),
    kind: z.literal('verified'),
    bootNonce: z.uuid(),
  }),
  z.strictObject({
    type: z.literal('credential-receipt'),
    kind: z.literal('refused'),
    bootNonce: z.uuid(),
  }),
]);
export type CredentialChallenge = z.infer<typeof credentialChallengeSchema>;
export type CredentialReceipt = z.infer<typeof credentialReceiptSchema>;
export const storageFailureCodeSchema = z.enum([
  'DATABASE_IN_USE',
  'DATABASE_NEWER',
  'DATABASE_UNRECOGNIZED',
  'MIGRATION_CHANGED',
  'BACKUP_FAILED',
  'MIGRATION_FAILED',
  'CREDENTIAL_UNAVAILABLE',
  'INITIALIZATION_FAILED',
]);
export type StorageFailureCode = z.infer<typeof storageFailureCodeSchema>;

export const credentialVaultSchema = z.strictObject({
  version: z.literal(1),
  records: z.record(secretRefSchema, z.string().min(1).max(100_000)),
});

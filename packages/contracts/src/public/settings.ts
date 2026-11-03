import { z } from 'zod';
import { applicationSettingsRegistry } from '../settings-registry';
export const settingsValuesSchema = z.strictObject({
  apiBaseUrl: applicationSettingsRegistry['browser.apiBaseUrl'].schema,
  apiKeyConfigured: z.boolean(),
  maxConcurrentTasks: applicationSettingsRegistry['work.maxConcurrentTasks'].schema,
  sidebarCollapsed: applicationSettingsRegistry['ui.sidebarCollapsed'].schema,
});
export const settingsViewSchema = z.strictObject({
  values: settingsValuesSchema,
  revision: z.number().int().nonnegative().safe(),
});
export const apiKeyActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('keep') }),
  z.strictObject({ kind: z.literal('clear') }),
  z.strictObject({ kind: z.literal('replace'), value: z.string().min(1).max(16_384) }),
]);
export const settingsSaveSchema = z.strictObject({
  values: settingsValuesSchema.omit({ apiKeyConfigured: true }),
  apiKey: apiKeyActionSchema,
  expectedRevision: z.number().int().nonnegative().safe(),
  bindingConfirmationToken: z.uuid().optional(),
});
export const settingsSaveOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('saved'), settings: settingsViewSchema }),
  z.strictObject({
    kind: z.literal('binding_confirmation_required'),
    token: z.uuid(),
    browserCount: z.number().int().nonnegative().safe(),
  }),
]);
export type SettingsValues = z.infer<typeof settingsValuesSchema>;
export type SettingsView = z.infer<typeof settingsViewSchema>;
export type SettingsSave = z.infer<typeof settingsSaveSchema>;
export type SettingsSaveOutcome = z.infer<typeof settingsSaveOutcomeSchema>;

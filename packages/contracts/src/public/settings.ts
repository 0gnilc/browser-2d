import { z } from 'zod';
export const applicationSettingsRegistry = {
  'browser.apiBaseUrl': {
    schema: z.url().refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return (
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
        !url.username &&
        !url.password
      );
    }),
    default: 'http://127.0.0.1:50325',
  },
  'browser.apiKeyRef': { schema: z.string(), default: '' },
  'work.maxConcurrentTasks': { schema: z.number().int().positive().safe(), default: 2 },
  'ui.sidebarCollapsed': { schema: z.boolean(), default: false },
};
export const applicationSettingsSchema = z.strictObject({
  'browser.apiBaseUrl': applicationSettingsRegistry['browser.apiBaseUrl'].schema,
  'browser.apiKeyRef': applicationSettingsRegistry['browser.apiKeyRef'].schema,
  'work.maxConcurrentTasks': applicationSettingsRegistry['work.maxConcurrentTasks'].schema,
  'ui.sidebarCollapsed': applicationSettingsRegistry['ui.sidebarCollapsed'].schema,
});
export type ApplicationSettings = z.infer<typeof applicationSettingsSchema>;
export type SettingsKey = keyof ApplicationSettings;
export const applicationSettingsDefaults: ApplicationSettings = applicationSettingsSchema.parse(
  Object.fromEntries(
    Object.entries(applicationSettingsRegistry).map(([key, entry]) => [key, entry.default]),
  ),
);
export const applicationSettingsSaveSchema = z.strictObject({
  values: applicationSettingsSchema,
  expectedRevision: z.number().int().nonnegative().safe(),
});
export const applicationSettingsViewSchema = z.strictObject({
  values: applicationSettingsSchema,
  revision: z.number().int().nonnegative().safe(),
});

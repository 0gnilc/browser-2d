import { z } from 'zod';
import { limits } from './public/limits';
export const apiBaseUrlSchema = z.string().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    !!url.port &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    value === `http://127.0.0.1:${url.port}`
  );
}, 'Expected http://127.0.0.1:<port>');
export const applicationSettingsRegistry = {
  'browser.apiBaseUrl': {
    schema: apiBaseUrlSchema,
    default: 'http://127.0.0.1:50325',
    exposure: 'public',
  },
  'browser.apiKeyRef': {
    schema: z.union([z.literal(''), z.uuid()]),
    default: '',
    exposure: 'private',
  },
  'work.maxConcurrentTasks': {
    schema: z.number().int().positive().max(limits.concurrentTasks),
    default: 2,
    exposure: 'public',
  },
  'ui.sidebarCollapsed': { schema: z.boolean(), default: false, exposure: 'public' },
} as const;
export const applicationSettingsSchema = z.strictObject({
  'browser.apiBaseUrl': applicationSettingsRegistry['browser.apiBaseUrl'].schema,
  'browser.apiKeyRef': applicationSettingsRegistry['browser.apiKeyRef'].schema,
  'work.maxConcurrentTasks': applicationSettingsRegistry['work.maxConcurrentTasks'].schema,
  'ui.sidebarCollapsed': applicationSettingsRegistry['ui.sidebarCollapsed'].schema,
});
export type ApplicationSettings = z.infer<typeof applicationSettingsSchema>;
export type SettingsKey = keyof ApplicationSettings;
export const applicationSettingsDefaults = applicationSettingsSchema.parse(
  Object.fromEntries(
    Object.entries(applicationSettingsRegistry).map(([key, entry]) => [key, entry.default]),
  ),
);

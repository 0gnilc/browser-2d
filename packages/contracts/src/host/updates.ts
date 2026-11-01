import { z } from 'zod';
import { updateInstallResultSchema, updateStateResultSchema } from '../public/updates';
export const updateOperations = {
  getState: { channel: 'updates:get-state', input: z.undefined(), result: updateStateResultSchema },
  check: { channel: 'updates:check', input: z.undefined(), result: updateStateResultSchema },
  download: { channel: 'updates:download', input: z.undefined(), result: updateStateResultSchema },
  install: { channel: 'updates:install', input: z.undefined(), result: updateInstallResultSchema },
} as const;
export const updateChangedChannel = 'updates:changed';

export const releaseConfigSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('preview') }),
  z.strictObject({
    mode: z.literal('production'),
    channel: z.enum(['stable', 'test']),
    target: z.enum(['win-x64', 'mac-x64', 'mac-arm64', 'linux-x64']),
    feedBaseUrl: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      );
    }, 'A credential-free HTTPS feed is required'),
  }),
]);
export type ReleaseConfig = z.infer<typeof releaseConfigSchema>;

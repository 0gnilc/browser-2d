import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Automation } from '@browser-2d/contracts/host';

const responseSchema = z.object({ code: z.number().int(), data: z.unknown().optional() });
const activeSchema = z.object({ status: z.enum(['Active', 'Inactive']) });
const startedSchema = z.object({ ws: z.object({ puppeteer: z.url() }) });

export function createAdsPowerClient(options: { apiBaseUrl: string; apiKey: string }) {
  const base = new URL(options.apiBaseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password)
    throw new Error('AdsPower verification requires the loopback API');
  let preceding = Promise.resolve();
  let lastRequest = 0;
  function request(path: string, body?: { profile_id: string } & Record<string, string>) {
    const result = preceding.then(async () => {
      await delay(Math.max(0, 1000 - (Date.now() - lastRequest)));
      lastRequest = Date.now();
      try {
        const response = await fetch(new URL(path, base), {
          method: body ? 'POST' : 'GET',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error();
        const parsed = responseSchema.parse(await response.json());
        if (parsed.code !== 0) throw new Error();
        return parsed.data;
      } catch {
        throw new Error('AdsPower request did not produce a confirmed result');
      }
    });
    preceding = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function status(profileId: string) {
    return activeSchema.parse(
      await request(`/api/v2/browser-profile/active?profile_id=${encodeURIComponent(profileId)}`),
    ).status;
  }
  function environment(profileId: string) {
    let issued = false;
    let resolved = false;
    let opening: Promise<Automation> | undefined;
    return {
      open() {
        opening ??= (async () => {
          if ((await status(profileId)) !== 'Inactive')
            throw new Error('Profile already open; refusing adoption');
          issued = true;
          const raw = await request('/api/v2/browser-profile/start', {
            profile_id: profileId,
            last_opened_tabs: '0',
            proxy_detection: '0',
            delete_cache: '0',
            headless: '0',
          });
          resolved = true;
          try {
            const { ws } = startedSchema.parse(raw);
            return {
              processor: 'baidu-check',
              endpoint: ws.puppeteer,
              url: 'https://www.baidu.com',
            } satisfies Automation;
          } catch {
            throw new Error('AdsPower start did not provide a browser connection');
          }
        })();
        return opening;
      },
      async close() {
        if (!issued) return;
        await request('/api/v2/browser-profile/stop', { profile_id: profileId });
        for (let attempt = 0; attempt < 10; attempt++) {
          if ((await status(profileId)) === 'Inactive') return;
        }
        throw new Error('AdsPower environment closure not confirmed');
      },
      async closed() {
        if (!issued) return true;
        return resolved && (await status(profileId)) === 'Inactive';
      },
      get issued() {
        return issued;
      },
      get startResolved() {
        return resolved;
      },
    };
  }
  return { environment, status };
}

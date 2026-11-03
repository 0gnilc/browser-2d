import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { sessionFingerprintSchema, type SessionFingerprint } from '@browser-2d/contracts/host';

export type ProfileObservation = { kind: 'inactive' } | { kind: 'active'; endpoint: string | null };
export type StartOutcome =
  | { kind: 'opened'; session: SessionFingerprint }
  | { kind: 'not_started'; message: string }
  | { kind: 'uncertain'; message: string };
export type CloseOutcome =
  | { kind: 'closed'; session: SessionFingerprint }
  | { kind: 'uncertain' | 'foreign_session'; message: string };
export interface BrowserPlatform {
  inspect(profileId: string): Promise<ProfileObservation>;
  start(profileId: string): Promise<StartOutcome>;
  closeOwned(input: { profileId: string; session: SessionFingerprint }): Promise<CloseOutcome>;
}
const responseSchema = z.object({ code: z.number().int(), data: z.unknown().optional() });
const activeSchema = z.object({
  status: z.enum(['Active', 'Inactive']),
  ws: z.object({ puppeteer: z.url() }).optional(),
});
const startedSchema = z.object({ ws: z.object({ puppeteer: z.url() }) });
const cdpMessageSchema = z.object({
  id: z.number().optional(),
  result: z.object({ product: z.string().optional() }).passthrough().optional(),
  error: z.unknown().optional(),
});
export function sessionFromEndpoint(endpoint: string): SessionFingerprint {
  const url = new URL(endpoint);
  const match = /^\/devtools\/browser\/([A-Za-z0-9-]+)$/.exec(url.pathname);
  if (
    url.protocol !== 'ws:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match?.[1]
  )
    throw new Error('Unsupported browser session');
  return sessionFingerprintSchema.parse({ endpoint, browserTargetId: match[1] });
}
export function createAdsPowerClient(options: {
  apiBaseUrl: string;
  apiKey: string;
}): BrowserPlatform {
  const base = new URL(options.apiBaseUrl);
  if (
    base.protocol !== 'http:' ||
    base.hostname !== '127.0.0.1' ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw new Error('Unsupported AdsPower API');
  let preceding = Promise.resolve();
  let lastRequest = 0;
  function request(path: string, body?: Record<string, string>) {
    const result = preceding.then(async () => {
      await delay(Math.max(0, 1000 - (Date.now() - lastRequest)));
      lastRequest = Date.now();
      const response = await fetch(new URL(path, base), {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error('Provider response unavailable');
      const parsed = responseSchema.parse(await response.json());
      if (parsed.code !== 0) throw new Error('Provider did not confirm success');
      return parsed.data;
    });
    preceding = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function inspect(profileId: string): Promise<ProfileObservation> {
    const value = activeSchema.parse(
      await request(`/api/v2/browser-profile/active?profile_id=${encodeURIComponent(profileId)}`),
    );
    return value.status === 'Inactive'
      ? { kind: 'inactive' }
      : { kind: 'active', endpoint: value.ws?.puppeteer ?? null };
  }
  return {
    inspect,
    async start(profileId) {
      try {
        const value = startedSchema.parse(
          await request('/api/v2/browser-profile/start', {
            profile_id: profileId,
            last_opened_tabs: '0',
            proxy_detection: '0',
            delete_cache: '0',
            headless: '0',
          }),
        );
        return { kind: 'opened', session: sessionFromEndpoint(value.ws.puppeteer) };
      } catch {
        return { kind: 'uncertain', message: 'Environment start result is unknown' };
      }
    },
    async closeOwned({ profileId, session }) {
      try {
        const validated = sessionFromEndpoint(session.endpoint);
        if (validated.browserTargetId !== session.browserTargetId)
          throw new Error('Session mismatch');
        const current = await inspect(profileId);
        if (current.kind === 'active' && current.endpoint !== session.endpoint)
          return {
            kind: 'foreign_session',
            message: 'The profile now belongs to a different session',
          };
        let commandSent = false;
        try {
          await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(session.endpoint);
            const timer = setTimeout(() => {
              ws.close();
              reject(new Error('Owned session close not confirmed'));
            }, 10_000);
            const finish = (error?: Error) => {
              clearTimeout(timer);
              ws.close();
              if (error) reject(error);
              else resolve();
            };
            ws.addEventListener('error', () => finish(new Error('Owned session unavailable')));
            ws.addEventListener('open', () =>
              ws.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' })),
            );
            ws.addEventListener('message', ({ data }) => {
              let raw: unknown;
              try {
                raw = JSON.parse(String(data));
              } catch {
                finish(new Error('Invalid owned session reply'));
                return;
              }
              const parsed = cdpMessageSchema.safeParse(raw);
              if (!parsed.success) {
                finish(new Error('Owned session identity unavailable'));
                return;
              }
              if (parsed.data.id === 1) {
                if (!parsed.data.result || parsed.data.error) {
                  finish(new Error('Owned session identity unavailable'));
                  return;
                }
                commandSent = true;
                ws.send(JSON.stringify({ id: 2, method: 'Browser.close' }));
              }
            });
            ws.addEventListener('close', () =>
              finish(commandSent ? undefined : new Error('Owned session disconnected')),
            );
          });
        } catch {
          if (current.kind !== 'inactive')
            return { kind: 'uncertain', message: 'Owned environment closure is not confirmed' };
        }
        for (let attempt = 0; attempt < 12; attempt++) {
          const observed = await inspect(profileId);
          if (observed.kind === 'inactive') return { kind: 'closed', session };
          if (observed.endpoint !== session.endpoint)
            return { kind: 'foreign_session', message: 'A replacement environment is active' };
        }
      } catch {
        /* Provider uncertainty must retain the reservation. */
      }
      return { kind: 'uncertain', message: 'Owned environment closure is not confirmed' };
    },
  };
}

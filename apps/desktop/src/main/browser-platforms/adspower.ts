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
export type CloseCheckpoint =
  | {
      kind: 'stage';
      stage:
        | 'validate-session'
        | 'pre-inspect'
        | 'ws-connect'
        | 'ws-open'
        | 'get-version-sent'
        | 'close-sent'
        | 'ws-error'
        | 'ws-timeout'
        | 'cdp-failed'
        | 'post-inspect'
        | 'close-failed';
    }
  | { kind: 'http'; status: number }
  | { kind: 'provider'; schemaValid: boolean; code: number | null }
  | { kind: 'profile'; schemaValid: boolean; status: 'Active' | 'Inactive' | null }
  | {
      kind: 'cdp-message';
      jsonValid: boolean;
      schemaValid: boolean;
      id: number | null;
      hasResult: boolean;
      hasError: boolean;
      errorCode: number | null;
    }
  | { kind: 'ws-close'; code: number; commandSent: boolean };
type TraceClose = (checkpoint: CloseCheckpoint) => void;
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
  onCloseCheckpoint?: (attempt: number, checkpoint: CloseCheckpoint) => void;
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
  let closeAttempt = 0;
  function request(path: string, body?: Record<string, string>, trace?: TraceClose) {
    const result = preceding.then(async () => {
      await delay(Math.max(0, 1000 - (Date.now() - lastRequest)));
      lastRequest = Date.now();
      const response = await fetch(new URL(path, base), {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
      trace?.({ kind: 'http', status: response.status });
      if (!response.ok) throw new Error('Provider response unavailable');
      const parsed = responseSchema.safeParse(await response.json());
      trace?.({
        kind: 'provider',
        schemaValid: parsed.success,
        code: parsed.success ? parsed.data.code : null,
      });
      if (!parsed.success) throw parsed.error;
      if (parsed.data.code !== 0) throw new Error('Provider did not confirm success');
      return parsed.data.data;
    });
    preceding = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function inspect(profileId: string, trace?: TraceClose): Promise<ProfileObservation> {
    const parsed = activeSchema.safeParse(
      await request(
        `/api/v2/browser-profile/active?profile_id=${encodeURIComponent(profileId)}`,
        undefined,
        trace,
      ),
    );
    trace?.({
      kind: 'profile',
      schemaValid: parsed.success,
      status: parsed.success ? parsed.data.status : null,
    });
    if (!parsed.success) throw parsed.error;
    const value = parsed.data;
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
      const attempt = ++closeAttempt;
      let checkpointCount = 0;
      const trace: TraceClose = (checkpoint) => {
        if (checkpointCount++ < 128) options.onCloseCheckpoint?.(attempt, checkpoint);
      };
      try {
        trace({ kind: 'stage', stage: 'validate-session' });
        const validated = sessionFromEndpoint(session.endpoint);
        if (validated.browserTargetId !== session.browserTargetId)
          throw new Error('Session mismatch');
        trace({ kind: 'stage', stage: 'pre-inspect' });
        const current = await inspect(profileId, trace);
        if (current.kind === 'active' && current.endpoint !== session.endpoint)
          return {
            kind: 'foreign_session',
            message: 'The profile now belongs to a different session',
          };
        let commandSent = false;
        try {
          await new Promise<void>((resolve, reject) => {
            trace({ kind: 'stage', stage: 'ws-connect' });
            const ws = new WebSocket(session.endpoint);
            let settled = false;
            const timer = setTimeout(() => {
              trace({ kind: 'stage', stage: 'ws-timeout' });
              finish(new Error('Owned session close not confirmed'));
            }, 10_000);
            const finish = (error?: Error) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              ws.close();
              if (error) reject(error);
              else resolve();
            };
            ws.addEventListener('error', () => {
              trace({ kind: 'stage', stage: 'ws-error' });
              finish(commandSent ? undefined : new Error('Owned session unavailable'));
            });
            ws.addEventListener('open', () => {
              if (settled) return;
              trace({ kind: 'stage', stage: 'ws-open' });
              ws.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }));
              trace({ kind: 'stage', stage: 'get-version-sent' });
            });
            ws.addEventListener('message', ({ data }) => {
              if (settled) return;
              let raw: unknown;
              try {
                raw = JSON.parse(String(data));
              } catch {
                trace({
                  kind: 'cdp-message',
                  jsonValid: false,
                  schemaValid: false,
                  id: null,
                  hasResult: false,
                  hasError: false,
                  errorCode: null,
                });
                finish(new Error('Invalid owned session reply'));
                return;
              }
              const parsed = cdpMessageSchema.safeParse(raw);
              const error = parsed.success
                ? z.object({ code: z.number().int() }).safeParse(parsed.data.error)
                : null;
              trace({
                kind: 'cdp-message',
                jsonValid: true,
                schemaValid: parsed.success,
                id: parsed.success ? (parsed.data.id ?? null) : null,
                hasResult: parsed.success && parsed.data.result !== undefined,
                hasError: parsed.success && parsed.data.error !== undefined,
                errorCode: error?.success ? error.data.code : null,
              });
              if (!parsed.success) {
                finish(new Error('Owned session identity unavailable'));
                return;
              }
              if (parsed.data.id === 2 && parsed.data.error !== undefined) {
                finish(new Error('Owned session close rejected'));
                return;
              }
              if (parsed.data.id === 1 && !commandSent) {
                if (!parsed.data.result || parsed.data.error) {
                  finish(new Error('Owned session identity unavailable'));
                  return;
                }
                ws.send(JSON.stringify({ id: 2, method: 'Browser.close' }));
                commandSent = true;
                trace({ kind: 'stage', stage: 'close-sent' });
              }
            });
            ws.addEventListener('close', ({ code }) => {
              trace({ kind: 'ws-close', code, commandSent });
              finish(commandSent ? undefined : new Error('Owned session disconnected'));
            });
          });
        } catch {
          trace({ kind: 'stage', stage: 'cdp-failed' });
          if (current.kind !== 'inactive')
            return { kind: 'uncertain', message: 'Owned environment closure is not confirmed' };
        }
        for (let attempt = 0; attempt < 12; attempt++) {
          trace({ kind: 'stage', stage: 'post-inspect' });
          const observed = await inspect(profileId, trace);
          if (observed.kind === 'inactive') return { kind: 'closed', session };
          if (observed.endpoint !== session.endpoint)
            return { kind: 'foreign_session', message: 'A replacement environment is active' };
        }
      } catch {
        trace({ kind: 'stage', stage: 'close-failed' });
      }
      return { kind: 'uncertain', message: 'Owned environment closure is not confirmed' };
    },
  };
}

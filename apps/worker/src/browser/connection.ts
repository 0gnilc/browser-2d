import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { z } from 'zod';

export function loopbackUrl(value: string, protocol: 'http:' | 'ws:'): URL {
  const url = new URL(value);
  if (
    url.protocol !== protocol ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Chrome endpoint must be local');
  return url;
}
export function browserHash(endpoint: string): string {
  const url = loopbackUrl(endpoint, 'ws:');
  if (!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(url.pathname))
    throw new Error('Invalid browser endpoint');
  return createHash('sha256').update(url.pathname).digest('hex');
}
export async function borrowedEndpoint(endpoint: string, signal: AbortSignal): Promise<string> {
  const base = loopbackUrl(endpoint, 'http:');
  if (base.pathname !== '/') throw new Error('Chrome endpoint cannot include a path');
  const response = await fetch(new URL('/json/version', base), { signal, redirect: 'error' });
  if (!response.ok) throw new Error('Chrome discovery unavailable');
  const version = z.object({ webSocketDebuggerUrl: z.string() }).parse(await response.json());
  browserHash(version.webSocketDebuggerUrl);
  return version.webSocketDebuggerUrl;
}
export async function ownedEndpoint(directory: string): Promise<string> {
  const contents = await readFile(join(directory, 'DevToolsActivePort'), 'utf8');
  const [port, path] = contents.trim().split('\n');
  if (!port || !/^\d+$/.test(port) || !path) throw new Error('Chrome discovery unavailable');
  const endpoint = `ws://127.0.0.1:${port}/${path.replace(/^\//, '')}`;
  browserHash(endpoint);
  return endpoint;
}
export function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
  });
}
export async function connect(endpoint: string, signal: AbortSignal): Promise<Browser> {
  signal.throwIfAborted();
  const pending = puppeteer.connect({
    browserWSEndpoint: endpoint,
    defaultViewport: null,
    protocolTimeout: 2000,
  });
  void pending.then(
    (browser) => {
      if (signal.aborted) void browser.disconnect();
    },
    () => {},
  );
  return abortable(pending, signal);
}
export function disconnectOnAbort(browser: Browser, signal: AbortSignal): () => void {
  const abort = () => {
    void browser.disconnect().catch(() => {});
  };
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

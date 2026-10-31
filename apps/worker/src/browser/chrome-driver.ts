import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer, {
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from 'puppeteer-core';
import type { Obligation } from '../work/repository';
import type { WorkDriver, CleanupResult } from '../work/service';
import type { ChromeJournal, ChromeState } from './journal';
import {
  abortable,
  borrowedEndpoint,
  browserHash,
  connect,
  disconnectOnAbort,
  loopbackUrl,
  ownedEndpoint,
} from './connection';
import {
  awaitChildExit,
  executablePath,
  processAbsent,
  processIdentity,
  spawnOwned,
  stopOwnedChild,
  type OwnedChild,
} from './process';

type Attached = {
  browser: Browser;
  context: BrowserContext;
  owner?: Browser;
  session?: CDPSession;
};
const uncertain = (): CleanupResult => ({ kind: 'blocked', reason: 'OWNERSHIP_UNCERTAIN' });

export type ChromeCheckpoint = 'spawned' | 'context-created' | 'cleanup';

export function createChromeDriver({
  root,
  journal,
  probe = {},
  checkpoint,
}: {
  root: string;
  journal: ChromeJournal;
  probe?: { url?: string; durationMs?: number };
  checkpoint?: (stage: ChromeCheckpoint, operationId: string, signal: AbortSignal) => Promise<void>;
}): WorkDriver {
  if (probe.url) loopbackUrl(probe.url, 'http:');
  const probeOrigin = probe.url ? new URL(probe.url).origin : undefined;
  const durationMs = probe.durationMs ?? 3000;
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 60_000)
    throw new Error('Invalid probe duration');
  const children = new Map<string, OwnedChild>();
  const attached = new Map<string, Attached>();
  const directory = (intent: Obligation) => resolve(root, intent.operationId);
  const marker = (intent: Obligation) => `--browser-2d-owner=${intent.ownerToken}`;

  async function disconnect(operationId: string) {
    const active = attached.get(operationId);
    attached.delete(operationId);
    if (active) await Promise.allSettled([active.browser.disconnect(), active.owner?.disconnect()]);
  }
  async function verifyOwned(browser: Browser, intent: Obligation, state: ChromeState) {
    const session = await browser.target().createCDPSession();
    try {
      const { arguments: args } = await session.send('Browser.getBrowserCommandLine');
      const owners = args.filter((arg) => arg.startsWith('--browser-2d-owner='));
      const profiles = args.filter((arg) => arg.startsWith('--user-data-dir='));
      if (
        owners.length !== 1 ||
        owners[0] !== marker(intent) ||
        profiles.length !== 1 ||
        profiles[0] !== `--user-data-dir=${directory(intent)}`
      )
        throw new Error('Chrome ownership mismatch');
      const hash = browserHash(browser.wsEndpoint());
      if (state.mode !== 'launch' || (state.phase === 'attached' && state.browserHash !== hash))
        throw new Error('Chrome instance mismatch');
      const { processInfo } = await session.send('SystemInfo.getProcessInfo');
      const info = processInfo.find((process) => process.type === 'browser');
      if (!info || !Number.isSafeInteger(info.id) || info.id < 1)
        throw new Error('Browser process unavailable');
      const identity = await processIdentity(info.id);
      const live = children.get(intent.operationId);
      if (live && live.child.pid !== info.id) throw new Error('Browser process mismatch');
      if (
        state.phase === 'attached' &&
        (state.pid !== info.id ||
          (state.processIdentity !== null && state.processIdentity !== identity))
      )
        throw new Error('Browser process identity mismatch');
      return { hash, pid: info.id, identity };
    } finally {
      await session.detach().catch(() => {});
    }
  }
  async function launch(intent: Obligation, signal: AbortSignal) {
    const config = journal.config(intent.runId);
    if (config.mode !== 'launch') throw new Error('Wrong Chrome mode');
    const executable = await executablePath(config.executablePath);
    const path = directory(intent);
    const defaults = await puppeteer.defaultArgs({ headless: config.headless, userDataDir: path });
    signal.throwIfAborted();
    await mkdir(root, { recursive: true, mode: 0o700 });
    await mkdir(path, { mode: 0o700 });
    signal.throwIfAborted();
    const args = defaults.filter((arg) => !arg.startsWith('--remote-debugging-'));
    args.push('--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', marker(intent));
    journal.save(intent.operationId, { mode: 'launch', phase: 'attempted' });
    const owned = spawnOwned(executable, args);
    children.set(intent.operationId, owned);
    await checkpoint?.('spawned', intent.operationId, signal);
    const startup = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    let browser: Browser | undefined;
    while (!browser) {
      startup.throwIfAborted();
      if (owned.exited || owned.failedToSpawn) throw new Error('Chrome exited before attachment');
      try {
        browser = await connect(await ownedEndpoint(path), startup);
      } catch {
        await delay(50, undefined, { signal: startup });
      }
    }
    const removeAbort = disconnectOnAbort(browser, startup);
    try {
      const identity = await abortable(
        verifyOwned(browser, intent, { mode: 'launch', phase: 'attempted' }),
        startup,
      );
      journal.save(intent.operationId, {
        mode: 'launch',
        phase: 'attached',
        browserHash: identity.hash,
        pid: identity.pid,
        processIdentity: identity.identity,
      });
      const context = await browser.createBrowserContext();
      attached.set(intent.operationId, { browser, context });
      signal.throwIfAborted();
    } catch (error) {
      await browser.disconnect().catch(() => {});
      throw error;
    } finally {
      removeAbort();
    }
  }
  async function borrow(intent: Obligation, signal: AbortSignal) {
    const config = journal.config(intent.runId);
    if (config.mode !== 'connect') throw new Error('Wrong Chrome mode');
    const endpoint = await borrowedEndpoint(config.endpoint, signal);
    const owner = await connect(endpoint, signal);
    const removeAbort = disconnectOnAbort(owner, signal);
    let browser: Browser | undefined;
    try {
      const session = await owner.target().createCDPSession();
      const hash = browserHash(owner.wsEndpoint());
      journal.save(intent.operationId, { mode: 'connect', phase: 'creating', browserHash: hash });
      const { browserContextId } = await session.send('Target.createBrowserContext', {
        disposeOnDetach: true,
      });
      await checkpoint?.('context-created', intent.operationId, signal);
      journal.save(intent.operationId, {
        mode: 'connect',
        phase: 'known',
        browserHash: hash,
        contextId: browserContextId,
      });
      signal.throwIfAborted();
      browser = await connect(endpoint, signal);
      if (browserHash(browser.wsEndpoint()) !== hash) throw new Error('Chrome instance changed');
      const context = browser
        .browserContexts()
        .find((candidate) => candidate.id === browserContextId);
      if (!context) throw new Error('Isolated Chrome context unavailable');
      attached.set(intent.operationId, { browser, owner, session, context });
    } catch (error) {
      await Promise.allSettled([owner.disconnect(), browser?.disconnect()]);
      throw error;
    } finally {
      removeAbort();
    }
  }
  async function released(intent: Obligation, mode: 'launch' | 'connect'): Promise<CleanupResult> {
    await disconnect(intent.operationId);
    journal.save(intent.operationId, { mode, phase: 'released' });
    children.delete(intent.operationId);
    if (mode === 'launch')
      await rm(directory(intent), { recursive: true, force: true }).catch(() => {});
    return { kind: 'resolved' };
  }
  async function cleanupOwned(
    intent: Obligation,
    state: ChromeState,
    signal: AbortSignal,
  ): Promise<CleanupResult> {
    if (state.mode !== 'launch') return uncertain();
    const live = children.get(intent.operationId);
    if (live?.exited || live?.failedToSpawn) return released(intent, 'launch');
    let browser: Browser;
    try {
      browser = await connect(await ownedEndpoint(directory(intent)), signal);
    } catch {
      if (!live) return uncertain();
      await stopOwnedChild(live, signal);
      return released(intent, 'launch');
    }
    const removeAbort = disconnectOnAbort(browser, signal);
    try {
      const identity = await abortable(verifyOwned(browser, intent, state), signal);
      if (!live && !identity.identity) return uncertain();
      if (state.phase === 'attempted')
        journal.save(intent.operationId, {
          mode: 'launch',
          phase: 'attached',
          browserHash: identity.hash,
          pid: identity.pid,
          processIdentity: identity.identity,
        });
      const session = await browser.target().createCDPSession();
      await session.send('Browser.close').catch(() => {});
      if (live) await awaitChildExit(live, signal);
      else {
        while (!processAbsent(identity.pid)) {
          const currentIdentity = await processIdentity(identity.pid);
          if (processAbsent(identity.pid)) break;
          if (currentIdentity !== identity.identity) return uncertain();
          await delay(25, undefined, { signal });
        }
      }
      signal.throwIfAborted();
      return released(intent, 'launch');
    } finally {
      removeAbort();
      await browser.disconnect().catch(() => {});
    }
  }
  async function cleanupBorrowed(
    intent: Obligation,
    state: ChromeState,
    signal: AbortSignal,
  ): Promise<CleanupResult> {
    if (state.mode !== 'connect' || state.phase !== 'known') return uncertain();
    const config = journal.config(intent.runId);
    if (config.mode !== 'connect') return uncertain();
    const endpoint = await borrowedEndpoint(config.endpoint, signal);
    if (browserHash(endpoint) !== state.browserHash) return uncertain();
    const browser = await connect(endpoint, signal);
    const removeAbort = disconnectOnAbort(browser, signal);
    try {
      if (browserHash(browser.wsEndpoint()) !== state.browserHash) return uncertain();
      const session = await browser.target().createCDPSession();
      const before = await session.send('Target.getBrowserContexts');
      if (before.browserContextIds.includes(state.contextId))
        await session.send('Target.disposeBrowserContext', { browserContextId: state.contextId });
      await disconnect(intent.operationId);
      const after = await session.send('Target.getBrowserContexts');
      signal.throwIfAborted();
      return after.browserContextIds.includes(state.contextId)
        ? uncertain()
        : released(intent, 'connect');
    } finally {
      removeAbort();
      await browser.disconnect().catch(() => {});
    }
  }
  return {
    async acquire(intent, signal) {
      signal.throwIfAborted();
      const state = journal.prepare(intent.operationId);
      if (state.phase !== 'prepared') throw new Error('Chrome operation cannot be replayed');
      if (state.mode === 'launch') await launch(intent, signal);
      else await borrow(intent, signal);
      return {
        ownership: state.mode === 'launch' ? 'owned' : 'borrowed',
        externalId: intent.operationId,
      };
    },
    async execute(resource, run, signal) {
      const active = attached.get(resource.externalId);
      if (!active) throw new Error('Chrome resource is not attached');
      const removeAbort = disconnectOnAbort(active.browser, signal);
      const removeOwnerAbort = active.owner ? disconnectOnAbort(active.owner, signal) : () => {};
      const pageAbort = new AbortController();
      const operation = AbortSignal.any([signal, pageAbort.signal]);
      const pages: Page[] = [];
      const failed = () => pageAbort.abort(new Error('Controlled page closed or crashed'));
      active.browser.on('disconnected', failed);
      active.owner?.on('disconnected', failed);
      try {
        for (let index = 0; index < run.config.pageCount; index++) {
          operation.throwIfAborted();
          const page = await abortable(active.context.newPage(), operation);
          pages.push(page);
          page.on('error', failed);
          page.on('close', failed);
          await abortable(page.setRequestInterception(true), operation);
          page.on('request', (request) => {
            const url = new URL(request.url());
            const allowed =
              url.href === 'about:blank' ||
              url.protocol === 'data:' ||
              (probeOrigin !== undefined && url.origin === probeOrigin);
            void (allowed ? request.continue() : request.abort('blockedbyclient')).catch(() => {});
          });
          await abortable(
            page.setViewport({
              width: run.config.viewportWidth,
              height: run.config.viewportHeight,
            }),
            operation,
          );
          if (probe.url)
            await abortable(
              page.goto(probe.url, { timeout: 15_000, waitUntil: 'load' }),
              operation,
            );
          else
            await abortable(
              page.setContent(
                '<!doctype html><title>Browser 2D controlled workload</title><main>Local browser verification</main>',
              ),
              operation,
            );
        }
        await delay(durationMs, undefined, { signal: operation });
        if (!active.browser.connected || (active.owner && !active.owner.connected))
          throw new Error('Chrome disconnected during execution');
      } finally {
        active.browser.off('disconnected', failed);
        active.owner?.off('disconnected', failed);
        removeAbort();
        removeOwnerAbort();
        for (const page of pages) {
          page.off('error', failed);
          page.off('close', failed);
        }
      }
    },
    async cleanup(intent, signal) {
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(7000)]);
      try {
        bounded.throwIfAborted();
        const config = journal.config(intent.runId);
        const state = journal.get(intent.operationId);
        if (!state) return { kind: 'resolved' };
        if (state.mode !== config.mode) return uncertain();
        if (state.phase === 'released') return { kind: 'resolved' };
        if (state.phase === 'prepared') return released(intent, state.mode);
        await checkpoint?.('cleanup', intent.operationId, bounded);
        const result = await (state.mode === 'launch'
          ? cleanupOwned(intent, state, bounded)
          : cleanupBorrowed(intent, state, bounded));
        if (result.kind === 'blocked') await disconnect(intent.operationId);
        return result;
      } catch {
        await disconnect(intent.operationId);
        return {
          kind: 'blocked',
          reason: bounded.aborted ? 'CLEANUP_FAILED' : 'OWNERSHIP_UNCERTAIN',
        };
      }
    },
  };
}

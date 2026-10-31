import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { app, utilityProcess } from 'electron';
import { claimWorkerOwnership } from './worker-ownership';
import {
  shutdownResultSchema,
  workerEventSchema,
  type WorkerRequest,
  type BusinessRequest,
  type CredentialChallenge,
  type CredentialReceipt,
} from '@browser-2d/contracts/host';
import type { WorkSnapshot } from '@browser-2d/contracts/public';

export function launchWorker(options: {
  dataDir: string;
  businessPath: string;
  execution: 'controlled' | 'chrome';
  onCredentialChallenge: (challenge: CredentialChallenge) => Promise<CredentialReceipt>;
  nativeBinding?: string;
  onSnapshot: (snapshot: WorkSnapshot) => void;
  onUnavailable: (message: string) => void;
}) {
  const require = createRequire(join(app.getAppPath(), 'package.json'));
  const entry = require.resolve('@browser-2d/worker-runtime/entry');
  const ownership = claimWorkerOwnership(options.businessPath);
  let child: Electron.UtilityProcess;
  try {
    child = utilityProcess.fork(entry, [], { serviceName: 'browser-2d-worker' });
  } catch (error) {
    ownership.release();
    throw error;
  }
  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let unavailable: Error | undefined;
  let state: 'starting' | 'challenge' | 'ready' | 'closing' | 'failed' = 'starting';
  let closing = false;
  let exited = false;
  let resolveReady: (snapshot: WorkSnapshot) => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<WorkSnapshot>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let resolveExit: (code: number) => void;
  const exit = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  function armStartupTimeout() {
    clearTimeout(startupTimer);
    startupTimer = setTimeout(() => {
      fail(new Error('Worker readiness timed out'));
      child.kill();
    }, 60_000);
  }
  armStartupTimeout();

  function fail(error: Error) {
    if (unavailable) return;
    unavailable = error;
    state = 'failed';
    clearTimeout(startupTimer);
    clearInterval(heartbeat);
    rejectReady(error);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    if (!closing) options.onUnavailable(error.message);
  }
  child.on('spawn', () => {
    try {
      if (!child.pid) throw new Error('Worker PID is unavailable');
      ownership.authorize(child.pid);
      if (closing || unavailable) {
        child.kill();
        return;
      }
      child.postMessage({
        type: 'initialize',
        ownerNonce: ownership.ownerNonce,
        dataDir: options.dataDir,
        businessPath: options.businessPath,
        execution: options.execution,
        nativeBinding: options.nativeBinding,
      });
      heartbeat = setInterval(() => {
        if (!exited) child.postMessage({ type: 'heartbeat', ownerNonce: ownership.ownerNonce });
      }, 1000);
    } catch {
      fail(new Error('Worker authorization failed'));
      child.kill();
    }
  });
  child.on('message', (raw: unknown) => {
    const parsed = workerEventSchema.safeParse(raw);
    if (!parsed.success) {
      fail(new Error('Invalid worker response'));
      child.kill();
      return;
    }
    const event = parsed.data;
    if (unavailable) return;
    if (event.type === 'credential-challenge') {
      if (state !== 'starting') {
        fail(new Error('Unexpected initialization request'));
        child.kill();
        return;
      }
      state = 'challenge';
      if (event.kind === 'confirm') clearTimeout(startupTimer);
      void options
        .onCredentialChallenge(event)
        .then((receipt) => {
          if (state !== 'challenge' || closing) return;
          state = 'starting';
          armStartupTimeout();
          child.postMessage(receipt);
        })
        .catch(() => {
          if (state !== 'challenge' || closing) return;
          state = 'starting';
          armStartupTimeout();
          child.postMessage({
            type: 'credential-receipt',
            kind: 'refused',
            bootNonce: event.bootNonce,
          });
        });
    } else if (event.type === 'ready') {
      if (state !== 'starting' || closing) return;
      state = 'ready';
      clearTimeout(startupTimer);
      resolveReady(event.snapshot);
      options.onSnapshot(event.snapshot);
    } else if (event.type === 'snapshot') {
      if (state === 'ready' || closing) options.onSnapshot(event.snapshot);
    } else if (event.type === 'fatal' || event.type === 'blocked') {
      fail(new Error(event.type === 'blocked' ? event.code : 'Worker failed'));
      child.kill();
    } else {
      const request = pending.get(event.requestId);
      if (request) {
        clearTimeout(request.timer);
        pending.delete(event.requestId);
        request.resolve(event.result);
      }
    }
  });
  child.on('exit', (code) => {
    exited = true;
    clearInterval(heartbeat);
    try {
      ownership.release();
    } catch {
      options.onUnavailable('Worker ownership record could not be released');
    }
    resolveExit(code);
    fail(new Error(`Worker exited (${code})`));
  });

  function request(message: WorkerRequest | BusinessRequest): Promise<unknown> {
    if (unavailable) return Promise.reject(unavailable);
    if (message.method !== 'shutdown' && state !== 'ready')
      return Promise.reject(new Error('Worker is not ready'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(message.requestId);
        reject(new Error('Worker request timed out'));
      }, 10_000);
      pending.set(message.requestId, { resolve, reject, timer });
      child.postMessage(message);
    });
  }
  let closingPromise: Promise<void> | undefined;
  function close() {
    closingPromise ??= closeWorker();
    return closingPromise;
  }
  async function closeWorker() {
    closing = true;
    state = 'closing';
    clearTimeout(startupTimer);
    rejectReady(new Error('Worker is closing'));
    if (exited) throw unavailable ?? new Error('Worker exited before shutdown');
    const deadline = Date.now() + 10_000;
    let forced = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const cooperative = (async () => {
        const result = shutdownResultSchema.parse(
          await request({ type: 'request', requestId: randomUUID(), method: 'shutdown' }),
        );
        if (!result.ok) throw new Error(result.error.message);
        const code = await exit;
        if (code !== 0) throw new Error(`Worker shutdown exited (${code})`);
      })();
      try {
        await Promise.race([
          cooperative,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Worker cooperative shutdown timed out')),
              Math.max(0, deadline - Date.now()),
            );
          }),
        ]);
        return;
      } catch {
        forced = true;
      } finally {
        clearTimeout(timer);
      }
      if (!exited) {
        child.kill();
        if (!exited && child.pid) {
          try {
            process.kill(child.pid, 'SIGKILL');
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
          }
        }
        await Promise.race([
          exit,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Worker exit not confirmed')), 5000);
          }),
        ]);
      }
      if (forced) throw new Error('Worker did not shut down cleanly');
    } finally {
      clearTimeout(timer);
      clearInterval(heartbeat);
    }
  }

  return {
    ready,
    request,
    close,
    entry,
    get available() {
      return state === 'ready' && !closing && !unavailable;
    },
    get pid() {
      return child.pid;
    },
  };
}

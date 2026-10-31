import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import type { ControlledFixture } from '../../packages/contracts/src/host';

const desktopRequire = createRequire(resolve('apps/desktop/package.json'));
export async function workerHarness(
  application: ElectronApplication,
  options: {
    dataDir: string;
    fixture?: ControlledFixture;
    initialize?: boolean;
    execution?: 'controlled' | 'chrome';
    browserProbe?: { url?: string; durationMs?: number };
    browserFixture?: { directory: string; hold: 'spawned' | 'context-created' | 'cleanup' };
  },
) {
  return application.evaluateHandle(
    ({ utilityProcess }, input) => {
      const child = utilityProcess.fork(input.entry, [], { serviceName: 'p3-fixture-worker' });
      const pending = new Map<
        string,
        {
          resolve: (value: unknown) => void;
          reject: (error: Error) => void;
          timer: ReturnType<typeof setTimeout>;
        }
      >();
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let latest: unknown;
      let exited = false;
      let sequence = 0;
      let readyResolve: (value: unknown) => void;
      let readyReject: (error: Error) => void;
      const ready = new Promise<unknown>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      void ready.catch(() => undefined);
      let exitResolve: (code: number) => void;
      const exit = new Promise<number>((resolve) => {
        exitResolve = resolve;
      });
      child.on('spawn', () => {
        if (!input.initialize) return;
        child.postMessage({
          type: 'initialize',
          ownerNonce: input.ownerNonce,
          dataDir: input.dataDir,
          businessPath: input.businessPath,
          fixture: input.fixture,
          execution: input.execution ?? 'controlled',
          browserProbe: input.browserProbe,
          browserFixture: input.browserFixture,
        });
        heartbeat = setInterval(() => {
          if (!exited) child.postMessage({ type: 'heartbeat', ownerNonce: input.ownerNonce });
        }, 500);
      });
      child.on('message', (event: unknown) => {
        if (!event || typeof event !== 'object' || !('type' in event)) return;
        if ((event.type === 'snapshot' || event.type === 'ready') && 'snapshot' in event) {
          latest = event.snapshot;
          if (event.type === 'ready') readyResolve(latest);
        }
        if (
          (event.type === 'response' || event.type === 'business-response') &&
          'requestId' in event &&
          typeof event.requestId === 'string' &&
          'result' in event
        ) {
          const request = pending.get(event.requestId);
          if (request) {
            clearTimeout(request.timer);
            pending.delete(event.requestId);
            request.resolve(event.result);
          }
        }
        if (event.type === 'credential-challenge' && 'bootNonce' in event && 'kind' in event) {
          child.postMessage({
            type: 'credential-receipt',
            kind: event.kind === 'confirm' ? 'confirmed' : 'refused',
            bootNonce: event.bootNonce,
          });
        }
        if (event.type === 'blocked' || event.type === 'fatal')
          readyReject(new Error('Fixture worker failed'));
      });
      child.on('exit', (code: number) => {
        exited = true;
        clearInterval(heartbeat);
        readyReject(new Error('Fixture worker exited'));
        for (const request of pending.values()) {
          clearTimeout(request.timer);
          request.reject(new Error('Fixture worker exited'));
        }
        pending.clear();
        exitResolve(code);
      });
      function request(message: {
        type: 'request' | 'business';
        method: string;
        input?: unknown;
      }): Promise<unknown> {
        if (exited) return Promise.reject(new Error('Fixture worker exited'));
        const requestId = input.requestIds[sequence++];
        if (!requestId) return Promise.reject(new Error('Fixture request IDs exhausted'));
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error('Fixture request timed out'));
          }, 12_000);
          pending.set(requestId, { resolve, reject, timer });
          child.postMessage({
            ...message,
            ...(message.type === 'business' ? { input: message.input } : {}),
            requestId,
          });
        });
      }
      return {
        ready: () => ready,
        snapshot: () => latest,
        pid: () => child.pid,
        request,
        pauseHeartbeat: () => clearInterval(heartbeat),
        exit: () => exit,
        async close() {
          let response: unknown;
          try {
            response = await request({ type: 'request', method: 'shutdown' });
          } catch {
            response = null;
          }
          return { code: await exit, response };
        },
        async kill() {
          if (!exited && child.pid) process.kill(child.pid, 'SIGKILL');
          return exit;
        },
      };
    },
    {
      ...options,
      initialize: options.initialize ?? true,
      entry: desktopRequire.resolve('@browser-2d/worker-runtime/entry'),
      businessPath: join(options.dataDir, 'data.db'),
      ownerNonce: randomUUID(),
      requestIds: Array.from({ length: 256 }, () => randomUUID()),
    },
  );
}

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { app, utilityProcess } from 'electron';
import {
  shutdownResultSchema,
  workerEventSchema,
  type WorkerRequest,
} from '@browser-2d/contracts/host';
import type { Snapshot } from '@browser-2d/contracts/public';

export function launchWorker(options: {
  dataDir: string;
  nativeBinding?: string;
  onSnapshot: (snapshot: Snapshot) => void;
  onUnavailable: (message: string) => void;
}) {
  const require = createRequire(join(app.getAppPath(), 'package.json'));
  const entry = require.resolve('@browser-2d/worker-runtime/entry');
  const child = utilityProcess.fork(entry, [], { serviceName: 'browser-2d-worker' });
  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let unavailable: Error | undefined;
  let closing = false;
  let exited = false;
  let resolveReady: (snapshot: Snapshot) => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<Snapshot>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let resolveExit: (code: number) => void;
  const exit = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  const startupTimer = setTimeout(() => fail(new Error('Worker readiness timed out')), 15_000);

  function fail(error: Error) {
    if (unavailable) return;
    unavailable = error;
    clearTimeout(startupTimer);
    rejectReady(error);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    if (!closing) options.onUnavailable(error.message);
  }
  child.on('spawn', () =>
    child.postMessage({
      type: 'initialize',
      dataDir: options.dataDir,
      nativeBinding: options.nativeBinding,
    }),
  );
  child.on('message', (raw: unknown) => {
    const parsed = workerEventSchema.safeParse(raw);
    if (!parsed.success) {
      fail(new Error('Invalid worker response'));
      child.kill();
      return;
    }
    const event = parsed.data;
    if (event.type === 'ready') {
      clearTimeout(startupTimer);
      resolveReady(event.snapshot);
      options.onSnapshot(event.snapshot);
    } else if (event.type === 'snapshot') options.onSnapshot(event.snapshot);
    else if (event.type === 'fatal') {
      fail(new Error(event.message));
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
    resolveExit(code);
    fail(new Error(`Worker exited (${code})`));
  });

  function request(message: WorkerRequest): Promise<unknown> {
    if (unavailable) return Promise.reject(unavailable);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(message.requestId);
        reject(new Error('Worker request timed out'));
      }, 10_000);
      pending.set(message.requestId, { resolve, reject, timer });
      child.postMessage(message);
    });
  }
  async function close() {
    closing = true;
    if (exited) throw unavailable ?? new Error('Worker exited before shutdown');
    let shutdownError: unknown;
    try {
      const result = shutdownResultSchema.parse(
        await request({ type: 'request', requestId: randomUUID(), method: 'shutdown' }),
      );
      if (!result.ok) throw new Error(result.error.message);
    } catch (error) {
      shutdownError = error;
      child.kill();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const code = await Promise.race([
        exit,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            try {
              if (child.pid) process.kill(child.pid, 'SIGKILL');
            } catch (error) {
              reject(error);
              return;
            }
            reject(new Error('Worker exit not confirmed'));
          }, 5_000);
        }),
      ]);
      if (shutdownError) throw shutdownError;
      if (code !== 0) throw new Error(`Worker shutdown exited (${code})`);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    ready,
    request,
    close,
    entry,
    get pid() {
      return child.pid;
    },
  };
}

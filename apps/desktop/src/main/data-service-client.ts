import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { app, utilityProcess } from 'electron';
import {
  dataOperations,
  dataServiceEventSchema,
  type DataMethod,
  type DataInput,
  type DataResult,
} from '@browser-2d/contracts/host';
import { claimDataServiceOwnership } from './data-service-ownership';
import { isolatedProcessEnvironment } from './isolated-process-environment';

export interface DataClient {
  request<M extends DataMethod>(method: M, input: DataInput<M>): Promise<DataResult<M>>;
  readonly available: boolean;
}
export function launchDataService(options: {
  dataPath: string;
  nativeBinding?: string;
  onChanged: () => void;
  onUnavailable: () => void;
  entry?: string;
}) {
  const require = createRequire(join(app.getAppPath(), 'package.json'));
  const entry = options.entry ?? require.resolve('@browser-2d/backend/data-service');
  const ownership = claimDataServiceOwnership(options.dataPath);
  let child: Electron.UtilityProcess;
  try {
    child = utilityProcess.fork(entry, [], {
      serviceName: 'browser-2d-data-service',
      env: isolatedProcessEnvironment('data-service'),
    });
  } catch (error) {
    // A failed fork can have an unknown child. Keep its pending ownership record.
    throw new Error('DataService fork was not confirmed', { cause: error });
  }
  let state: 'starting' | 'ready' | 'closing' | 'failed' = 'starting';
  let exited = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const pending = new Map<
    string,
    {
      method: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => undefined);
  let resolveExit!: (code: number) => void;
  const exit = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  let shutdownAck: (() => void) | undefined;
  const startup = setTimeout(() => {
    fail();
    child.kill();
  }, 30_000);
  function fail() {
    const wasClosing = state === 'closing';
    if (state === 'failed') return;
    state = 'failed';
    clearTimeout(startup);
    clearInterval(heartbeat);
    const error = new Error('DataService is unavailable; request progress may be unknown');
    rejectReady(error);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
    if (!wasClosing) options.onUnavailable();
  }
  child.on('spawn', () => {
    try {
      if (!child.pid) throw new Error('DataService PID unavailable');
      ownership.authorize(child.pid);
      if (state !== 'starting') {
        child.kill();
        return;
      }
      child.postMessage({
        type: 'initialize',
        ownerNonce: ownership.ownerNonce,
        dataPath: options.dataPath,
        ...(options.nativeBinding ? { nativeBinding: options.nativeBinding } : {}),
      });
      heartbeat = setInterval(() => {
        if (!exited) child.postMessage({ type: 'heartbeat', ownerNonce: ownership.ownerNonce });
      }, 1000);
    } catch {
      fail();
      child.kill();
    }
  });
  child.on('message', (raw: unknown) => {
    const parsed = dataServiceEventSchema.safeParse(raw);
    if (!parsed.success) {
      fail();
      child.kill();
      return;
    }
    const event = parsed.data;
    if (event.type === 'ready') {
      if (state !== 'starting' || event.ownerNonce !== ownership.ownerNonce) {
        fail();
        return;
      }
      state = 'ready';
      clearTimeout(startup);
      resolveReady();
    } else if (event.type === 'changed') {
      if (state === 'ready') options.onChanged();
    } else if (event.type === 'blocked') fail();
    else if (event.type === 'shutdown-complete') shutdownAck?.();
    else {
      const request = pending.get(event.requestId);
      if (!request || request.method !== event.method) return;
      pending.delete(event.requestId);
      clearTimeout(request.timer);
      request.resolve(event.result);
    }
  });
  child.on('error', fail);
  child.on('exit', (code) => {
    exited = true;
    try {
      ownership.release();
    } catch {
      options.onUnavailable();
    }
    resolveExit(code);
    fail();
  });
  async function request<M extends DataMethod>(
    method: M,
    input: DataInput<M>,
  ): Promise<DataResult<M>> {
    if (state !== 'ready') throw new Error('DataService unavailable');
    const parsedInput = dataOperations[method].input.parse(input);
    const requestId = randomUUID();
    const result = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          pending.delete(requestId);
          reject(new Error('DataService reply lost; progress unknown'));
        },
        method === 'cards.importText' ? 60_000 : 10_000,
      );
      pending.set(requestId, { method, resolve, reject, timer });
      child.postMessage({ type: 'data-request', requestId, method, input: parsedInput });
    });
    return dataOperations[method].result.parse(result) as DataResult<M>;
  }
  let closing: Promise<void> | undefined;
  function close() {
    closing ??= (async () => {
      if (exited) return;
      state = 'closing';
      clearTimeout(startup);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const acknowledged = new Promise<void>((resolve) => {
          shutdownAck = resolve;
        });
        child.postMessage({ type: 'shutdown', requestId: randomUUID() });
        await Promise.race([
          Promise.all([acknowledged, exit]).then(([, code]) => {
            if (code !== 0) throw new Error('DataService shutdown failed');
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('DataService exit not confirmed')), 10_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        clearInterval(heartbeat);
      }
    })();
    return closing;
  }
  return {
    ready,
    request,
    close,
    exit,
    entry,
    get available() {
      return state === 'ready';
    },
    get pid() {
      return child.pid;
    },
  };
}

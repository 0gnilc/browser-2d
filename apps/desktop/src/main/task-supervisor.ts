import { createRequire } from 'node:module';
import { join } from 'node:path';
import { app, utilityProcess } from 'electron';
import { isolatedProcessEnvironment } from './isolated-process-environment';
import {
  browserSnapshotSchema,
  taskProcessEventSchema,
  type Automation,
  type BrowserSnapshot,
  type ExecutionNonce,
  type TaskId,
  type TaskProcessEvent,
  type CardRequest,
  type CardReply,
} from '@browser-2d/contracts/host';

export type TaskLifecycle =
  | { kind: 'starting' }
  | { kind: 'running' }
  | { kind: 'stopping' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'exited'; code: number };

export interface TaskOptions {
  taskId: TaskId;
  executionNonce: ExecutionNonce;
  browser: BrowserSnapshot;
  environment: {
    open: () => Promise<Automation>;
    close: () => Promise<void>;
    closed: () => Promise<boolean>;
  };
  fence: () => Promise<void>;
  release: () => Promise<void>;
  request: (request: CardRequest, sequence: number) => Promise<CardReply>;
  onSpawn?: (pid: number) => Promise<void>;
  running?: () => Promise<void>;
  stopped?: () => void;
  onExit?: (pid: number) => void;
  settled?: (state: TaskLifecycle) => void;
  observe?: (event: TaskProcessEvent) => void;
  deadlineMs?: number;
}

export function launchTask(options: TaskOptions) {
  const require = createRequire(join(app.getAppPath(), 'package.json'));
  const entry = require.resolve('@browser-2d/backend/browser-worker');
  const child = utilityProcess.fork(entry, [], {
    serviceName: 'browser-2d-browser-worker',
    env: isolatedProcessEnvironment('browser-worker'),
  });
  return superviseTask(child, entry, options);
}

export function superviseTask(child: Electron.UtilityProcess, entry: string, options: TaskOptions) {
  const browser = browserSnapshotSchema.parse(options.browser);
  let state: TaskLifecycle = { kind: 'starting' };
  let spawned = false;
  let authorizedPid: number | undefined;
  let exitCode: number | undefined;
  let inFlight = false;
  let awaitingRunning = false;
  let nextSequence = 0;
  let authorize: Promise<void> | undefined;
  let opening: Promise<void> | undefined;
  let stopping: Promise<TaskLifecycle> | undefined;
  let environmentClose: Promise<void> | undefined;
  let release: Promise<void> | undefined;
  let attempt = 0;
  let resolveExit: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  const evidence: {
    gateClosedAt?: number;
    exitedAt?: number;
    environmentClosedAt?: number;
    releasedAt?: number;
  } = {};
  const heartbeat = setInterval(() => {
    if (spawned && exitCode === undefined) child.postMessage({ kind: 'heartbeat' });
  }, 1000);
  const startupTimer = setTimeout(() => {
    if (state.kind === 'starting') void stop();
  }, 40_000);
  child.on('spawn', () => {
    spawned = true;
    try {
      if (!child.pid) throw new Error('Worker PID unavailable');
      authorizedPid = child.pid;
      authorize = options.onSpawn?.(child.pid) ?? Promise.resolve();
      void authorize.catch(() => stop());
    } catch {
      void stop();
    }
    if (state.kind === 'stopping' || state.kind === 'blocked') child.postMessage({ kind: 'stop' });
  });
  child.on('message', (raw: unknown) => {
    if (state.kind === 'stopping' || state.kind === 'blocked' || state.kind === 'exited') return;
    const parsed = taskProcessEventSchema.safeParse(raw);
    if (!parsed.success) {
      void stop();
      return;
    }
    const event = parsed.data;
    if (event.kind === 'host-ready') {
      if (opening) {
        void stop();
        return;
      }
      opening = (async () => {
        await authorize;
        if (!spawned || state.kind !== 'starting') throw new Error('Execution not authorized');
        const automation = await options.environment.open();
        if (state.kind !== 'starting') return;
        child.postMessage({
          kind: 'launch',
          taskId: options.taskId,
          executionNonce: options.executionNonce,
          browser,
          automation,
        });
      })();
      void opening.catch(() => stop());
    } else if (event.kind === 'running') {
      if (state.kind !== 'starting' || awaitingRunning) {
        void stop();
        return;
      }
      awaitingRunning = true;
      void (options.running?.() ?? Promise.resolve())
        .then(() => {
          if (state.kind !== 'starting') return;
          clearTimeout(startupTimer);
          state = { kind: 'running' };
          child.postMessage({ kind: 'work-ready' });
        })
        .catch(() => stop());
    } else if (event.kind === 'request') {
      if (
        state.kind !== 'running' ||
        event.taskId !== options.taskId ||
        event.executionNonce !== options.executionNonce ||
        inFlight ||
        event.sequence !== nextSequence
      ) {
        void stop();
        return;
      }
      inFlight = true;
      nextSequence++;
      void options
        .request(event.request, event.sequence)
        .then((reply) => {
          if (state.kind === 'running')
            child.postMessage({ kind: 'receipt', sequence: event.sequence, reply });
        })
        .catch(() => stop())
        .finally(() => {
          inFlight = false;
        });
    } else if (event.kind === 'failed' || event.kind === 'exhausted') {
      void stop();
    }
    options.observe?.(event);
  });
  child.on('error', () => {
    void stop();
  });
  child.on('exit', (code) => {
    exitCode = code;
    if (authorizedPid) options.onExit?.(authorizedPid);
    evidence.exitedAt = performance.now();
    clearTimeout(startupTimer);
    clearInterval(heartbeat);
    resolveExit(code);
    if (state.kind === 'starting' || state.kind === 'running') void stop();
  });

  function closeEnvironment() {
    environmentClose ??= (async () => {
      await opening?.catch(() => undefined);
      await options.environment.close();
    })().catch((error: unknown) => {
      environmentClose = undefined;
      throw error;
    });
    return environmentClose;
  }

  function stop(): Promise<TaskLifecycle> {
    if (state.kind === 'exited') return Promise.resolve(state);
    if (stopping) return stopping;
    state = { kind: 'stopping' };
    evidence.gateClosedAt ??= performance.now();
    options.stopped?.();
    clearTimeout(startupTimer);
    if (spawned && exitCode === undefined) child.postMessage({ kind: 'stop' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const currentAttempt = ++attempt;
    const cleanup = Promise.all([
      Promise.resolve().then(options.fence),
      (async () => {
        await closeEnvironment();
        const code = await exited;
        if (!(await options.environment.closed()))
          throw new Error('Environment closure not confirmed');
        evidence.environmentClosedAt = performance.now();
        return code;
      })(),
    ]).then(async ([, code]) => {
      if (state.kind !== 'stopping' || currentAttempt !== attempt)
        throw new Error('Cleanup attempt expired');
      release ??= options.release().catch((error: unknown) => {
        release = undefined;
        throw error;
      });
      await release;
      evidence.releasedAt = performance.now();
      return { kind: 'exited', code } satisfies TaskLifecycle;
    });
    stopping = Promise.race([
      cleanup,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Task cleanup deadline exceeded')),
          options.deadlineMs ?? 5000,
        );
      }),
    ])
      .then((result) => {
        state = result;
        options.settled?.(state);
        return result;
      })
      .catch((error: unknown) => {
        state = {
          kind: 'blocked',
          reason: error instanceof Error ? error.message : 'Task cleanup failed',
        };
        options.settled?.(state);
        return state;
      })
      .finally(() => {
        clearTimeout(timer);
        stopping = undefined;
      });
    return stopping;
  }
  return {
    stop,
    exited,
    evidence,
    entry,
    get state() {
      return state;
    },
    cancel: () => child.postMessage({ kind: 'cancel' }),
    pauseHeartbeat: () => clearInterval(heartbeat),
    get pid() {
      return child.pid;
    },
  };
}

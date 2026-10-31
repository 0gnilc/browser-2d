export type ExitIntent =
  { kind: 'quit'; exitCode?: number } | { kind: 'update'; install: () => void; failed: () => void };
type Phase = 'running' | 'stopping' | 'stopping-failed' | 'installer' | 'failed' | 'exiting';

export function createApplicationLifecycle(options: {
  stopAcceptingWork: () => void;
  closeWorker: () => Promise<void>;
  report: (exitCode: number) => Promise<void>;
  exit: (exitCode: number) => void;
  logFailure: (error: unknown) => void;
  schedule?: (action: () => void) => void;
}) {
  let phase: Phase = 'running';
  let intent: ExitIntent | undefined;
  let completion: Promise<void> = Promise.resolve();
  async function finish(selected: ExitIntent) {
    let exitCode = selected.kind === 'quit' ? (selected.exitCode ?? 0) : 0;
    try {
      await options.closeWorker();
    } catch (error) {
      exitCode = 1;
      options.logFailure(error);
    }
    try {
      await options.report(exitCode);
    } catch (error) {
      exitCode = 1;
      options.logFailure(error);
    }
    if (selected.kind === 'update') {
      if (phase === 'stopping-failed') {
        phase = 'failed';
        return;
      }
      if (exitCode !== 0) {
        phase = 'failed';
        selected.failed();
        return;
      }
      phase = 'installer';
      try {
        selected.install();
      } catch (error) {
        options.logFailure(error);
        phase = 'failed';
        selected.failed();
      }
      return;
    }
    phase = 'exiting';
    options.exit(exitCode);
  }
  return {
    get acceptingWork() {
      return phase === 'running';
    },
    get nativeQuitAllowed() {
      return phase === 'installer' || phase === 'exiting';
    },
    get completion() {
      return completion;
    },
    request(selected: ExitIntent): boolean {
      if (phase === 'failed' && selected.kind === 'quit') {
        phase = 'exiting';
        options.exit(1);
        return true;
      }
      if (phase !== 'running') return intent?.kind === selected.kind && phase !== 'failed';
      intent = selected;
      phase = 'stopping';
      options.stopAcceptingWork();
      completion = new Promise<void>((resolve) => {
        (options.schedule ?? setImmediate)(() => {
          void finish(selected).finally(resolve);
        });
      });
      return true;
    },
    installerFailed() {
      if ((phase === 'installer' || phase === 'stopping') && intent?.kind === 'update') {
        phase = phase === 'stopping' ? 'stopping-failed' : 'failed';
        intent.failed();
      }
    },
  };
}
export type ApplicationLifecycle = ReturnType<typeof createApplicationLifecycle>;

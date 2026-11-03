import { Worker } from 'node:worker_threads';
import { taskProcessCommandSchema, taskProcessEventSchema } from '@browser-2d/contracts/host';

export function runBrowserWorkerHost(entry: string) {
  const port = process.parentPort;
  if (!port) throw new Error('BrowserWorker requires an Electron utility process parent');
  let thread: Worker | undefined;
  let stopping = false;
  let lease = Date.now() + 10_000;
  async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(watchdog);
    await thread?.terminate();
    process.exit(0);
  }
  const watchdog = setInterval(() => {
    if (Date.now() > lease) void stop();
  }, 250);
  process.on('uncaughtException', () => process.exit(1));
  process.on('unhandledRejection', () => process.exit(1));
  port.on('message', ({ data }: { data: unknown }) => {
    const command = taskProcessCommandSchema.parse(data);
    if (command.kind === 'stop') {
      void stop();
      return;
    }
    if (stopping) return;
    if (command.kind === 'heartbeat') {
      lease = Date.now() + 10_000;
    } else if (command.kind === 'launch') {
      if (thread) throw new Error('BrowserWorker cannot be relaunched');
      thread = new Worker(entry, { workerData: command, env: {}, argv: process.argv.slice(2) });
      thread.on('message', (message: unknown) =>
        port.postMessage(taskProcessEventSchema.parse(message)),
      );
      thread.on('error', () => process.exit(1));
      thread.on('exit', (code) => {
        if (!stopping) process.exit(code || 1);
      });
    } else {
      thread?.postMessage(command);
    }
  });
  port.postMessage({ kind: 'host-ready' });
}

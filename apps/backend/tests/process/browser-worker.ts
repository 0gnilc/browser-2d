import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { taskIdSchema, taskProcessCommandSchema } from '@browser-2d/contracts/host';
import { runBrowserWorkerHost } from '../../src/browser-worker/host';

if (process.env.BROWSER2D_TEST_SECRET)
  throw new Error('Main environment leaked into BrowserWorker');
const behavior = process.argv[2];
if (isMainThread) {
  process.on('SIGTERM', () =>
    process.parentPort?.postMessage({ kind: 'pulse', sequence: 999_998 }),
  );
  if (behavior === 'ignore-sigterm' && process.platform !== 'win32') {
    process.parentPort?.on('message', ({ data }: { data: unknown }) => {
      const message = taskProcessCommandSchema.safeParse(data);
      if (message.success && message.data.kind === 'cancel') process.kill(process.pid, 'SIGTERM');
    });
  }
  if (behavior === 'freeze-host') {
    process.parentPort?.on('message', ({ data }: { data: unknown }) => {
      const message = taskProcessCommandSchema.safeParse(data);
      if (message.success && message.data.kind === 'cancel') {
        process.parentPort?.postMessage({ kind: 'pulse', sequence: 999_997 });
        const until = Date.now() + 500;
        while (Date.now() < until) Math.sqrt(Date.now());
      }
    });
  }
  runBrowserWorkerHost(__filename);
} else {
  const port = parentPort;
  if (!port) throw new Error('Fixture requires a worker host');
  const launch = taskProcessCommandSchema.parse(workerData);
  if (launch.kind !== 'launch') throw new Error('Expected launch');
  const cancel = new AbortController();
  let sequence = 0;
  let requestSequence = 0;
  let receiptSequence: number | undefined;
  port.on('message', (raw: unknown) => {
    const command = taskProcessCommandSchema.parse(raw);
    if (command.kind === 'cancel') {
      cancel.abort();
      port.postMessage({ kind: 'pulse', sequence: 999_999 });
    }
    if (command.kind === 'receipt' && command.sequence === receiptSequence)
      receiptSequence = undefined;
  });
  if (launch.browser.account !== 'snapshot-input' || launch.browser.amount !== 29)
    throw new Error('Incomplete browser snapshot');
  port.postMessage({ kind: 'running' });
  if (behavior === 'cpu-loop') {
    for (;;) Math.sqrt(Date.now());
  }
  if (behavior === 'crash')
    setTimeout(() => {
      throw new Error('Fixture crash');
    }, 50);
  setInterval(() => {
    port.postMessage({ kind: 'pulse', sequence: ++sequence });
    if (receiptSequence !== undefined) return;
    receiptSequence = requestSequence++;
    port.postMessage({
      kind: 'request',
      sequence: receiptSequence,
      taskId:
        behavior === 'forge-identity'
          ? taskIdSchema.parse('00000000-0000-4000-8000-000000000001')
          : launch.taskId,
      executionNonce: launch.executionNonce,
      request: { kind: 'next_card' },
    });
  }, 20);
}

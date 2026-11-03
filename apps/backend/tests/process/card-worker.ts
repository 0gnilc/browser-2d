import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import { connect } from 'puppeteer-core';
import { to } from '@browser-2d/amount';
import { operationKeySchema, taskProcessCommandSchema } from '@browser-2d/contracts/host';
import { createCardContext } from '../../src/browser-worker/context';
import { runBrowserWorkerHost } from '../../src/browser-worker/host';
const behavior = process.argv[2] ?? 'cards';
if (isMainThread) runBrowserWorkerHost(__filename);
else {
  const port = parentPort;
  if (!port) throw new Error('Controlled processor requires its host');
  const launch = taskProcessCommandSchema.parse(workerData);
  if (launch.kind !== 'launch') throw new Error('Expected launch');
  const context = createCardContext({
    execution: { taskId: launch.taskId, executionNonce: launch.executionNonce },
    post: (value) => port.postMessage(value),
    receive: (listener) => port.on('message', listener),
  });
  port.postMessage({ kind: 'running' });
  void (async () => {
    if (behavior.startsWith('baidu-')) {
      const browser = await connect({ browserWSEndpoint: launch.automation.endpoint });
      const page = await browser.newPage();
      await page.goto('https://www.baidu.com', { waitUntil: 'domcontentloaded' });
      port.postMessage({ kind: 'verified' });
      setInterval(() => {
        void page
          .evaluate('document.readyState')
          .then(() => port.postMessage({ kind: 'pulse', sequence: 1 }));
      }, 250);
    }
    let completed = 0;
    for (;;) {
      const next = await context.nextCard();
      if (next.kind === 'empty') break;
      const input = {
        operationKey: operationKeySchema.parse('controlled.add.v1'),
        identity: { processor: 'controlled-test', version: 1 } as const,
        mutation: { kind: 'add_amount', delta: to('1.00') } as const,
      };
      const added = await context.apply(next.claim, input);
      const replay = await context.apply(next.claim, input);
      if (JSON.stringify(added) !== JSON.stringify(replay))
        throw new Error('Receipt replay changed');
      await context.apply(next.claim, {
        operationKey: operationKeySchema.parse('controlled.fields.v1'),
        identity: { processor: 'controlled-test', version: 1 },
        mutation: { kind: 'set_fields', values: { extra: 'controlled-committed' } },
      });
      port.postMessage({ kind: 'pulse', sequence: ++completed });
      if (behavior.includes('cpu-loop')) for (;;) Math.sqrt(Date.now());
      if (behavior.includes('crash')) process.exit(1);
      if (behavior.includes('hold')) for (;;) await delay(100);
      const result = {
        processor: 'controlled-test',
        kind: 'verification',
        outcome: 'success',
        message: 'Controlled processor verified',
      } as const;
      const done = await context.complete(next.claim, result);
      const again = await context.complete(next.claim, result);
      if (JSON.stringify(done) !== JSON.stringify(again))
        throw new Error('Completion replay changed');
    }
    port.postMessage({ kind: 'exhausted' });
  })().catch(() => port.postMessage({ kind: 'failed' }));
}

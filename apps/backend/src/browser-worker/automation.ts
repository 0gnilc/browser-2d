import { parentPort, workerData } from 'node:worker_threads';
import { taskProcessCommandSchema } from '@browser-2d/contracts/host';
import { connect } from 'puppeteer-core';
import { createCardContext } from './context';
const port = parentPort;
if (!port) throw new Error('Automation requires its BrowserWorker host');
const launch = taskProcessCommandSchema.parse(workerData);
if (launch.kind !== 'launch') throw new Error('Expected a launch');
const context = createCardContext({
  execution: { taskId: launch.taskId, executionNonce: launch.executionNonce },
  post: (value) => port.postMessage(value),
  receive: (listener) => port.on('message', listener),
});
port.postMessage({ kind: 'running' });
void (async () => {
  const browser = await connect({ browserWSEndpoint: launch.automation.endpoint });
  try {
    const page = await browser.newPage();
    await page.goto(launch.automation.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    port.postMessage({ kind: 'verified' });
    for (;;) {
      const next = await context.nextCard();
      if (next.kind === 'empty') break;
      await context.complete(next.claim, {
        processor: 'baidu-check',
        kind: 'verification',
        outcome: 'success',
        message: 'Baidu navigation verified',
      });
    }
    port.postMessage({ kind: 'exhausted' });
  } finally {
    browser.disconnect();
  }
})().catch(() => port.postMessage({ kind: 'failed' }));

import { parentPort, workerData } from 'node:worker_threads';
import { taskProcessCommandSchema } from '@browser-2d/contracts/host';
import { setTimeout as delay } from 'node:timers/promises';
import { connect } from 'puppeteer-core';
const port = parentPort;
if (!port) throw new Error('Automation requires its BrowserWorker host');
const launch = taskProcessCommandSchema.parse(workerData);
if (launch.kind !== 'launch') throw new Error('Expected a launch');
port.postMessage({ kind: 'running' });
const automation = launch.automation;
let stage = 'connect';
void (async () => {
  const browser = await connect({ browserWSEndpoint: automation.endpoint });
  stage = 'new-page';
  const page = await browser.newPage();
  stage = 'navigate';
  await page.goto(automation.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  port.postMessage({ kind: 'verified' });
  stage = 'heartbeat';
  let sequence = 0;
  for (;;) {
    await delay(500);
    await page.evaluate('document.readyState');
    port.postMessage({ kind: 'pulse', sequence: ++sequence });
  }
})().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      kind: 'browser-worker-failed',
      stage,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })}\n`,
  );
  port.postMessage({ kind: 'failed' });
});

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { utilityProcess } from 'electron';
import { z } from 'zod';
import {
  taskIdSchema,
  executionNonceSchema,
  type BrowserSnapshot,
} from '@browser-2d/contracts/host';
import { launchTask } from '../main/task-supervisor';
import { isolatedProcessEnvironment } from '../main/isolated-process-environment';

export async function verifyProductionWorker(options: {
  runtime: string;
  browser: BrowserSnapshot;
  commit: () => Promise<void>;
}) {
  const server = createServer((_request, response) => {
    response.end('<!doctype html><title>BrowserWorker verification</title><p>Local test page</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const pageUrl = `http://127.0.0.1:${address.port}`;
  let platform: Electron.UtilityProcess | undefined;
  let platformExited = false;
  let platformExit: Promise<void> | undefined;
  let verified = false;
  let pulses = 0;
  let released = false;
  let stage = 'worker-starting';
  let platformFailure: string | undefined;
  const worker = launchTask({
    taskId: taskIdSchema.parse(randomUUID()),
    executionNonce: executionNonceSchema.parse(randomUUID()),
    browser: options.browser,
    environment: {
      open() {
        stage = 'platform-starting';
        platform = utilityProcess.fork(
          join(options.runtime, 'verification/browser-platform.cjs'),
          [],
          {
            env: {
              ...isolatedProcessEnvironment('test-browser-platform'),
              TEMP: tmpdir(),
            },
          },
        );
        const child = platform;
        platformExit = new Promise<void>((resolve) =>
          child.once('exit', () => {
            platformExited = true;
            resolve();
          }),
        );
        return new Promise((resolve, reject) => {
          child.once('message', (raw: unknown) => {
            const message = z
              .discriminatedUnion('kind', [
                z.strictObject({ kind: z.literal('ready'), endpoint: z.url() }),
                z.strictObject({ kind: z.literal('failed'), message: z.string() }),
              ])
              .safeParse(raw);
            if (!message.success) {
              reject(new Error('Test Chrome platform failed'));
              return;
            }
            if (message.data.kind === 'failed') {
              platformFailure = message.data.message;
              reject(new Error(platformFailure));
              return;
            }
            stage = 'platform-ready';
            resolve({ processor: 'baidu-check', endpoint: message.data.endpoint, url: pageUrl });
          });
          child.once('error', () => reject(new Error('Test Chrome platform error')));
          child.once('exit', () => reject(new Error('Test Chrome platform exited before ready')));
          child.once('spawn', () =>
            child.postMessage({
              kind: 'open',
              executablePath: process.env.BROWSER2D_CHROME_EXECUTABLE,
            }),
          );
        });
      },
      async close() {
        if (platform && !platformExited) {
          platform.postMessage('close');
          await platformExit;
        }
      },
      async closed() {
        return platformExited;
      },
    },
    fence: options.commit,
    async release() {
      released = true;
    },
    async request() {
      throw new Error('Production probe cannot request card operations');
    },
    observe(event) {
      stage = event.kind;
      if (event.kind === 'verified') verified = true;
      if (event.kind === 'pulse') pulses++;
    },
    deadlineMs: 15_000,
  });
  try {
    const deadline = Date.now() + 30_000;
    while (!verified || pulses < 1) {
      if (
        Date.now() > deadline ||
        worker.state.kind === 'exited' ||
        worker.state.kind === 'blocked'
      )
        throw new Error(
          `Production browser worker navigation failed at ${stage} (${worker.state.kind})${platformFailure ? `: ${platformFailure}` : ''}`,
        );
      await delay(20);
    }
    assert.equal((await worker.stop()).kind, 'exited');
    assert(platformExited && released);
    return {
      behavior: 'production-entry-local-chrome',
      result: 'passed',
      navigationConfirmed: verified,
      pageHeartbeat: pulses > 0,
      platformExited,
      entry: worker.entry,
    };
  } finally {
    await worker.stop();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

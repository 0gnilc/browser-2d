import { launch } from 'puppeteer-core';
import { z } from 'zod';
const port = process.parentPort;
if (!port) throw new Error('Test browser platform requires Electron');
const initialize = z.strictObject({
  kind: z.literal('open'),
  executablePath: z.string().optional(),
});
port.once('message', ({ data }: { data: unknown }) => {
  const input = initialize.parse(data);
  void (async () => {
    process.stderr.write(
      `Test Chrome bootstrap SystemRoot present: ${Boolean(process.env.SystemRoot)}\n`,
    );
    const browser = await launch({
      ...(input.executablePath ? { executablePath: input.executablePath } : { channel: 'chrome' }),
      headless: true,
      args: ['--no-sandbox'],
      timeout: 10_000,
      protocolTimeout: 10_000,
      dumpio: true,
      logger:
        (prefix) =>
        (...args: unknown[]) => {
          process.stderr.write(`${prefix} ${args.map(String).join(' ')}\n`);
        },
    });
    process.stderr.write('Test Chrome bootstrap ready\n');
    const child = browser.process();
    if (!child) throw new Error('Expected owned Chrome process');
    const exit = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    port.on('message', ({ data }: { data: unknown }) => {
      if (data !== 'close') throw new Error('Invalid test platform command');
      void browser
        .close()
        .then(() => exit)
        .then(() => process.exit(0));
    });
    port.postMessage({ kind: 'ready', endpoint: browser.wsEndpoint() });
  })().catch((error: unknown) => {
    port.postMessage({
      kind: 'failed',
      message: error instanceof Error ? error.message : 'Unknown test Chrome launch error',
    });
    process.exit(1);
  });
});

import { launch, type LaunchOptions } from 'puppeteer-core';
import { z } from 'zod';
const port = process.parentPort;
if (!port) throw new Error('Test browser platform requires Electron');
const initialize = z.strictObject({
  kind: z.literal('open'),
  executablePath: z.string().optional(),
  systemRoot: z.string().optional(),
});
port.once('message', ({ data }: { data: unknown }) => {
  const input = initialize.parse(data);
  void (async () => {
    const launchOptions = {
      ...(input.executablePath ? { executablePath: input.executablePath } : { channel: 'chrome' }),
      headless: true,
      args: ['--no-sandbox'],
      timeout: 10_000,
      dumpio: true,
    } satisfies LaunchOptions;
    process.stderr.write('Test Chrome bootstrap attempt: minimal environment\n');
    const browser = await launch(launchOptions).catch(async (error: unknown) => {
      process.stderr.write(
        `Test Chrome minimal environment failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      if (process.platform !== 'win32' || !input.systemRoot) throw error;
      process.stderr.write('Test Chrome bootstrap attempt: minimal environment plus SystemRoot\n');
      const result = await launch({
        ...launchOptions,
        env: { ...process.env, SystemRoot: input.systemRoot },
      });
      process.stderr.write('Test Chrome SystemRoot bootstrap passed\n');
      return result;
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

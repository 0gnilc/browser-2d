import { createServer } from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { createAdsPowerClient } from '../src/main/browser-platforms/adspower';
const close: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(close.splice(0).map((fn) => fn()));
});
async function platform(
  initial: 'Active' | 'Inactive',
  options: { failedStart?: boolean; failedStops?: number; stopGate?: Promise<void> } = {},
) {
  let status = initial;
  let failedStops = options.failedStops ?? 0;
  const stopReceived = Promise.withResolvers<void>();
  const operations: string[] = [];
  const server = createServer((request, response) => {
    expect(request.headers.authorization).toBe('Bearer test-only-key');
    const path = request.url ?? '';
    operations.push(path);
    response.setHeader('Content-Type', 'application/json');
    if (path.includes('/active')) response.end(JSON.stringify({ code: 0, data: { status } }));
    else if (path.endsWith('/start')) {
      status = 'Active';
      if (options.failedStart) request.socket.destroy();
      else
        response.end(
          JSON.stringify({
            code: 0,
            data: { ws: { puppeteer: 'ws://127.0.0.1:12345/devtools/browser/test' } },
          }),
        );
    } else if (path.endsWith('/stop')) {
      stopReceived.resolve();
      void (options.stopGate ?? Promise.resolve()).then(() => {
        if (failedStops > 0) {
          failedStops--;
          response.end(JSON.stringify({ code: -1, msg: 'Stop failed' }));
        } else if (status === 'Inactive') {
          response.end(JSON.stringify({ code: -1, msg: 'Profile is not open' }));
        } else {
          status = 'Inactive';
          response.end(JSON.stringify({ code: 0 }));
        }
      });
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  close.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server');
  return {
    client: createAdsPowerClient({
      apiBaseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: 'test-only-key',
    }),
    operations,
    stopReceived: stopReceived.promise,
  };
}
test('refuses to adopt or stop an already open profile', async () => {
  const { client, operations } = await platform('Active');
  const environment = client.environment('protected');
  await expect(environment.open()).rejects.toThrow('refusing adoption');
  await environment.close();
  expect(environment.issued).toBe(false);
  expect(operations).toEqual(['/api/v2/browser-profile/active?profile_id=protected']);
});
test('starts only after inactive proof and confirms owned environment closure', async () => {
  const { client, operations } = await platform('Inactive');
  const environment = client.environment('dedicated');
  const first = environment.open();
  expect(environment.open()).toBe(first);
  await expect(first).resolves.toMatchObject({
    processor: 'baidu-check',
    url: 'https://www.baidu.com',
  });
  await environment.close();
  await environment.close();
  expect(await environment.closed()).toBe(true);
  expect(operations.filter((path) => path.endsWith('/start'))).toHaveLength(1);
  expect(operations.filter((path) => path.endsWith('/stop'))).toHaveLength(1);
});
test('coalesces pending closes into one stop request', async () => {
  const stopGate = Promise.withResolvers<void>();
  const { client, operations, stopReceived } = await platform('Inactive', {
    stopGate: stopGate.promise,
  });
  const environment = client.environment('dedicated');
  await environment.open();
  const first = environment.close();
  await stopReceived;
  const second = environment.close();
  stopGate.resolve();
  await Promise.all([first, second]);
  expect(operations.filter((path) => path.endsWith('/stop'))).toHaveLength(1);
  expect(await environment.closed()).toBe(true);
});
test('a successful old close cannot stop a replacement environment', async () => {
  const { client, operations } = await platform('Inactive');
  const old = client.environment('dedicated');
  await old.open();
  await old.close();
  const replacement = client.environment('dedicated');
  await replacement.open();
  await old.close();
  expect(await client.status('dedicated')).toBe('Active');
  expect(await old.closed()).toBe(false);
  expect(operations.filter((path) => path.endsWith('/stop'))).toHaveLength(1);
  await replacement.close();
  expect(await replacement.closed()).toBe(true);
});
test('retries a close after its previous attempt has failed', async () => {
  const { client, operations } = await platform('Inactive', { failedStops: 1 });
  const environment = client.environment('dedicated');
  await environment.open();
  await expect(environment.close()).rejects.toThrow('confirmed result');
  expect(await environment.closed()).toBe(false);
  await environment.close();
  expect(await environment.closed()).toBe(true);
  expect(operations.filter((path) => path.endsWith('/stop'))).toHaveLength(2);
});
test('a lost start response stays unresolved even after an inactive status', async () => {
  const { client } = await platform('Inactive', { failedStart: true });
  const environment = client.environment('dedicated');
  await expect(environment.open()).rejects.toThrow('confirmed result');
  await environment.close();
  expect(environment.startResolved).toBe(false);
  expect(await environment.closed()).toBe(false);
});

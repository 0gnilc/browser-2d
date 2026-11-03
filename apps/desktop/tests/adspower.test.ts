import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { afterEach, expect, test } from 'vitest';
import { createAdsPowerClient, sessionFromEndpoint } from '../src/main/browser-platforms/adspower';
const close: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(close.splice(0).map((fn) => fn()));
});
async function platform(options: { lostStart?: boolean; refuseClose?: boolean } = {}) {
  let current: string | null = null;
  const methods: string[] = [];
  const requests: string[] = [];
  const server = createServer((request, response) => {
    expect(request.headers.authorization).toBe('Bearer test-only-key');
    const path = request.url ?? '';
    requests.push(path);
    response.setHeader('Content-Type', 'application/json');
    if (path.includes('/active'))
      response.end(
        JSON.stringify({
          code: 0,
          data: {
            status: current ? 'Active' : 'Inactive',
            ...(current ? { ws: { puppeteer: current } } : {}),
          },
        }),
      );
    else if (path.endsWith('/start')) {
      current = endpoint;
      if (options.lostStart) request.socket.destroy();
      else response.end(JSON.stringify({ code: 0, data: { ws: { puppeteer: endpoint } } }));
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  const sockets = new WebSocketServer({ server, path: '/devtools/browser/owned-session' });
  sockets.on('connection', (socket) => {
    socket.on('message', (bytes) => {
      const message = JSON.parse(bytes.toString());
      methods.push(message.method);
      if (message.method === 'Browser.getVersion')
        socket.send(JSON.stringify({ id: message.id, result: { product: 'ControlledChrome' } }));
      else if (message.method === 'Browser.close') {
        if (!options.refuseClose) {
          current = null;
          socket.close();
        } else {
          socket.close();
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected server');
  const endpoint = `ws://127.0.0.1:${address.port}/devtools/browser/owned-session`;
  close.push(async () => {
    for (const client of sockets.clients) client.terminate();
    await new Promise<void>((resolve) => sockets.close(() => server.close(() => resolve())));
  });
  return {
    client: createAdsPowerClient({
      apiBaseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: 'test-only-key',
    }),
    methods,
    requests,
    session: sessionFromEndpoint(endpoint),
    replace() {
      current = `ws://127.0.0.1:${address.port}/devtools/browser/foreign-session`;
    },
    inactive() {
      current = null;
    },
  };
}
test('closes the exact owned browser endpoint and confirms provider Inactive', async () => {
  const fixture = await platform();
  expect(await fixture.client.inspect('dedicated')).toEqual({ kind: 'inactive' });
  expect(await fixture.client.start('dedicated')).toEqual({
    kind: 'opened',
    session: fixture.session,
  });
  expect(
    await fixture.client.closeOwned({ profileId: 'dedicated', session: fixture.session }),
  ).toEqual({ kind: 'closed', session: fixture.session });
  expect(fixture.methods).toEqual(['Browser.getVersion', 'Browser.close']);
  expect(fixture.requests.some((path) => path.endsWith('/stop'))).toBe(false);
});
test('preserves a foreign replacement and never issues profile-scoped stop', async () => {
  const fixture = await platform();
  await fixture.client.start('dedicated');
  fixture.replace();
  expect(
    await fixture.client.closeOwned({ profileId: 'dedicated', session: fixture.session }),
  ).toMatchObject({ kind: 'foreign_session' });
  expect(fixture.methods).toEqual([]);
  expect(await fixture.client.inspect('dedicated')).toMatchObject({ kind: 'active' });
  expect(fixture.requests.some((path) => path.endsWith('/stop'))).toBe(false);
});
test('a lost start response stays unknown even when a later observation is Inactive', async () => {
  const fixture = await platform({ lostStart: true });
  expect(await fixture.client.start('dedicated')).toMatchObject({ kind: 'uncertain' });
  fixture.inactive();
  expect(await fixture.client.inspect('dedicated')).toEqual({ kind: 'inactive' });
  expect(fixture.requests.filter((path) => path.endsWith('/start'))).toHaveLength(1);
  expect(fixture.methods).toEqual([]);
});
test('refuses mismatched and nonlocal session identities before opening CDP', async () => {
  const fixture = await platform();
  await fixture.client.start('dedicated');
  expect(
    await fixture.client.closeOwned({
      profileId: 'dedicated',
      session: { ...fixture.session, browserTargetId: 'different' },
    }),
  ).toMatchObject({ kind: 'uncertain' });
  expect(fixture.methods).toEqual([]);
  for (const endpoint of [
    'ws://example.com:9222/devtools/browser/test',
    'ws://127.0.0.1:9222/devtools/page/test',
    'ws://user:password@127.0.0.1:9222/devtools/browser/test',
  ])
    expect(() => sessionFromEndpoint(endpoint)).toThrow();
});

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { afterEach, expect, test, vi } from 'vitest';
import {
  createAdsPowerClient,
  sessionFromEndpoint,
  type CloseCheckpoint,
} from '../src/main/browser-platforms/adspower';
const close: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(close.splice(0).map((fn) => fn()));
  vi.unstubAllGlobals();
});
async function platform(
  options: {
    lostStart?: boolean;
    refuseClose?: boolean;
    closeFailure?: 'provider' | 'profile-schema' | 'cdp' | 'close-command';
    disconnect?: 'before-version' | 'after-close';
    afterClose?: 'inactive' | 'active' | 'replacement' | 'unknown';
  } = {},
) {
  let current: string | null = null;
  let closeReceived = false;
  const methods: string[] = [];
  const requests: string[] = [];
  const checkpoints: { attempt: number; checkpoint: CloseCheckpoint }[] = [];
  const server = createServer((request, response) => {
    expect(request.headers.authorization).toBe('Bearer test-only-key');
    const path = request.url ?? '';
    requests.push(path);
    response.setHeader('Content-Type', 'application/json');
    if (path.includes('/active') && closeReceived && options.afterClose === 'unknown') {
      response.end(JSON.stringify({ code: 0, data: { status: 'Unknown' } }));
    } else if (path.includes('/active') && options.closeFailure === 'provider') {
      response.end(JSON.stringify({ code: -42, msg: 'private-provider-detail' }));
    } else if (path.includes('/active') && options.closeFailure === 'profile-schema') {
      response.end(JSON.stringify({ code: 0, data: { status: 'private-provider-detail' } }));
    } else if (path.includes('/active'))
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
      if (message.method === 'Browser.getVersion' && options.disconnect === 'before-version')
        socket.terminate();
      else if (message.method === 'Browser.getVersion' && options.closeFailure === 'cdp')
        socket.send(
          JSON.stringify({
            id: message.id,
            error: { code: -32000, message: 'private-cdp-detail', data: endpoint },
          }),
        );
      else if (message.method === 'Browser.getVersion')
        socket.send(JSON.stringify({ id: message.id, result: { product: 'ControlledChrome' } }));
      else if (message.method === 'Browser.close') {
        closeReceived = true;
        if (options.closeFailure === 'close-command') {
          socket.send(JSON.stringify({ id: message.id, error: { code: -32000 } }));
          socket.terminate();
          return;
        }
        if (options.afterClose === 'replacement')
          current = endpoint.replace('owned-session', 'foreign-session');
        else if (!options.refuseClose && options.afterClose !== 'active') current = null;
        socket.send(JSON.stringify({ id: message.id, result: {} }), () => {
          if (options.disconnect === 'after-close') socket.terminate();
          else socket.close();
        });
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
      onCloseCheckpoint(attempt, checkpoint) {
        checkpoints.push({ attempt, checkpoint });
      },
    }),
    methods,
    checkpoints,
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
  expect(fixture.checkpoints).toContainEqual({
    attempt: 1,
    checkpoint: { kind: 'stage', stage: 'close-sent' },
  });
  expect(fixture.checkpoints).toContainEqual({
    attempt: 1,
    checkpoint: { kind: 'profile', schemaValid: true, status: 'Inactive' },
  });
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

test.each([
  {
    failure: 'provider',
    checkpoint: { kind: 'provider', schemaValid: true, code: -42 },
    stage: 'close-failed',
  },
  {
    failure: 'profile-schema',
    checkpoint: { kind: 'profile', schemaValid: false, status: null },
    stage: 'close-failed',
  },
  {
    failure: 'cdp',
    checkpoint: {
      kind: 'cdp-message',
      jsonValid: true,
      schemaValid: true,
      id: 1,
      hasResult: false,
      hasError: true,
      errorCode: -32000,
    },
    stage: 'cdp-failed',
  },
] as const)(
  'reports redacted $failure close failure checkpoints',
  async ({ failure, checkpoint, stage }) => {
    const fixture = await platform({ closeFailure: failure });
    await fixture.client.start('dedicated');
    expect(
      await fixture.client.closeOwned({ profileId: 'dedicated', session: fixture.session }),
    ).toMatchObject({ kind: 'uncertain' });
    expect(fixture.checkpoints).toContainEqual({ attempt: 1, checkpoint });
    expect(fixture.checkpoints).toContainEqual({
      attempt: 1,
      checkpoint: { kind: 'stage', stage },
    });
    const serialized = JSON.stringify(fixture.checkpoints);
    for (const sensitive of [
      'test-only-key',
      'private-provider-detail',
      'private-cdp-detail',
      fixture.session.endpoint,
      'dedicated',
    ])
      expect(serialized).not.toContain(sensitive);
    expect(fixture.methods).not.toContain('Browser.close');
  },
);

function useChromiumWebSocketErrorOrder() {
  const NativeWebSocket = globalThis.WebSocket;
  vi.stubGlobal(
    'WebSocket',
    class extends NativeWebSocket {
      constructor(...args: ConstructorParameters<typeof NativeWebSocket>) {
        super(...args);
        this.addEventListener('close', ({ code }) => {
          if (code === 1006) this.dispatchEvent(new Event('error'));
        });
      }
    },
  );
}

test.each([
  { afterClose: 'inactive', expected: 'closed' },
  { afterClose: 'active', expected: 'uncertain' },
  { afterClose: 'replacement', expected: 'foreign_session' },
  { afterClose: 'unknown', expected: 'uncertain' },
] as const)(
  'confirms $expected from fresh provider $afterClose after close ACK and socket error',
  async ({ afterClose, expected }) => {
    useChromiumWebSocketErrorOrder();
    const fixture = await platform({ disconnect: 'after-close', afterClose });
    await fixture.client.start('dedicated');
    expect(
      await fixture.client.closeOwned({ profileId: 'dedicated', session: fixture.session }),
    ).toMatchObject({ kind: expected });
    expect(fixture.methods).toEqual(['Browser.getVersion', 'Browser.close']);
    expect(fixture.requests.filter((path) => path.includes('/active')).length).toBeGreaterThan(1);
    expect(fixture.requests.some((path) => path.endsWith('/stop'))).toBe(false);
    expect(fixture.checkpoints.map(({ checkpoint }) => checkpoint)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'cdp-message', id: 2, hasResult: true, hasError: false }),
        { kind: 'stage', stage: 'ws-error' },
        { kind: 'ws-close', code: 1006, commandSent: true },
        { kind: 'stage', stage: 'post-inspect' },
      ]),
    );
    if (afterClose === 'replacement')
      expect(await fixture.client.inspect('dedicated')).toEqual({
        kind: 'active',
        endpoint: fixture.session.endpoint.replace('owned-session', 'foreign-session'),
      });
  },
);

test('keeps a socket failure before the close command uncertain', async () => {
  useChromiumWebSocketErrorOrder();
  const fixture = await platform({ disconnect: 'before-version' });
  await fixture.client.start('dedicated');
  expect(
    await fixture.client.closeOwned({ profileId: 'dedicated', session: fixture.session }),
  ).toMatchObject({ kind: 'uncertain' });
  expect(fixture.methods).toEqual(['Browser.getVersion']);
  expect(fixture.requests.filter((path) => path.includes('/active'))).toHaveLength(1);
});

test('keeps an explicit close command rejection uncertain after the socket disconnects', async () => {
  useChromiumWebSocketErrorOrder();
  const fixture = await platform({ closeFailure: 'close-command' });
  await fixture.client.start('dedicated');
  expect(
    await fixture.client.closeOwned({ profileId: 'dedicated', session: fixture.session }),
  ).toMatchObject({ kind: 'uncertain' });
  expect(fixture.requests.filter((path) => path.includes('/active'))).toHaveLength(1);
  expect(await fixture.client.inspect('dedicated')).toMatchObject({ kind: 'active' });
});

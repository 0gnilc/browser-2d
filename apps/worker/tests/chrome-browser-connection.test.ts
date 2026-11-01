import puppeteer, { type Browser } from 'puppeteer-core';
import { afterEach, expect, it } from 'vitest';
import { browserConnection, connect } from '../src/browser/connection';

const executablePath =
  process.env.BROWSER2D_CHROME_EXECUTABLE ?? (await puppeteer.executablePath('chrome'));
const cleanups: (() => Promise<void>)[] = [];
const poll = { timeout: 5000, interval: 25 };

async function chrome() {
  const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: null });
  const clients: Browser[] = [];
  cleanups.push(async () => {
    await Promise.all(clients.map((client) => client.disconnect()));
    await browser.close();
  });
  return {
    browser,
    async client() {
      const client = await connect(browser.wsEndpoint(), AbortSignal.timeout(5000));
      clients.push(client);
      return client;
    },
  };
}

async function foreignBrowserTarget(harness: Awaited<ReturnType<typeof chrome>>) {
  const owners = new Map<string, Browser>();
  let browser = harness.browser;
  for (let attempt = 0; attempt < 16; attempt++) {
    const session = await browser.target().createCDPSession();
    const connection = session.connection();
    if (!connection) throw new Error('Chrome fixture connection missing');
    const { targetInfo: own } = await connection.send('Target.getTargetInfo');
    const { targetInfo: selected } = await session.send('Target.getTargetInfo');
    await session.detach();
    owners.set(own.targetId, browser);
    if (selected.targetId !== own.targetId) {
      const owner = owners.get(selected.targetId);
      if (!owner) throw new Error('Chrome fixture selected an unknown browser target');
      return { browser, owner, connection, selectedTargetId: selected.targetId };
    }
    browser = await harness.client();
  }
  throw new Error('Chrome fixture did not select a foreign browser target');
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it('reads browser identity after the client owning its cached browser target disconnects', async () => {
  const harness = await chrome();
  const {
    browser,
    owner,
    connection: inspector,
    selectedTargetId,
  } = await foreignBrowserTarget(harness);
  const targetExists = async () => {
    try {
      const { targetInfo } = await inspector.send('Target.getTargetInfo', {
        targetId: selectedTargetId,
      });
      return targetInfo.targetId === selectedTargetId;
    } catch (error) {
      if (error instanceof Error && error.message.includes('No target with given id found'))
        return false;
      throw error;
    }
  };
  expect(await targetExists()).toBe(true);
  await owner.disconnect();
  await expect.poll(targetExists, poll).toBe(false);

  const connection = browserConnection(browser);
  const { arguments: args } = await connection.send('Browser.getBrowserCommandLine');
  expect(args).toContain('--enable-automation');
  const { processInfo } = await connection.send('SystemInfo.getProcessInfo');
  expect(processInfo.find((process) => process.type === 'browser')?.id).toBeGreaterThan(0);
  expect(browser.connected).toBe(true);
}, 20_000);

it('disposes only the contexts owned by a disconnected root connection', async () => {
  const harness = await chrome();
  const sentinel = await harness.browser.newPage();
  await sentinel.setContent('<title>preserve borrowed default page</title>');
  const first = await harness.client();
  const second = await harness.client();
  const observer = await harness.client();
  const inspector = browserConnection(harness.browser);
  const { browserContextId: firstId } = await browserConnection(first).send(
    'Target.createBrowserContext',
    { disposeOnDetach: true },
  );
  const { browserContextId: secondId } = await browserConnection(second).send(
    'Target.createBrowserContext',
    { disposeOnDetach: true },
  );
  const contexts = async () =>
    (await inspector.send('Target.getBrowserContexts')).browserContextIds;
  await observer.disconnect();
  expect((await contexts()).sort()).toEqual([firstId, secondId].sort());

  await first.disconnect();
  await expect.poll(contexts, poll).toEqual([secondId]);
  expect(second.connected).toBe(true);
  expect(await sentinel.title()).toBe('preserve borrowed default page');

  await second.disconnect();
  await expect.poll(contexts, poll).toEqual([]);
  expect(harness.browser.connected).toBe(true);
  expect(await sentinel.title()).toBe('preserve borrowed default page');
}, 20_000);

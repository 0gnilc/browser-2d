import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { observeChrome } from './chrome-observer.mjs';
import { root } from './process.mjs';

const require = createRequire(join(root, 'apps/worker/package.json'));
const puppeteer = require('puppeteer-core');

test('Chrome observation preserves the actual workload viewport', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-observer-test-'));
  const readyPath = join(directory, 'ready');
  const abort = new AbortController();
  let browser;
  let observation;
  try {
    browser = await puppeteer.launch({
      executablePath:
        process.env.BROWSER2D_CHROME_EXECUTABLE || (await puppeteer.executablePath('chrome')),
      headless: true,
      userDataDir: join(directory, 'sessions', 'instance'),
      args: ['--remote-debugging-port=0'],
    });
    const context = await browser.createBrowserContext();
    const pages = [];
    for (let index = 0; index < 4; index++) {
      const page = await context.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setContent('<!doctype html><title>Observer viewport probe</title>');
      pages.push(page);
    }
    const dimensions = () =>
      Promise.all(pages.map((page) => page.evaluate(() => [innerWidth, innerHeight])));
    const expected = Array.from({ length: 4 }, () => [1280, 800]);
    assert.deepEqual(await dimensions(), expected);
    observation = observeChrome(join(directory, 'sessions'), abort.signal, readyPath);
    const deadline = AbortSignal.timeout(10_000);
    while ((await readFile(readyPath, 'utf8').catch(() => '')) !== '4')
      await delay(25, undefined, { signal: deadline });
    abort.abort();
    const result = await observation;
    assert.equal(result.maximumPages, 4);
    assert.equal(result.maximumBrowsers, 1);
    assert.deepEqual(await dimensions(), expected);
  } finally {
    abort.abort();
    try {
      await observation;
    } finally {
      await browser?.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
});

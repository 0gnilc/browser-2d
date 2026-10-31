import { createRequire } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root } from './process.mjs';

const workerRequire = createRequire(join(root, 'apps/worker/package.json'));
const puppeteer = workerRequire('puppeteer-core');

export async function observeChrome(rootDirectory, signal, readyPath) {
  const pids = new Set();
  const versions = new Set();
  let maximumPages = 0;
  let maximumBrowsers = 0;
  while (!signal.aborted) {
    let pages = 0;
    let browsers = 0;
    const names = await readdir(rootDirectory).catch(() => []);
    for (const name of names) {
      let browser;
      try {
        const [port, path] = (
          await readFile(join(rootDirectory, name, 'DevToolsActivePort'), 'utf8')
        )
          .trim()
          .split('\n');
        if (!/^\d+$/.test(port) || !/^\/devtools\/browser\/[\w-]+$/.test(path)) continue;
        browser = await puppeteer.connect({
          browserWSEndpoint: `ws://127.0.0.1:${port}${path}`,
          protocolTimeout: 1000,
        });
        const session = await browser.target().createCDPSession();
        versions.add(await browser.version());
        const processes = await session.send('SystemInfo.getProcessInfo');
        for (const item of processes.processInfo) if (item.type === 'browser') pids.add(item.id);
        const contexts = browser.browserContexts().filter((context) => context.id);
        pages += (await Promise.all(contexts.map((context) => context.pages()))).flat().length;
        browsers += 1;
      } catch {
        // Chrome may exit between discovery and observation.
      } finally {
        await browser?.disconnect();
      }
    }
    maximumPages = Math.max(maximumPages, pages);
    maximumBrowsers = Math.max(maximumBrowsers, browsers);
    if (pages === 4 && readyPath) await writeFile(readyPath, '4', { mode: 0o600 });
    await delay(100);
  }
  return { maximumPages, maximumBrowsers, pids: [...pids], versions: [...versions] };
}

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { createServer } from 'vite';
import { rendererConfig } from '../../internal/build-config/index.mjs';

test('Vite development origin uses the real preload and updates CSS without restarting work', async ({
  browserName: _browserName,
}, testInfo) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'browser-2d-dev-e2e-'));
  const desktop = resolve('apps/desktop');
  const require = createRequire(join(desktop, 'package.json'));
  const server = await createServer({
    ...rendererConfig(resolve('apps/ui')),
    server: { host: '127.0.0.1', port: 0 },
  });
  const stylesheet = resolve('apps/ui/src/style.css');
  const original = await readFile(stylesheet, 'utf8');
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('Vite URL missing');
  const application = await electron.launch({
    executablePath: require('electron'),
    args: [desktop],
    env: { ...process.env, BROWSER2D_DATA_DIR: dataDir, ELECTRON_RENDERER_URL: url },
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByTestId('start-run')).toBeEnabled();
    const pid = await page.getByTestId('worker-pid').textContent();
    await writeFile(stylesheet, `${original}\n:root { --p1-hmr-proof: changed; }\n`);
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--p1-hmr-proof').trim(),
        ),
      )
      .toBe('changed');
    await expect(page.getByTestId('worker-pid')).toHaveText(pid || '');
    await page.getByTestId('duration-ms').fill('100');
    await page.getByTestId('start-run').click();
    await expect(page.getByTestId('run-table')).toContainText('已完成');
    await page.screenshot({ path: testInfo.outputPath('development.png'), fullPage: true });
  } finally {
    await writeFile(stylesheet, original);
    await application.close();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

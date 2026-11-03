import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { developer } from './development-helper';

test('Vite development origin uses the real preload and updates CSS without restarting work', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const stylesheet = resolve('apps/ui/src/style.css');
  const original = await readFile(stylesheet, 'utf8');
  const dev = await developer(testInfo, 'apps/ui/src/App.vue');
  try {
    const { page } = await dev.page();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
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
    const end = dev.original.lastIndexOf('</template>');
    expect(end).toBeGreaterThan(0);
    await writeFile(
      dev.source,
      `${dev.original.slice(0, end)}<span data-testid="template-hmr-proof">Template updated</span>${dev.original.slice(end)}`,
    );
    await expect(page.getByTestId('template-hmr-proof')).toHaveText('Template updated');
    await expect(page.getByTestId('worker-pid')).toHaveText(pid || '');
    await page.getByTestId('task-new').click();
    await page.getByTestId('create-fixture-device').click();
    await expect(page.getByTestId('start-run')).toBeEnabled();
    await page.getByTestId('start-run').click();
    await expect(page.getByTestId('run-table')).toContainText('已完成');
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath('development.png'),
      fullPage: true,
      animations: 'disabled',
    });
  } finally {
    await writeFile(stylesheet, original);
    expect(await dev.close()).toBe(0);
  }
});

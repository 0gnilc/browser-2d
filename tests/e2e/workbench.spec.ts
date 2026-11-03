import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';
const desktop = resolve('apps/desktop');
const require = createRequire(join(desktop, 'package.json'));
async function ready(page: Page) {
  await expect(page.getByTestId('connection-status')).toHaveAttribute('data-state', 'connected');
}
async function discard(page: Page) {
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
}

test('Browser and Card UI preserves raw text, protects drafts and persists settings across restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-ui-'));
  const launch = () =>
    electron.launch({
      executablePath: require('electron'),
      args: [desktop],
      env: { ...process.env, BROWSER2D_DATA_DIR: directory },
    });
  let application = await launch();
  try {
    let page = await application.firstWindow();
    await ready(page);
    await expect(
      page.getByTestId('browsers-table').getByText('添加已有环境 ID，开始管理浏览器工作。'),
    ).toBeVisible();
    await page.getByTestId('browser-add').click();
    await page.getByLabel('环境 ID', { exact: true }).fill('manual-profile-id');
    await page.getByLabel('名称', { exact: true }).fill('Manual Browser');
    await page.getByLabel('账号', { exact: true }).fill('account 0001 entire input');
    await page.getByLabel('任务数值', { exact: true }).fill('12.34');
    await page.keyboard.press('Escape');
    await expect(page.getByText('未保存的修改将丢失。是否放弃修改？')).toBeVisible();
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(page.getByLabel('账号', { exact: true })).toHaveValue('account 0001 entire input');
    const unload = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(unload).toBe(true);
    await page.getByTestId('browser-save').click();
    await expect(page.getByLabel('环境 ID', { exact: true })).toBeHidden();
    await expect(page.getByTestId('browsers-table')).toContainText('account 0001 entire input');
    await page.getByTestId('browser-add').click();
    await page.getByLabel('环境 ID', { exact: true }).fill('manual-profile-id');
    await page.getByTestId('browser-save').click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByLabel('环境 ID', { exact: true })).toHaveValue('manual-profile-id');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await discard(page);
    await page.getByTestId('nav-cards').click();
    await page.getByTestId('card-import-open').click();
    const raw =
      ' 0001 2345-6789 | 01 | 29 | 007 | 姓名 | 1 Main St | Lagos | LA | 0010 | NG | <b>raw text</b> ';
    await page.getByLabel('卡文本', { exact: true }).fill(raw);
    await page.getByTestId('card-import-submit').click();
    await expect(page.getByText('已插入 1，重复 0，无效 0，空行 0。')).toBeVisible();
    await page.locator('#card-import-file').setInputFiles({
      name: 'cards.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(raw, 'utf8'),
    });
    await page.getByTestId('card-import-submit').click();
    await expect(page.getByText('已插入 0，重复 1，无效 0，空行 0。')).toBeVisible();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await discard(page);
    await expect(page.getByTestId('cards-table')).toContainText('0001 2345-6789');
    const stored = await page.evaluate(async () =>
      window.browser2d?.cards.list({ page: 1, pageSize: 20 }),
    );
    expect(stored).toMatchObject({
      ok: true,
      value: {
        total: 1,
        items: [
          {
            number: '0001 2345-6789',
            expiryMonth: '01',
            expiryYear: '29',
            securityCode: '007',
            cardholderName: '姓名',
            billingAddress: '1 Main St',
            billingPostalCode: '0010',
            extra: '<b>raw text</b>',
            amount: '0.00',
            status: 'pending',
            inputLocked: false,
          },
        ],
      },
    });
    await page.getByRole('button', { name: '编辑', exact: true }).first().click();
    await expect(page.locator('#card-amount')).toHaveCount(0);
    await expect(page.locator('#card-status')).toHaveCount(0);
    await page.locator('#card-notes').fill('unsaved note');
    await page
      .locator('.el-overlay:visible')
      .last()
      .click({ position: { x: 5, y: 5 } });
    await expect(page.getByText('未保存的修改将丢失。是否放弃修改？')).toBeVisible();
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await page.getByTestId('card-save').click();
    await expect(page.locator('#card-notes')).toBeHidden();
    await page.getByTestId('nav-settings').click();
    await page.getByLabel('最大并发浏览器数', { exact: true }).fill('3');
    await page.getByTestId('nav-cards').click();
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await expect(page.getByLabel('最大并发浏览器数', { exact: true })).toHaveValue('3');
    await page.getByTestId('settings-save').click();
    await expect(page.getByText('设置已保存。', { exact: true })).toBeVisible();
    await page.getByTestId('sidebar-toggle').click();
    await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await ready(page);
    await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
    const persisted = await page.evaluate(async () => ({
      browsers: await window.browser2d?.browsers.list(),
      settings: await window.browser2d?.settings.get(),
      cards: await window.browser2d?.cards.list({ page: 1, pageSize: 20 }),
    }));
    expect(persisted.browsers).toMatchObject({
      ok: true,
      value: [
        { profileId: 'manual-profile-id', account: 'account 0001 entire input', amount: '12.34' },
      ],
    });
    expect(persisted.settings).toMatchObject({
      ok: true,
      value: { values: { maxConcurrentTasks: 3, sidebarCollapsed: true } },
    });
    expect(persisted.cards).toMatchObject({
      ok: true,
      value: { items: [{ notes: 'unsaved note' }] },
    });
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('fixed workbench verification exercises queued tasks, receipt locks and clean shutdown', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-release-'));
  const application = await electron.launch({
    executablePath: require('electron'),
    args: [desktop, `--verify-workbench=${join(directory, 'report.json')}`],
    env: { ...process.env, BROWSER2D_DATA_DIR: directory },
  });
  try {
    application.process().stderr?.on('data', (data: Buffer) => process.stderr.write(data));
    await expect.poll(() => application.process().exitCode, { timeout: 60_000 }).toBe(0);
    const { readFile } = await import('node:fs/promises');
    const report: unknown = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
    expect(report).toMatchObject({
      result: 'VERIFIED',
      workerExited: true,
      checks: { taskPath: true, queued: true, inputLocked: true },
    });
  } finally {
    if (application.process().exitCode === null) await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});

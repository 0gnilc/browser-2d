import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { hiddenMain } from './hidden-main';
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
  const bootstrap = await hiddenMain(directory);
  const launch = () =>
    electron.launch({
      executablePath: require('electron'),
      args: [bootstrap],
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

for (const mode of ['override', 'default'] as const) {
  test(`fixed workbench verification exercises tasks and reuses regular reports with ${mode} app data`, async () => {
    const directory = await mkdtemp(
      join(tmpdir(), mode === 'default' ? 'browser-2d-default-' : 'browser-2d-release-'),
    );
    const dataDir = mode === 'default' ? join(directory, 'Browser 2D') : directory;
    const reportPath = join(dataDir, 'report.json');
    const env = { ...process.env };
    if (mode === 'default') delete env.BROWSER2D_DATA_DIR;
    else env.BROWSER2D_DATA_DIR = directory;
    try {
      for (let pass = 0; pass < 2; pass++) {
        const child = spawn(
          require('electron'),
          [
            desktop,
            `--verify-workbench=${reportPath}`,
            ...(mode === 'default' ? [`--verify-app-data=${directory}`] : []),
          ],
          { env, stdio: ['ignore', 'ignore', 'pipe'] },
        );
        try {
          child.stderr.on('data', (data: Buffer) => process.stderr.write(data));
          await expect.poll(() => child.exitCode, { timeout: 30_000 }).toBe(0);
          const report: unknown = JSON.parse(await readFile(reportPath, 'utf8'));
          expect(report).toMatchObject({
            result: 'VERIFIED',
            workerExited: true,
            dataOverride: mode === 'override',
            userData: dataDir,
            dataPath: join(dataDir, 'data', 'app.sqlite'),
            checks: { taskPath: true, queued: true, inputLocked: true, initialBrowsers: pass * 2 },
          });
        } finally {
          if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGTERM');
            await exited;
          }
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('Card filters and ascending pages use persisted rows, and Settings keeps, replaces, clears and fences stale drafts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-ui-'));
  const application = await electron.launch({
    executablePath: require('electron'),
    args: [await hiddenMain(directory)],
    env: { ...process.env, BROWSER2D_DATA_DIR: directory },
  });
  try {
    const page = await application.firstWindow();
    await ready(page);
    await page.getByTestId('browser-add').click();
    await page.getByLabel('环境 ID', { exact: true }).fill('binding-proof');
    await page.getByTestId('browser-save').click();
    await expect(page.getByLabel('环境 ID', { exact: true })).toBeHidden();
    await page.getByTestId('nav-cards').click();
    await page.getByTestId('card-import-open').click();
    const numbers = Array.from(
      { length: 25 },
      (_, index) => `000${String(index).padStart(2, '0')}`,
    );
    await page
      .getByLabel('卡文本', { exact: true })
      .fill(numbers.map((number) => `${number} | 01 | 29 | 007 | | | | | | |`).join('\n'));
    await page.getByTestId('card-import-submit').click();
    await expect(page.getByText('已插入 25，重复 0，无效 0，空行 0。')).toBeVisible();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await discard(page);
    const rows = page.getByTestId('cards-table').locator('.el-table__body-wrapper tbody tr');
    await expect(rows).toHaveCount(20);
    expect(await rows.locator('td:first-child').allTextContents()).toEqual(numbers.slice(0, 20));
    await page.getByRole('button', { name: '下一页' }).click();
    await expect(rows).toHaveCount(5);
    expect(await rows.locator('td:first-child').allTextContents()).toEqual(numbers.slice(20));
    await page.getByRole('combobox', { name: '卡状态' }).press('Enter');
    await page.getByRole('option', { name: '已处理', exact: true }).click();
    await page.getByTestId('card-filter').click();
    await expect(page.getByText('没有符合筛选条件的卡', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: '卡状态' }).press('Enter');
    await page.getByRole('option', { name: '待处理', exact: true }).click();
    await page.getByTestId('card-filter').click();
    await expect(rows).toHaveCount(20);
    expect(await rows.locator('td:first-child').allTextContents()).toEqual(numbers.slice(0, 20));
    await page.getByRole('textbox', { name: '搜索卡' }).fill(numbers[24] ?? '');
    await page.getByTestId('card-filter').click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText(numbers[24] ?? '');
    await page.getByTestId('nav-settings').click();
    await page.locator('#settings-api-key-action').press('Enter');
    await page.getByRole('option', { name: '替换密钥', exact: true }).click();
    await page.getByLabel('新 API 密钥', { exact: true }).fill('isolated-synthetic-credential');
    await page.getByLabel('API 地址', { exact: true }).fill('http://127.0.0.1:1');
    await page.getByTestId('settings-save').click();
    await expect(page.getByText('重新确认环境绑定', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '取消保存', exact: true }).click();
    await expect(page.getByLabel('新 API 密钥', { exact: true })).toHaveValue(
      'isolated-synthetic-credential',
    );
    await page.getByTestId('settings-save').click();
    await page.getByRole('button', { name: '确认绑定并保存', exact: true }).click();
    await expect(page.getByText('已配置密钥', { exact: true })).toBeVisible();
    await expect(page.getByLabel('新 API 密钥', { exact: true })).toHaveCount(0);
    expect(
      (await readFile(join(directory, 'credentials.enc'), 'utf8')).includes(
        'isolated-synthetic-credential',
      ),
    ).toBe(false);
    await page.getByLabel('最大并发浏览器数', { exact: true }).fill('4');
    await page.getByTestId('settings-save').click();
    await expect(page.getByText('设置已保存。', { exact: true })).toBeVisible();
    const retained = await page.evaluate(async () => window.browser2d?.settings.get());
    expect(retained).toMatchObject({
      ok: true,
      value: { values: { apiKeyConfigured: true, maxConcurrentTasks: 4 } },
    });
    await page.getByLabel('最大并发浏览器数', { exact: true }).fill('5');
    const external = await page.evaluate(async () => {
      const api = window.browser2d;
      const view = await api?.settings.get();
      if (!api || !view?.ok) throw new Error('Settings unavailable');
      return api.settings.save({
        values: {
          apiBaseUrl: view.value.values.apiBaseUrl,
          sidebarCollapsed: view.value.values.sidebarCollapsed,
          maxConcurrentTasks: 6,
        },
        apiKey: { kind: 'keep' },
        expectedRevision: view.value.revision,
      });
    });
    expect(external).toMatchObject({ ok: true, value: { kind: 'saved' } });
    await page.getByTestId('settings-save').click();
    await expect(page.getByRole('alert')).toContainText('当前草稿已保留');
    await expect(page.getByLabel('最大并发浏览器数', { exact: true })).toHaveValue('5');
    await page.getByRole('button', { name: '重新读取设置', exact: true }).click();
    await discard(page);
    await expect(page.getByLabel('最大并发浏览器数', { exact: true })).toHaveValue('6');
    await page.locator('#settings-api-key-action').press('Enter');
    await page.getByRole('option', { name: '清除密钥', exact: true }).click();
    await page.getByTestId('settings-save').click();
    await page.getByRole('button', { name: '确认绑定并保存', exact: true }).click();
    await expect(page.getByText('未配置密钥', { exact: true })).toBeVisible();
    expect(await page.evaluate(async () => window.browser2d?.settings.get())).toMatchObject({
      ok: true,
      value: { values: { apiKeyConfigured: false } },
    });
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('lost control replies keep the row visibly unconfirmed until a real refresh', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-2d-ui-'));
  const application = await electron.launch({
    executablePath: require('electron'),
    args: [await hiddenMain(directory, true)],
    env: { ...process.env, BROWSER2D_DATA_DIR: directory },
  });
  try {
    const page = await application.firstWindow();
    await ready(page);
    await page.getByTestId('browser-add').click();
    await page.getByLabel('环境 ID', { exact: true }).fill('unconfirmed-control');
    await page.getByTestId('browser-save').click();
    const row = page
      .getByTestId('browsers-table')
      .locator('.el-table__body-wrapper tbody tr')
      .filter({ hasText: 'unconfirmed-control' });
    await row.getByRole('button', { name: '开始工作', exact: true }).click();
    await expect(row).toContainText('工作状态待确认');
    await expect(row.getByRole('button', { name: '开始工作', exact: true })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '编辑', exact: true })).toBeDisabled();
    await expect(row.getByRole('button', { name: '移除', exact: true })).toBeDisabled();
    await expect(page.getByTestId('connection-status')).toHaveAttribute(
      'data-state',
      'unavailable',
    );
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await ready(page);
    await expect(row).toContainText('空闲');
    await expect(row.getByRole('button', { name: '开始工作', exact: true })).toBeEnabled();
    expect(await page.evaluate(async () => window.browser2d?.workTasks.list())).toEqual({
      ok: true,
      value: [],
    });
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});

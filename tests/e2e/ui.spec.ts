import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';

const desktop = resolve('apps/desktop');
const desktopRequire = createRequire(join(desktop, 'package.json'));
const workerRequire = createRequire(resolve('apps/worker/package.json'));

async function choose(page: Page, testId: string, label: string) {
  await page.getByTestId(testId).click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await expect(page.getByTestId(testId)).toContainText(label);
}

async function confirmation(page: Page, action: '确认' | '取消') {
  await page
    .locator('.el-popconfirm__action:visible')
    .getByRole('button', { name: action, exact: true })
    .click();
  await expect(page.locator('.el-popconfirm__action:visible')).toHaveCount(0);
}

async function discardDecision(page: Page, action: '继续编辑' | '放弃修改') {
  await page
    .locator('.el-message-box:visible')
    .getByRole('button', { name: action, exact: true })
    .click();
  await expect(page.locator('.el-message-box:visible')).toHaveCount(0);
}

test('complete local workspace journey preserves data and work state across routes', async ({
  browserName: _browserName,
}, testInfo) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'browser-2d-ui-journey-'));
  const Database = workerRequire('better-sqlite3');
  const legacy = new Database(join(dataDir, 'data.db'));
  legacy.exec(await readFile('tests/fixtures/legacy-schema.sql', 'utf8'));
  legacy.exec(`
    INSERT INTO device(id,symbol,status) VALUES(10,'artificial-alpha',2),(11,'artificial-beta',2);
    INSERT INTO material(id,card,month,year,cvv,status,amount) VALUES(20,'0000000000000020','01','2030','000',2,15);
    INSERT INTO history(id,card,month,day,year,cvv,status,note,create_time) VALUES
    (30,'0000000000000030','02','07','2030','000',0,'artificial boundary','2026-01-02 03:04:05'),
    (31,'0000000000000031','03','08','2031','000',3,'artificial outside','2026-01-03 03:04:05');
  `);
  legacy.close();
  const application = await electron.launch({
    executablePath: desktopRequire('electron'),
    args: [desktop, '--confirm-legacy-closed'],
    env: { ...process.env, BROWSER2D_DATA_DIR: dataDir, BROWSER2D_EXECUTION: 'controlled' },
  });
  try {
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-state', 'connected');
    const initialRoute = page.url();
    const sidebarToggle = page.getByTestId('sidebar-toggle');
    await expect(sidebarToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebarToggle).toHaveAttribute('aria-controls', 'primary-navigation');
    await sidebarToggle.click();
    await expect(sidebarToggle).toHaveAccessibleName('展开侧边栏');
    await expect(sidebarToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.sidebar')).toHaveCSS('width', '68px');
    await expect(page).toHaveURL(initialRoute);
    await expect(page.locator('.app-name')).toHaveText('2D');
    for (const route of ['tasks', 'devices', 'materials', 'history', 'settings']) {
      await expect(page.getByTestId(`nav-${route}`)).toHaveText('');
      await expect(page.getByTestId(`nav-${route}`).locator('.el-icon')).toBeVisible();
    }
    await expect(page.getByTestId('connection-status').locator('.status-dot')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('sidebar-collapsed.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByTestId('nav-devices').focus();
    await expect(page.getByRole('tooltip', { name: '设备', exact: true })).toBeVisible();
    await page.getByTestId('nav-devices').press('Enter');
    await expect(page.locator('main h1')).toHaveText('设备');
    await page.reload();
    await expect(page.locator('main h1')).toHaveText('设备');
    await expect(page.locator('.sidebar')).toHaveCSS('width', '68px');
    await expect(sidebarToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-state', 'connected');
    await page.getByTestId('connection-status').hover();
    await expect(page.getByRole('tooltip', { name: '已连接', exact: true })).toBeVisible();
    await sidebarToggle.click();
    await expect(sidebarToggle).toHaveAccessibleName('收起侧边栏');
    await expect(sidebarToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.sidebar')).toHaveCSS('width', '190px');
    await expect(page.getByTestId('nav-devices')).toHaveText('设备');
    await expect(page.getByTestId('nav-settings')).toHaveText('设置');
    await expect(page.getByTestId('connection-status')).toHaveText('已连接');
    await page.getByTestId('device-new').click();
    await page.getByTestId('device-symbol').fill('artificial-new');
    await page.getByTestId('device-amount').fill('0');
    await page.getByTestId('device-save').click();
    const created = page
      .getByTestId('devices-table')
      .locator('tbody tr')
      .filter({ hasText: 'artificial-new' });
    await expect(created).toHaveCount(1);
    await created.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(page.getByTestId('device-amount')).toHaveValue('0');
    await page.getByTestId('device-note').fill('unsaved guarded note');
    await page.locator('.el-drawer:visible .el-drawer__close-btn').click();
    await discardDecision(page, '继续编辑');
    await expect(page.getByTestId('device-note')).toHaveValue('unsaved guarded note');
    await page.getByTestId('device-note').focus();
    await page.keyboard.press('Escape');
    await discardDecision(page, '继续编辑');
    await expect(page.getByTestId('device-note')).toHaveValue('unsaved guarded note');
    await page.evaluate(() => {
      window.location.hash = '#/materials';
    });
    await discardDecision(page, '继续编辑');
    await expect(page.locator('main h1')).toHaveText('设备');
    await page.locator('.el-overlay:visible').click({ position: { x: 8, y: 8 } });
    await discardDecision(page, '放弃修改');
    await expect(page.getByTestId('device-note')).not.toBeVisible();
    await created.getByRole('button', { name: '编辑', exact: true }).click();
    await expect(page.getByTestId('device-note')).toHaveValue('');
    await page.getByTestId('device-symbol').fill('artificial-edited');
    await page.getByTestId('device-note').fill('saved note');
    await page.getByTestId('device-save').click();
    const edited = page
      .getByTestId('devices-table')
      .locator('tbody tr')
      .filter({ hasText: 'artificial-edited' });
    await expect(edited).toContainText('saved note');
    await edited.getByRole('button', { name: '删除', exact: true }).click();
    await confirmation(page, '取消');
    await expect(edited).toHaveCount(1);
    await edited.getByRole('button', { name: '删除', exact: true }).click();
    await confirmation(page, '确认');
    await expect(edited).toHaveCount(0);

    await page.getByTestId('device-start-10').click();
    await expect(page.getByTestId('device-stop-10')).toBeEnabled();
    await page.getByTestId('device-stop-10').click();
    await expect(page.getByTestId('device-stop-10')).toHaveCount(0);
    await page.getByTestId('device-select-10').click();
    await page.getByTestId('device-select-11').click();
    await page.getByTestId('devices-start-selected').click();
    await expect(page.getByTestId('batch-results').locator('[data-status="accepted"]')).toHaveCount(
      2,
    );
    await expect(page.getByTestId('devices-stop-all')).toBeEnabled();
    await page.getByTestId('devices-stop-all').click();
    await expect(page.getByTestId('batch-results').locator('[data-status="accepted"]')).toHaveCount(
      2,
    );
    const epoch = await page.getByTestId('worker-pid').textContent();
    for (const route of ['nav-settings', 'nav-history', 'nav-materials', 'nav-devices']) {
      await page.getByTestId(route).click();
      await expect(page.getByTestId('worker-pid')).toHaveText(epoch ?? '');
    }
    await page.getByRole('link', { name: '任务', exact: true }).click();
    await expect(
      page.getByTestId('run-table').locator('[data-testid^="run-"][data-state="cancelled"]'),
    ).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath('tasks-desktop.png'), fullPage: true });

    await page.getByTestId('nav-materials').click();
    await page.getByTestId('material-import-open').click();
    const lines = Array.from(
      { length: 22 },
      (_, index) => `${String(100 + index).padStart(16, '0')}|01|2030|000`,
    );
    await page
      .getByTestId('material-import-text')
      .fill([...lines, '', 'invalid', lines[0]].join('\n'));
    await page.getByTestId('material-import').click();
    await expect(page.getByTestId('import-report')).toContainText('实际提交 22 条');
    await expect(page.getByTestId('import-line-23')).toContainText('空行');
    await expect(page.getByTestId('import-line-24')).toContainText('无效');
    await expect(page.getByTestId('import-line-25')).toContainText('重复');
    await choose(page, 'material-filter-status', '0');
    await page.getByTestId('material-filter-submit').click();
    await expect(page.getByTestId('material-total')).toContainText('22');
    await expect(page.getByTestId('materials-table').locator('tbody tr')).toHaveCount(20);
    await page.locator('.el-pager li').getByText('2', { exact: true }).click();
    await expect(page.getByTestId('materials-table').locator('tbody tr')).toHaveCount(2);
    await page.locator('.el-pagination').getByText('20条/页', { exact: true }).click();
    await page.getByRole('option', { name: '50条/页', exact: true }).click();
    await expect(page.getByTestId('materials-table').locator('tbody tr')).toHaveCount(22);
    await page.getByTestId('material-filter-status').hover();
    await page.getByTestId('material-filter-status').locator('.el-select__clear').click();
    await page.getByTestId('material-filter-submit').click();
    await expect(page.getByTestId('material-total')).toContainText('23');
    await page.getByTestId('material-edit-20').click();
    await choose(page, 'material-status', '0');
    await page.getByTestId('material-status').hover();
    await page.getByTestId('material-status').locator('.el-select__clear').click();
    await page.getByTestId('material-save').click();
    await expect(
      page.getByTestId('material-20').locator('xpath=ancestor::tr').locator('td').nth(4),
    ).toHaveText('未设置');

    await page.getByRole('button', { name: '重置筛选', exact: true }).click();
    await page.getByTestId('material-filter-card').fill('0000000000000020');
    await page.getByTestId('material-filter-submit').click();
    await page.getByTestId('material-reset-20').click();
    await confirmation(page, '确认');
    await expect(
      page.getByTestId('material-20').locator('xpath=ancestor::tr').locator('td').nth(4),
    ).toContainText('可领取 · 0');
    await expect(
      page.getByTestId('material-20').locator('xpath=ancestor::tr').locator('td').nth(3),
    ).toHaveText('15');
    await page.getByTestId('material-edit-20').click();
    await page.getByTestId('material-note').fill('edited artificial material');
    await page.getByTestId('material-save').click();
    await expect(page.getByTestId('material-20').locator('xpath=ancestor::tr')).toContainText(
      'edited artificial material',
    );
    await page.getByTestId('material-delete-20').click();
    await confirmation(page, '取消');
    await expect(page.getByTestId('material-20')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('materials-desktop.png'), fullPage: true });

    await page.getByTestId('nav-history').click();
    await choose(page, 'history-filter-status', '0');
    await page.getByTestId('history-start-time').fill('2026-01-02 03:04:05');
    await page.getByTestId('history-end-time').fill('2026-01-02 03:04:05');
    await page.getByTestId('history-filter-submit').click();
    await expect(page.getByTestId('history-total')).toContainText('1');
    await expect(page.getByTestId('history-30').locator('xpath=ancestor::tr')).toContainText(
      '02 / 07 / 2030',
    );
    await page.getByTestId('history-export').click();
    await expect(page.getByTestId('history-export-text')).toHaveValue(
      '0000000000000030|02|07|000\n',
    );
    const downloadPath = testInfo.outputPath('history.txt');
    await application.evaluate(({ session }, path) => {
      session.defaultSession.once('will-download', (_event, item) => {
        if (item.getFilename() === 'history.txt') item.setSavePath(path);
        else item.cancel();
      });
    }, downloadPath);
    await page.getByTestId('history-download').click();
    await expect
      .poll(async () => readFile(downloadPath, 'utf8').catch(() => null))
      .toBe('0000000000000030|02|07|000\n');
    await page.getByTestId('history-clear').click();
    await confirmation(page, '取消');
    await expect(page.getByTestId('history-30')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('history-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 720, height: 900 });
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-save')).toBeEnabled();
    await expect(page.locator('.sidebar')).toHaveCSS('width', '150px');
    const narrowRoute = page.url();
    await sidebarToggle.click();
    await expect(page.locator('.sidebar')).toHaveCSS('width', '68px');
    await expect(page).toHaveURL(narrowRoute);
    await page.screenshot({
      path: testInfo.outputPath('sidebar-collapsed-720.png'),
      fullPage: true,
      animations: 'disabled',
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await sidebarToggle.click();
    await expect(page.locator('.sidebar')).toHaveCSS('width', '150px');
    await expect(page.getByTestId('nav-settings')).toHaveText('设置');
    await page.screenshot({ path: testInfo.outputPath('settings-narrow.png'), fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    for (const width of [1280, 800, 720]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['tasks', 'devices', 'materials', 'history', 'settings']) {
        await page.getByTestId(`nav-${route}`).click();
        await expect(page.locator('main h1')).toBeVisible();
        await expect(page.locator('.app-shell')).toHaveCSS('display', 'grid');
        await expect(page.locator('.sidebar')).toHaveCSS('width', width <= 760 ? '150px' : '190px');
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.locator('main h1').click();
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        await page.screenshot({
          path: testInfo.outputPath(`${route}-${width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    expect(errors).toEqual([]);
  } catch (error) {
    const failedPage = await application.firstWindow();
    await testInfo.attach('workspace-error', {
      body: await failedPage.locator('body').innerText(),
      contentType: 'text/plain',
    });
    await failedPage.screenshot({
      path: testInfo.outputPath('workspace-error.png'),
      fullPage: true,
    });
    throw error;
  } finally {
    await application.close().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  }
});

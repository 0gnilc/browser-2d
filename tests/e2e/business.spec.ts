import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const desktop = resolve('apps/desktop');
const desktopRequire = createRequire(join(desktop, 'package.json'));
const workerRequire = createRequire(resolve('apps/worker/package.json'));

test('business screens save through the real bridge and display refreshed records', async ({
  browserName: _browserName,
}, testInfo) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'browser-2d-business-ui-'));
  const application = await electron.launch({
    executablePath: desktopRequire('electron'),
    args: [desktop],
    env: { ...process.env, BROWSER2D_DATA_DIR: dataDir },
  });
  try {
    const page = await application.firstWindow();
    await page.getByTestId('nav-devices').click();
    await expect(page.getByTestId('device-save')).toBeEnabled();
    await page.getByTestId('device-symbol').fill('ui-fixture-device');
    await page.getByTestId('device-amount').fill('0');
    await page.getByTestId('device-save').click();
    await expect(page.getByTestId('devices-table')).toContainText('ui-fixture-device');
    await page.screenshot({ path: testInfo.outputPath('p2-devices.png'), fullPage: true });
    await page.getByTestId('nav-materials').click();
    await expect(page.getByTestId('material-import')).toBeEnabled();
    await page.getByTestId('material-import-text').fill('0000000000000009|09|2030|000\ninvalid');
    await page.getByTestId('material-import').click();
    await expect(page.getByTestId('import-report')).toContainText('实际提交 1 条');
    await expect(page.getByTestId('import-line-2')).toContainText('无效');
    await page.getByTestId('material-filter-status').selectOption('0');
    await page.getByTestId('material-filter-submit').click();
    await expect(page.getByTestId('materials-table')).toContainText('0000000000000009');
    await page.screenshot({ path: testInfo.outputPath('p2-materials.png'), fullPage: true });
    await page.getByTestId('nav-history').click();
    await expect(page.getByTestId('history-export')).toBeEnabled();
    await page.getByTestId('history-export').click();
    await expect(page.getByTestId('history-export-result')).toContainText('0 条');
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-save')).toBeEnabled();
    await page.getByTestId('settings-url').fill('http://127.0.0.1:50325');
    await page.getByTestId('settings-width').fill('900');
    await page.getByTestId('settings-save').click();
    await expect(page.getByTestId('settings-saved')).toBeVisible();
    await page.getByTestId('settings-reload').click();
    await expect(page.getByTestId('settings-width')).toHaveValue('900');
    await page.screenshot({ path: testInfo.outputPath('p2-settings.png'), fullPage: true });
    await page.getByTestId('nav-devices').click();
    await expect(page.getByTestId('devices-table')).toContainText('ui-fixture-device');
  } finally {
    await application.close().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('legacy CRUD crosses the public bridge, commits, refreshes and survives restart', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'browser-2d-business-'));
  const Database = workerRequire('better-sqlite3');
  const legacy = new Database(join(dataDir, 'data.db'));
  legacy.exec(await readFile('tests/fixtures/legacy-schema.sql', 'utf8'));
  legacy.exec(`
    INSERT INTO device(id,symbol,amount,status) VALUES(10,'legacy-device',12,2);
    INSERT INTO material(id,card,month,year,cvv,status,amount) VALUES(20,'0000000000000010','01','2030','000',2,15);
    INSERT INTO history(id,card,month,day,year,cvv,status,create_time) VALUES
      (30,'0000000000000030','02','07','2030','000',0,'2026-01-02 03:04:05'),
      (31,'0000000000000031','03',NULL,'2031','000',3,'2026-01-03 03:04:05');
  `);
  legacy.close();
  const launch = () =>
    electron.launch({
      executablePath: desktopRequire('electron'),
      args: [desktop, '--confirm-legacy-closed'],
      env: { ...process.env, BROWSER2D_DATA_DIR: dataDir },
    });
  let application = await launch();
  try {
    const page = await application.firstWindow();
    await expect(page.getByTestId('start-run')).toBeEnabled();
    const untrusted = await application.evaluate(
      async ({ BrowserWindow }, preload) => {
        const other = new BrowserWindow({
          show: false,
          webPreferences: {
            preload,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        try {
          await other.loadURL('data:text/html,untrusted');
          return await other.webContents.executeJavaScript(
            'window.browser2d.devices.create({symbol:"must-not-exist"})',
          );
        } finally {
          other.destroy();
        }
      },
      join(desktop, 'dist/preload/index.cjs'),
    );
    expect(untrusted).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const first = await page.evaluate(async () => {
      const api = window.browser2d;
      if (!api) throw new Error('Public API missing');
      const devices = await api.devices.list();
      const created = await api.devices.create({
        symbol: 'created-device',
        amount: 9,
        account: 'temporary',
      });
      if (!created.ok) throw new Error(created.error.code);
      const edited = await api.devices.update({
        id: created.value.id,
        amount: 0,
        account: null,
        note: '',
      });
      const imported = await api.materials.importText({
        text: '0000000000000001|01|2030|000\ninvalid\n0000000000000001|01|2030|000\n0000000000000002|02|2031|000|||||||extra',
      });
      const waiting = await api.materials.page({ status: 0, pageSize: 1 });
      const reset = await api.materials.reset({ id: 20 });
      const history = await api.history.page({
        status: 0,
        startTime: '2026-01-02 03:04:05',
        endTime: '2026-01-02 03:04:05',
      });
      const exported = await api.history.exportText({ status: 0 });
      const deleted = await api.history.delete({ id: 31 });
      const settings = await api.settings.get();
      if (!settings.ok) throw new Error(settings.error.code);
      const saved = await api.settings.save({
        expectedRevision: settings.value.revision,
        values: {
          adsPowerUrl: 'http://127.0.0.1:50325',
          viewportWidth: 1024,
          viewportHeight: 768,
          pageCount: 2,
        },
        secret: { action: 'retain' },
      });
      return {
        devices,
        created,
        edited,
        imported,
        waiting,
        reset,
        history,
        exported,
        deleted,
        saved,
      };
    });
    expect(first.devices.ok && first.devices.value[0]?.id).toBe(10);
    expect(first.created.ok && first.created.value.id).toBeGreaterThan(10);
    expect(first.edited.ok && first.edited.value).toMatchObject({
      amount: 0,
      account: null,
      note: '',
    });
    expect(first.imported.ok && first.imported.value.committed).toBe(2);
    expect(first.imported.ok && first.imported.value.lines.map((line) => line.outcome)).toEqual([
      'inserted',
      'invalid',
      'duplicate',
      'inserted',
    ]);
    expect(first.waiting.ok && first.waiting.value).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 1,
    });
    expect(first.reset.ok && first.reset.value).toMatchObject({ id: 20, status: 0, amount: 15 });
    expect(first.history.ok && first.history.value.total).toBe(1);
    expect(first.exported.ok && first.exported.value).toEqual({
      text: '0000000000000030|02|07|000\n',
      count: 1,
    });
    expect(first.deleted.ok && first.deleted.value.deleted).toBe(1);
    expect(first.saved.ok && first.saved.value).toMatchObject({
      pageCount: 2,
      keyConfigured: false,
    });
    await application.close();
    application = await launch();
    const reopened = await application.firstWindow();
    await expect(reopened.getByTestId('start-run')).toBeEnabled();
    const persisted = await reopened.evaluate(async () => {
      const api = window.browser2d;
      if (!api) throw new Error('Public API missing');
      return {
        devices: await api.devices.list(),
        materials: await api.materials.page({ status: 0 }),
        history: await api.history.page(),
        settings: await api.settings.get(),
      };
    });
    expect(persisted.devices.ok && persisted.devices.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbol: 'created-device', amount: 0, account: null }),
      ]),
    );
    expect(persisted.materials.ok && persisted.materials.value.total).toBe(3);
    expect(persisted.history.ok && persisted.history.value.items).toEqual([
      expect.objectContaining({ id: 30, day: '07', year: '2030' }),
    ]);
    expect(persisted.settings.ok && persisted.settings.value).toMatchObject({
      viewportWidth: 1024,
      viewportHeight: 768,
      pageCount: 2,
    });
    const cleared = await reopened.evaluate(async () => {
      const api = window.browser2d;
      if (!api) throw new Error('Public API missing');
      const devices = await api.devices.list();
      if (!devices.ok) throw new Error(devices.error.code);
      const removed = await Promise.all(devices.value.map(({ id }) => api.devices.delete({ id })));
      return {
        removed,
        materials: await api.materials.clear(),
        history: await api.history.clear(),
      };
    });
    expect(cleared.removed.every((result) => result.ok && result.value.deleted === 1)).toBe(true);
    expect(cleared.materials.ok && cleared.materials.value.deleted).toBe(3);
    expect(cleared.history.ok && cleared.history.value.deleted).toBe(1);
    await application.close();
    application = await launch();
    const emptyPage = await application.firstWindow();
    const empty = await emptyPage.evaluate(async () => {
      const api = window.browser2d;
      if (!api) throw new Error('Public API missing');
      return {
        devices: await api.devices.list(),
        materials: await api.materials.page(),
        history: await api.history.page(),
      };
    });
    expect(empty.devices.ok && empty.devices.value).toEqual([]);
    expect(empty.materials.ok && empty.materials.value.total).toBe(0);
    expect(empty.history.ok && empty.history.value.total).toBe(0);
  } finally {
    await application.close().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('legacy plaintext migrates only after OS-encrypted persistence and remains in the recovery backup', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'browser-2d-legacy-secret-'));
  const sentinel = 'p2-artificial-legacy-key-749287';
  const Database = workerRequire('better-sqlite3');
  const legacy = new Database(join(dataDir, 'data.db'));
  legacy.exec(await readFile('tests/fixtures/legacy-schema.sql', 'utf8'));
  legacy.prepare('INSERT INTO config(key,value) VALUES(?,?)').run('adsPowerApiKey', sentinel);
  legacy.close();
  const launch = () =>
    electron.launch({
      executablePath: desktopRequire('electron'),
      args: [
        desktop,
        '--confirm-legacy-closed',
        ...(process.platform === 'linux' ? ['--password-store=gnome-libsecret'] : []),
      ],
      env: { ...process.env, BROWSER2D_DATA_DIR: dataDir },
    });
  let application = await launch();
  try {
    const page = await application.firstWindow();
    const settings = await page.evaluate(async () => window.browser2d?.settings.get());
    expect(settings?.ok && settings.value).toMatchObject({
      keyConfigured: true,
      credentialMode: 'persistent',
    });
    expect(JSON.stringify(settings)).not.toContain(sentinel);
    await application.close();
    const migrated = new Database(join(dataDir, 'data.db'), { readonly: true });
    try {
      expect(
        migrated.prepare('SELECT value FROM config WHERE key = ?').get('adsPowerApiKey'),
      ).toBeUndefined();
      expect(migrated.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      migrated.close();
    }
    const backups = (await readdir(join(dataDir, 'backups'))).filter((name) =>
      name.endsWith('.sqlite3'),
    );
    expect(backups).toHaveLength(1);
    const backupName = backups[0];
    if (!backupName) throw new Error('Backup missing');
    const backup = new Database(join(dataDir, 'backups', backupName), { readonly: true });
    try {
      expect(
        backup.prepare('SELECT value FROM config WHERE key = ?').get('adsPowerApiKey'),
      ).toEqual({ value: sentinel });
      expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      backup.close();
    }
    expect((await readFile(join(dataDir, 'credentials.enc'))).includes(Buffer.from(sentinel))).toBe(
      false,
    );
    application = await launch();
    const reopened = await application.firstWindow();
    const again = await reopened.evaluate(async () => window.browser2d?.settings.get());
    expect(again?.ok && again.value).toMatchObject({
      keyConfigured: true,
      credentialMode: 'persistent',
    });
    expect(
      (await readdir(join(dataDir, 'backups'))).filter((name) => name.endsWith('.sqlite3')),
    ).toHaveLength(1);
  } finally {
    await application.close().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('OS-encrypted credentials persist, stale settings conflict and session replacement expires', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'browser-2d-credentials-'));
  const sentinel = 'p2-synthetic-secret-never-echo-825717';
  const launch = () =>
    electron.launch({
      executablePath: desktopRequire('electron'),
      args: [
        desktop,
        ...(process.platform === 'linux' ? ['--password-store=gnome-libsecret'] : []),
      ],
      env: { ...process.env, BROWSER2D_DATA_DIR: dataDir },
    });
  let application = await launch();
  try {
    const page = await application.firstWindow();
    const saved = await page.evaluate(async (value) => {
      const api = window.browser2d;
      if (!api) throw new Error('Public API missing');
      const current = await api.settings.get();
      if (!current.ok) throw new Error(current.error.code);
      const input = {
        expectedRevision: current.value.revision,
        values: {
          adsPowerUrl: 'http://127.0.0.1:50325',
          viewportWidth: 1280,
          viewportHeight: 800,
          pageCount: 1,
        },
      };
      const first = await api.settings.save({
        ...input,
        secret: { action: 'replace', value, persistence: 'persistent' },
      });
      const stale = await api.settings.save({ ...input, secret: { action: 'clear' } });
      return { first, stale };
    }, sentinel);
    expect(saved.first.ok && saved.first.value).toMatchObject({
      keyConfigured: true,
      credentialMode: 'persistent',
    });
    expect(saved.stale).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(JSON.stringify(saved)).not.toContain(sentinel);
    expect(JSON.stringify(saved)).not.toContain('secretRef');
    await application.close();
    const encrypted = await readFile(join(dataDir, 'credentials.enc'));
    expect(encrypted.includes(Buffer.from(sentinel))).toBe(false);
    expect((await readFile(join(dataDir, 'data.db'))).includes(Buffer.from(sentinel))).toBe(false);
    application = await launch();
    const reopened = await application.firstWindow();
    const next = await reopened.evaluate(async () => {
      const api = window.browser2d;
      if (!api) throw new Error('Public API missing');
      const before = await api.settings.get();
      if (!before.ok) throw new Error(before.error.code);
      const values = {
        adsPowerUrl: before.value.adsPowerUrl,
        viewportWidth: before.value.viewportWidth,
        viewportHeight: before.value.viewportHeight,
        pageCount: before.value.pageCount,
      };
      const replaced = await api.settings.save({
        expectedRevision: before.value.revision,
        values,
        secret: { action: 'replace', value: 'p2-session-fixture-only', persistence: 'session' },
      });
      if (!replaced.ok) throw new Error(replaced.error.code);
      const retained = await api.settings.save({
        expectedRevision: replaced.value.revision,
        values,
        secret: { action: 'retain' },
      });
      return { before, replaced, retained };
    });
    expect(next.before.ok && next.before.value).toMatchObject({
      keyConfigured: true,
      credentialMode: 'persistent',
    });
    expect(next.replaced.ok && next.replaced.value).toMatchObject({
      keyConfigured: true,
      credentialMode: 'session',
    });
    expect(next.retained.ok && next.retained.value).toMatchObject({
      keyConfigured: true,
      credentialMode: 'session',
    });
    await application.close();
    application = await launch();
    const finalPage = await application.firstWindow();
    const final = await finalPage.evaluate(async () => window.browser2d?.settings.get());
    expect(final?.ok && final.value).toMatchObject({
      keyConfigured: false,
      credentialMode: 'none',
    });
    const files = await readdir(dataDir);
    for (const file of files.filter((name) => /credentials|data\.db/.test(name))) {
      expect(
        (await readFile(join(dataDir, file))).includes(Buffer.from('p2-session-fixture-only')),
      ).toBe(false);
    }
  } finally {
    await application.close().catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  }
});

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  cpSync,
  appendFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { secretRefSchema } from '@browser-2d/contracts/host';
import {
  deviceCreateSchema,
  materialCreateSchema,
  materialUpdateSchema,
  type Result,
} from '@browser-2d/contracts/public';
import { openBusinessStore, type StorageOptions } from '../src/storage/open-business-store';
import { createBusinessStore, type BusinessStore } from '../src/storage/business-store';

let directory: string;
let path: string;
const stores: BusinessStore[] = [];
const databases: Database.Database[] = [];
const legacySql = readFileSync(
  fileURLToPath(new URL('../../../tests/fixtures/legacy-schema.sql', import.meta.url)),
  'utf8',
);
function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
function database(file = path) {
  const db = new Database(file, { timeout: 50 });
  databases.push(db);
  return db;
}
function legacy() {
  const db = database();
  db.exec(legacySql);
  return db;
}
async function open(overrides: Partial<StorageOptions> = {}) {
  const result = await openBusinessStore({
    path,
    confirmLegacy: async () => true,
    prepareLegacy: async () => secretRefSchema.parse(randomUUID()),
    verifyCredential: async () => undefined,
    ...overrides,
  });
  stores.push(result.store);
  return result;
}
const material = { card: '4111111111111111', month: '01', year: '2031', cvv: '123' };
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'browser-2d-business-'));
  path = join(directory, 'data.db');
});
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const db of databases.splice(0)) if (db.open) db.close();
  rmSync(directory, { recursive: true, force: true });
});
describe('business database ownership and migration', () => {
  it('upgrades a populated v2 WAL prefix without resetting settings, references or historical claims', async () => {
    const fixture = legacy();
    const migrationDirectory = fileURLToPath(new URL('../migrations/business', import.meta.url));
    const first = readFileSync(join(migrationDirectory, '001-legacy.sql'), 'utf8');
    const second = readFileSync(join(migrationDirectory, '002-settings.sql'), 'utf8');
    fixture.exec(second);
    for (const [index, sql] of [first, second].entries())
      fixture
        .prepare('INSERT INTO business_migrations VALUES (?, ?, ?)')
        .run(
          index + 1,
          index === 0 ? '001-legacy.sql' : '002-settings.sql',
          createHash('sha256').update(sql).digest('hex'),
        );
    const ref = secretRefSchema.parse(randomUUID());
    fixture.prepare('UPDATE business_settings SET revision = 19, secret_ref = ?').run(ref);
    fixture.exec(
      "INSERT INTO material(card, month, year, status) VALUES ('claimed','01','2030',1); INSERT INTO config(key,value) VALUES ('pageCount','3')",
    );
    fixture.close();
    const writer = spawn(process.execPath, [
      '-e',
      `const Database = require(process.argv[1]); const db = new Database(process.argv[2]); db.pragma('journal_mode = WAL'); db.pragma('wal_autocheckpoint = 0'); db.prepare("INSERT INTO device(symbol) VALUES ('v2-wal')").run(); process.stdout.write('ready'); setInterval(() => {}, 1000);`,
      createRequire(import.meta.url).resolve('better-sqlite3'),
      path,
    ]);
    await once(writer.stdout, 'data');
    writer.kill('SIGKILL');
    await once(writer, 'exit');
    expect(readFileSync(`${path}-wal`).length).toBeGreaterThan(0);
    const result = await open({
      confirmLegacy: async () => {
        throw new Error('v2 must not ask legacy consent');
      },
      prepareLegacy: async () => {
        throw new Error('v2 must not prepare plaintext');
      },
      verifyCredential: async (found) => {
        expect(found).toBe(ref);
      },
    });
    expect(value(result.store.settings.get())).toMatchObject({
      revision: 19,
      pageCount: 3,
    });
    expect(value(result.store.materials.page()).items[0]?.status).toBe(1);
    expect(value(result.store.devices.list())[0]?.symbol).toBe('v2-wal');
    if (!result.backup) throw new Error('Missing upgrade backup');
    const copy = database(result.backup.path);
    expect(copy.pragma('user_version', { simple: true })).toBe(2);
    expect(copy.prepare('SELECT revision, secret_ref FROM business_settings').get()).toEqual({
      revision: 19,
      secret_ref: ref,
    });
    expect(copy.prepare('SELECT symbol FROM device').pluck().get()).toBe('v2-wal');
    const tables = [
      'device',
      'material',
      'history',
      'config',
      'business_settings',
      'sqlite_sequence',
    ];
    const before = tables.map((table) =>
      copy.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
    const ledger = copy.prepare('SELECT * FROM business_migrations ORDER BY version').all();
    result.store.close();
    const upgraded = database();
    expect(
      tables.map((table) => upgraded.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
    ).toEqual(before);
    expect(
      upgraded
        .prepare('SELECT * FROM business_migrations WHERE version <= 2 ORDER BY version')
        .all(),
    ).toEqual(ledger);
    expect(upgraded.pragma('user_version', { simple: true })).toBe(4);
    upgraded.close();
    expect((await open()).backup).toBeNull();
    for (const candidate of stores) candidate.close();
    cpSync(result.backup.path, path);
    chmodSync(path, 0o600);
    await expect(
      open({
        beforeCommit() {
          throw new Error('injected failure');
        },
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
    const rolledBack = database();
    expect(rolledBack.pragma('user_version', { simple: true })).toBe(2);
    expect(rolledBack.prepare('SELECT * FROM business_migrations ORDER BY version').all()).toEqual(
      ledger,
    );
    expect(rolledBack.prepare('SELECT revision, secret_ref FROM business_settings').get()).toEqual({
      revision: 19,
      secret_ref: ref,
    });
  });

  it('upgrades v3 without rewriting old work obligations or dormant references', async () => {
    const fixture = legacy();
    const migrationDirectory = fileURLToPath(new URL('../migrations/business', import.meta.url));
    const migrations = ['001-legacy.sql', '002-settings.sql', '003-work.sql'];
    for (const name of migrations.slice(1))
      fixture.exec(readFileSync(join(migrationDirectory, name), 'utf8'));
    for (const [index, name] of migrations.entries())
      fixture.prepare('INSERT INTO business_migrations VALUES (?, ?, ?)').run(
        index + 1,
        name,
        createHash('sha256')
          .update(readFileSync(join(migrationDirectory, name)))
          .digest('hex'),
      );
    const ref = secretRefSchema.parse(randomUUID());
    fixture.prepare('UPDATE business_settings SET secret_ref = ?, revision = 9').run(ref);
    fixture.prepare("INSERT INTO device(id,symbol) VALUES (1,'old-work')").run();
    const runId = randomUUID();
    const operationId = randomUUID();
    const config = JSON.stringify({
      revision: 9,
      pageCount: 2,
      viewportWidth: 1280,
      viewportHeight: 800,
    });
    const timestamp = new Date().toISOString();
    fixture
      .prepare("INSERT INTO work_runs VALUES (?,1,'stopping',?,'cancelled',?,?)")
      .run(runId, config, timestamp, timestamp);
    fixture
      .prepare(
        "INSERT INTO work_resources VALUES (?,?,1,?,2,'release-pending','unknown',NULL,'OWNERSHIP_UNCERTAIN')",
      )
      .run(operationId, runId, randomUUID());
    const before = fixture.prepare('SELECT * FROM work_resources').all();
    const ledger = fixture.prepare('SELECT * FROM business_migrations ORDER BY version').all();
    fixture.close();
    const upgraded = await open({
      execution: 'chrome',
      verifyCredential: async () => {
        throw new Error('Dormant reference must remain unopened');
      },
    });
    expect(upgraded.work.chrome.hasRun(runId)).toBe(false);
    expect(upgraded.work.obligations()).toMatchObject([
      { operationId, runId, pages: 2, failure: 'OWNERSHIP_UNCERTAIN' },
    ]);
    upgraded.store.close();
    const inspect = database();
    expect(inspect.prepare('SELECT * FROM work_resources').all()).toEqual(before);
    expect(
      inspect
        .prepare('SELECT * FROM business_migrations WHERE version <= 3 ORDER BY version')
        .all(),
    ).toEqual(ledger);
    expect(inspect.prepare('SELECT secret_ref FROM business_settings').pluck().get()).toBe(ref);
    expect(inspect.pragma('user_version', { simple: true })).toBe(4);
  });

  it('waits for migration consent before excluding the old connection', async () => {
    legacy().close();
    let observed = false;
    const { store } = await open({
      confirmLegacy: async () => {
        const old = database();
        old.prepare('INSERT INTO device(symbol) VALUES (?)').run('before-consent');
        old.close();
        observed = true;
        return true;
      },
    });
    expect(observed).toBe(true);
    expect(value(store.devices.list())[0]?.symbol).toBe('before-consent');
  });

  it('accepted finite amounts and optional undefined values survive refresh and restart', async () => {
    const { store } = await open();
    const device = value(
      store.devices.create(
        deviceCreateSchema.parse({ symbol: 'defaults', count: undefined, status: undefined }),
      ),
    );
    expect(device).toMatchObject({ count: 0, status: 2 });
    value(store.materials.create(materialCreateSchema.parse({ ...material, amount: 1e16 })));
    const other = value(store.materials.create({ ...material, card: '4222222222222222' }));
    expect(
      store.materials.update(
        materialUpdateSchema.parse({ id: other.id, card: material.card, month: undefined }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(value(store.materials.page({ card: '' })).total).toBe(2);
    store.close();
    const reopened = (await open()).store;
    expect(value(reopened.materials.page()).items[0]?.amount).toBe(1e16);
    expect(value(reopened.materials.page()).items[1]?.card).toBe('4222222222222222');
  });

  it('retains finite legacy integer amounts and ignores empty history filters', async () => {
    const db = legacy();
    db.exec(
      "INSERT INTO history(card,amount,note) VALUES ('minimum',-9223372036854775808,NULL),('second',0,'')",
    );
    db.close();
    const { store } = await open();
    expect(
      value(store.history.page({ card: '', note: '', startTime: '', endTime: '' })).total,
    ).toBe(2);
    expect(value(store.history.page()).items[0]?.amount).toBe(-9223372036854775808);
  });

  it('preserves legacy rows, duplicate tuples, timestamps, day/year and sequences with an intact backup', async () => {
    const fixture = legacy();
    fixture.exec(`INSERT INTO device (id, create_time, symbol, account, amount, count, status, note) VALUES (41, '2021-01-01 08:00:00', 'same', '', 0, 0, 0, NULL), (42, '2021-01-01 08:00:00', 'same', NULL, NULL, 0, 2, '');
      INSERT INTO material (id, card, month, year, cvv, status, name, amount) VALUES (51, 'a', '01', '2030', NULL, 1, '', NULL), (52, 'a', '01', '2030', '', 0, NULL, 0);
      INSERT INTO history (id, card, month, day, year, cvv, note, amount) VALUES (61, 'a', '', '07', '2040', NULL, '', NULL);
      INSERT INTO config (key, value) VALUES ('viewportWidth', ''), ('unrelated', 'preserve');
      UPDATE sqlite_sequence SET seq = 500 WHERE name = 'device';`);
    const tables = ['device', 'material', 'history', 'config', 'sqlite_sequence'];
    const before = tables.map((table) =>
      fixture.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
    fixture.close();
    const result = await open();
    expect(value(result.store.devices.list())[0]).toMatchObject({
      id: 41,
      amount: 0,
      account: '',
      note: null,
    });
    expect(value(result.store.materials.page()).items.map((row) => row.status)).toEqual([1, 0]);
    expect(value(result.store.history.page()).items[0]).toMatchObject({ day: '07', year: '2040' });
    expect(result.backup).toMatchObject({ containsLegacyPlaintext: false });
    if (!result.backup) throw new Error('Missing backup');
    const backup = database(result.backup.path);
    expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(
      tables.map((table) => backup.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
    ).toEqual(before);
    result.store.close();
    const migrated = database();
    expect(
      tables.map((table) => migrated.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
    ).toEqual(before);
    migrated.close();
    expect(value((await open()).store.devices.create({ symbol: 'next' })).id).toBe(501);
    backup.close();
    const restoredPath = join(directory, 'restored.db');
    const originalBackup = readFileSync(result.backup.path);
    cpSync(result.backup.path, restoredPath);
    chmodSync(restoredPath, 0o600);
    const restored = await open({ path: restoredPath });
    expect(value(restored.store.devices.list())).toHaveLength(2);
    expect(readFileSync(result.backup.path)).toEqual(originalBackup);
  });
  it('backs up a WAL-only committed row from its retained source connection and excludes an idle old connection', async () => {
    legacy().close();
    const modulePath = createRequire(import.meta.url).resolve('better-sqlite3');
    const writer = spawn(process.execPath, [
      '-e',
      `
      const Database = require(process.argv[1]); const db = new Database(process.argv[2]);
      db.pragma('journal_mode = WAL'); db.pragma('wal_autocheckpoint = 0');
      db.prepare('INSERT INTO device (symbol) VALUES (?)').run('only-in-wal');
      process.stdout.write('ready\\n'); setInterval(() => {}, 1000);
    `,
      modulePath,
      path,
    ]);
    await once(writer.stdout, 'data');
    writer.kill('SIGKILL');
    await once(writer, 'exit');
    expect(readFileSync(`${path}-wal`).length).toBeGreaterThan(0);
    const old = database();
    const result = await open();
    expect(() => old.prepare('SELECT * FROM device').all()).toThrow();
    expect(() => old.prepare("INSERT INTO device (symbol) VALUES ('old-write')").run()).toThrow();
    if (!result.backup) throw new Error('Missing backup');
    expect(database(result.backup.path).prepare('SELECT symbol FROM device').pluck().get()).toBe(
      'only-in-wal',
    );
    result.store.close();
    expect(old.prepare('SELECT symbol FROM device').pluck().get()).toBe('only-in-wal');
  });
  it('excludes a still-running legacy process without claiming that the lock proves process exit', async () => {
    legacy().close();
    const old = spawn(
      process.execPath,
      [
        '-e',
        `
      const Database = require(process.argv[1]); const db = new Database(process.argv[2], { timeout: 10 });
      process.send('opened');
      process.on('message', () => {
        try { db.prepare('SELECT * FROM device').all(); process.send('readable'); }
        catch (error) { process.send(error.code); }
      });
    `,
        createRequire(import.meta.url).resolve('better-sqlite3'),
        path,
      ],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
    );
    try {
      await once(old, 'message');
      const { store } = await open();
      expect(old.exitCode).toBeNull();
      old.send('probe');
      expect((await once(old, 'message'))[0]).toBe('SQLITE_BUSY');
      store.close();
      old.send('probe');
      expect((await once(old, 'message'))[0]).toBe('readable');
    } finally {
      old.kill('SIGKILL');
      await once(old, 'exit');
    }
  });
  it('refuses ownership while another connection holds an active write transaction', async () => {
    const old = legacy();
    old.exec('BEGIN IMMEDIATE');
    await expect(open()).rejects.toMatchObject({ code: 'DATABASE_IN_USE' });
    old.exec('ROLLBACK');
    expect((await open()).store).toBeDefined();
  });
  it('refuses a newer schema without changing its file', async () => {
    const future = legacy();
    future.pragma('user_version = 100');
    future.close();
    const before = readFileSync(path);
    await expect(open()).rejects.toMatchObject({ code: 'DATABASE_NEWER' });
    expect(readFileSync(path)).toEqual(before);
    expect(readdirSync(directory)).toEqual(['data.db']);
  });
  it('refuses unknown layouts and invalid storage classes before migration writes', async () => {
    const fixture = legacy();
    fixture.exec('ALTER TABLE device ADD COLUMN surprise TEXT');
    fixture.close();
    const before = readFileSync(path);
    await expect(open()).rejects.toMatchObject({ code: 'DATABASE_UNRECOGNIZED' });
    expect(readFileSync(path)).toEqual(before);
    rmSync(path);
    const wrong = legacy();
    wrong.exec("INSERT INTO material (card, month, year, status) VALUES ('a','b','c','bad')");
    wrong.close();
    await expect(open()).rejects.toMatchObject({ code: 'DATABASE_UNRECOGNIZED' });
  });
  describe.each(['count', 'status'])('legacy device.%s integer bounds', (column) => {
    it.each([
      -9_223_372_036_854_775_808n,
      -9_007_199_254_740_992n,
      9_007_199_254_740_992n,
      9_223_372_036_854_775_807n,
    ])('rejects %s before migration writes', async (integer) => {
      const fixture = legacy();
      fixture.prepare(`INSERT INTO device (symbol, ${column}) VALUES ('bounds', ?)`).run(integer);
      fixture.close();
      const before = readFileSync(path);

      await expect(open()).rejects.toMatchObject({ code: 'DATABASE_UNRECOGNIZED' });

      expect(readFileSync(path)).toEqual(before);
      expect(readdirSync(directory)).toEqual(['data.db']);
      const inspect = database();
      expect(inspect.pragma('user_version', { simple: true })).toBe(0);
      expect(
        inspect.prepare("SELECT 1 FROM sqlite_master WHERE name = 'business_migrations'").get(),
      ).toBeUndefined();
      expect(inspect.prepare(`SELECT ${column} FROM device`).safeIntegers().pluck().get()).toBe(
        integer,
      );
    });
  });
  it.each([Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER])(
    'preserves the public integer boundary %s through migration and reopen',
    async (integer) => {
      const fixture = legacy();
      fixture
        .prepare('INSERT INTO device (symbol, count, status) VALUES (?, ?, ?)')
        .run('bounds', integer, integer);
      fixture
        .prepare('INSERT INTO material (card, month, year, status) VALUES (?, ?, ?, ?)')
        .run('bounds', '01', '2030', integer);
      fixture.prepare('INSERT INTO history (card, status) VALUES (?, ?)').run('bounds', integer);
      fixture.close();

      const migrated = await open();
      expect(migrated.backup).not.toBeNull();
      expect(value(migrated.store.devices.list())[0]).toMatchObject({
        count: integer,
        status: integer,
      });
      expect(value(migrated.store.materials.page()).items[0]?.status).toBe(integer);
      expect(value(migrated.store.history.page()).items[0]?.status).toBe(integer);
      migrated.store.close();

      const reopened = await open();
      expect(reopened.backup).toBeNull();
      expect(value(reopened.store.devices.list())[0]).toMatchObject({
        count: integer,
        status: integer,
      });
    },
  );
  it('rejects a changed migration checksum and preserves the current database', async () => {
    (await open()).store.close();
    const migrationsDir = join(directory, 'migrations');
    cpSync(fileURLToPath(new URL('../migrations/business', import.meta.url)), migrationsDir, {
      recursive: true,
    });
    appendFileSync(join(migrationsDir, '001-legacy.sql'), '\n-- changed after release\n');
    const before = readFileSync(path);
    await expect(open({ migrationsDir })).rejects.toMatchObject({ code: 'MIGRATION_CHANGED' });
    expect(readFileSync(path)).toEqual(before);
  });
  it('keeps plaintext and the original schema until encrypted persistence succeeds, and rolls back all migration changes', async () => {
    const fixture = legacy();
    fixture
      .prepare('INSERT INTO config (key,value) VALUES (?,?)')
      .run('adsPowerApiKey', 'legacy-only');
    fixture.close();
    await expect(
      open({
        prepareLegacy: async () => {
          throw new Error('secret-bearing provider error');
        },
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_UNAVAILABLE' });
    let inspect = database();
    expect(
      inspect.prepare("SELECT value FROM config WHERE key='adsPowerApiKey'").pluck().get(),
    ).toBe('legacy-only');
    expect(inspect.pragma('user_version', { simple: true })).toBe(0);
    inspect.close();
    const ref = secretRefSchema.parse(randomUUID());
    await expect(
      open({
        prepareLegacy: async (value) => {
          expect(value).toBe('legacy-only');
          return ref;
        },
        beforeCommit() {
          throw new Error('forced SQL failure');
        },
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION_FAILED' });
    inspect = database();
    expect(
      inspect.prepare("SELECT value FROM config WHERE key='adsPowerApiKey'").pluck().get(),
    ).toBe('legacy-only');
    expect(
      inspect.prepare("SELECT name FROM sqlite_master WHERE name='business_migrations'").get(),
    ).toBeUndefined();
    inspect.close();
    const migrated = await open({ prepareLegacy: async () => ref });
    expect(migrated.backup?.containsLegacyPlaintext).toBe(true);
    expect(value(migrated.store.settings.get())).toMatchObject({});
    migrated.store.close();
    expect(readFileSync(path).includes(Buffer.from('legacy-only'))).toBe(false);
    inspect = database();
    expect(
      inspect.prepare("SELECT value FROM config WHERE key='adsPowerApiKey'").get(),
    ).toBeUndefined();
    expect(inspect.prepare('SELECT secret_ref FROM business_settings').pluck().get()).toBe(ref);
    inspect.close();
    const reopened = await open({
      verifyCredential: async () => {
        throw new Error('Dormant credentials must not be decrypted');
      },
    });
    expect(value(reopened.store.settings.get()).browser).toEqual({
      mode: 'launch',
      executablePath: '',
      headless: false,
    });
  });
  it('cancels initialization while credential preparation is pending without committing or retaining ownership', async () => {
    const fixture = legacy();
    fixture.prepare('INSERT INTO config (key,value) VALUES (?,?)').run('adsPowerApiKey', 'legacy');
    fixture.close();
    const signal = new AbortController();
    await expect(
      open({
        signal: signal.signal,
        prepareLegacy: async () => {
          signal.abort();
          return secretRefSchema.parse(randomUUID());
        },
      }),
    ).rejects.toMatchObject({ code: 'INITIALIZATION_FAILED' });
    const inspect = database();
    expect(inspect.pragma('user_version', { simple: true })).toBe(0);
  });
});
describe('business transactions', () => {
  it('retains explicit zeros/nulls and reloads devices and materials after restart', async () => {
    const { store } = await open();
    const device = value(
      store.devices.create({ symbol: 'a', amount: 0, count: 0, status: 0, account: '' }),
    );
    expect(device).toMatchObject({ amount: 0, count: 0, status: 0, account: '' });
    expect(
      value(store.devices.update({ id: device.id, account: null, amount: null, note: '' })),
    ).toMatchObject({ account: null, amount: null, note: '' });
    const row = value(store.materials.create({ ...material, amount: 0, name: '' }));
    expect(
      value(store.materials.update({ id: row.id, amount: null, name: null, note: '' })),
    ).toMatchObject({ amount: null, name: null, note: '' });
    store.close();
    const reopened = (await open()).store;
    expect(value(reopened.devices.list())[0]).toMatchObject({ id: device.id, amount: null });
    expect(value(reopened.materials.page()).items[0]).toMatchObject({ id: row.id, name: null });
    expect(value(reopened.devices.delete({ id: device.id })).deleted).toBe(1);
    expect(value(reopened.materials.delete({ id: row.id })).deleted).toBe(1);
  });
  it('rejects new duplicate tuples while allowing unrelated edits to legacy duplicates', async () => {
    const fixture = legacy();
    fixture.exec(
      "INSERT INTO material(card,month,year,cvv) VALUES ('a','1','2','3'),('a','1','2','4')",
    );
    fixture.close();
    const { store } = await open();
    expect(store.materials.create({ card: 'a', month: '1', year: '2', cvv: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    expect(value(store.materials.update({ id: 1, note: 'still editable' })).note).toBe(
      'still editable',
    );
    const newRow = value(store.materials.create(material));
    expect(
      store.materials.update({ id: newRow.id, card: 'a', month: '1', year: '2' }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });
  it('claims once atomically, never resets on startup and rejects every mutation of a claimed row', async () => {
    const { store } = await open();
    const row = value(store.materials.create(material));
    const claims = await Promise.all(
      Array.from({ length: 20 }, async () => store.claimNextMaterial('device')),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({ id: row.id, status: 1, device: 'device' });
    for (const result of [
      store.materials.update({ id: row.id, note: 'bad' }),
      store.materials.delete({ id: row.id }),
      store.materials.reset({ id: row.id }),
      store.materials.clear(),
    ])
      expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    store.close();
    expect(value((await open()).store.materials.page()).items[0]?.status).toBe(1);
  });
  it('imports four-field lines without shifting empty slots and reports every original line and actual inserts', async () => {
    const { store } = await open();
    const report = value(
      store.materials.importText({
        text: '\n4111111111111111|01|2030|123||Street||CA|\n4111111111111111|01|2030|999\n4222222222222222|02|2031|222\ninvalid\n',
      }),
    );
    expect(report).toEqual({
      committed: 2,
      lines: [
        { line: 1, outcome: 'blank' },
        { line: 2, outcome: 'inserted' },
        { line: 3, outcome: 'duplicate' },
        { line: 4, outcome: 'inserted' },
        { line: 5, outcome: 'invalid' },
        { line: 6, outcome: 'blank' },
      ],
    });
    expect(value(store.materials.page()).items[0]).toMatchObject({
      name: '',
      address: 'Street',
      city: '',
      state: 'CA',
      zip: '',
    });
    expect(value(store.materials.page()).items[1]).toMatchObject({ name: null, address: null });
  });
  it('rolls back every eligible import row when an insertion fails before commit', () => {
    const fixture = legacy();
    fixture.exec(
      "CREATE TRIGGER reject_second BEFORE INSERT ON material WHEN NEW.card = '4222222222222222' BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    const store = createBusinessStore(fixture);
    stores.push(store);
    expect(() =>
      store.materials.importText({
        text: '4111111111111111|01|2030|123\n4222222222222222|02|2031|234',
      }),
    ).toThrow('injected failure');
    expect(value(store.materials.page()).total).toBe(0);
  });
  it('preserves slash expiry and unambiguous legacy delimiters without splitting street hyphens', async () => {
    const { store } = await open();
    const report = value(
      store.materials.importText({
        text: '4111111111111111|01/2030|123||12-14 Street\n4222222222222222----02----2031----234----Name\n4333333333333333||03||2032||345||Name',
      }),
    );
    expect(report.committed).toBe(3);
    expect(value(store.materials.page()).items[0]).toMatchObject({
      month: '01',
      year: '2030',
      name: '',
      address: '12-14 Street',
    });
  });
  it('uses status zero in count/list, inclusive history filters, full export bytes and twenty-row defaults', async () => {
    const fixture = legacy();
    for (let index = 0; index < 25; index++)
      fixture
        .prepare(
          "INSERT INTO history (create_time,card,month,day,year,cvv,status,note) VALUES ('2024-01-01 08:00:00',?,'01','07','2040','123',0,'match')",
        )
        .run(`card${index}`);
    fixture.prepare("INSERT INTO history(card,status,note) VALUES ('excluded',2,'other')").run();
    fixture.close();
    const { store } = await open();
    const filter = {
      status: 0 as const,
      startTime: '2024-01-01 08:00:00',
      endTime: '2024-01-01 08:00:00',
      note: 'mat',
    };
    expect(value(store.history.page(filter))).toMatchObject({ total: 25, page: 1, pageSize: 20 });
    expect(value(store.history.page(filter)).items).toHaveLength(20);
    expect(value(store.history.exportText(filter))).toEqual({
      count: 25,
      text: Array.from({ length: 25 }, (_, index) => `card${index}|01|07|123\n`).join(''),
    });
    expect(value(store.history.delete({ id: 1 })).deleted).toBe(1);
    expect(value(store.history.clear()).deleted).toBe(25);
  });
  it('commits Chrome settings with revision CAS and preserves dormant legacy references', async () => {
    const { store } = await open();
    const initial = value(store.settings.get());
    store.close();
    const ref = secretRefSchema.parse(randomUUID());
    const legacy = database();
    legacy.prepare('UPDATE business_settings SET secret_ref = ?').run(ref);
    legacy.close();
    const reopened = (await open()).store;
    const browser = { mode: 'connect' as const, endpoint: 'http://127.0.0.1:9222' };
    expect(
      value(reopened.settings.commit({ values: { ...initial, browser }, expectedRevision: 0 })),
    ).toMatchObject({ browser, revision: 1 });
    expect(reopened.settings.commit({ values: initial, expectedRevision: 0 })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT' },
    });
    reopened.close();
    const inspect = database();
    expect(inspect.prepare('SELECT secret_ref FROM business_settings').pluck().get()).toBe(ref);
    inspect.close();
    expect(value((await open()).store.settings.get())).toMatchObject({ browser, revision: 1 });
  });
});

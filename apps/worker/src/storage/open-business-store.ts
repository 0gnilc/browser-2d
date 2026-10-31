import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  secretRefSchema,
  type SecretRef,
  type StorageFailureCode,
} from '@browser-2d/contracts/host';
import { createBusinessStore } from './business-store';

declare const __BUSINESS_MIGRATIONS__: string;
const files = ['001-legacy.sql', '002-settings.sql'];
export class StorageError extends Error {
  constructor(readonly code: StorageFailureCode) {
    super(code);
  }
}
export interface StorageOptions {
  path: string;
  nativeBinding?: string;
  confirmLegacy: () => Promise<boolean>;
  prepareLegacy: (value: string) => Promise<SecretRef>;
  verifyCredential: (ref: SecretRef) => Promise<void>;
  signal?: AbortSignal;
  migrationsDir?: string;
  beforeCommit?: () => void;
}
const fingerprint = (db: Database.Database) =>
  JSON.stringify(
    db
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all(),
  );
const contents = (db: Database.Database, tables: string[]) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        tables.map((table) => db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()),
      ),
    )
    .digest('hex');
function syncFile(path: string) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function schema(db: Database.Database) {
  const objects = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  return JSON.stringify(
    objects.map((raw) => {
      if (
        !raw ||
        typeof raw !== 'object' ||
        !('sql' in raw) ||
        typeof raw.sql !== 'string' ||
        !('name' in raw) ||
        typeof raw.name !== 'string' ||
        !('type' in raw)
      )
        throw new StorageError('DATABASE_UNRECOGNIZED');
      return {
        name: raw.name,
        type: raw.type,
        sql: raw.sql
          .toLowerCase()
          .replace(/if\s+not\s+exists\s+/g, '')
          .replace(/\s+/g, '')
          .replace(/;$/, ''),
      };
    }),
  );
}
function validateRows(db: Database.Database) {
  const constraints: Record<string, Record<string, string[]>> = {
    device: {
      id: ['integer'],
      create_time: ['text'],
      symbol: ['text'],
      account: ['text', 'null'],
      amount: ['integer', 'real', 'null'],
      count: ['integer'],
      status: ['integer'],
      note: ['text', 'null'],
    },
    material: {
      id: ['integer'],
      create_time: ['text'],
      card: ['text'],
      month: ['text'],
      year: ['text'],
      cvv: ['text', 'null'],
      name: ['text', 'null'],
      address: ['text', 'null'],
      city: ['text', 'null'],
      state: ['text', 'null'],
      zip: ['text', 'null'],
      country: ['text', 'null'],
      extra: ['text', 'null'],
      amount: ['integer', 'real', 'null'],
      status: ['integer', 'null'],
      device: ['text', 'null'],
      note: ['text', 'null'],
    },
    history: {
      id: ['integer'],
      create_time: ['text'],
      card: ['text'],
      month: ['text', 'null'],
      year: ['text', 'null'],
      day: ['text', 'null'],
      cvv: ['text', 'null'],
      extra: ['text', 'null'],
      amount: ['integer', 'real', 'null'],
      status: ['integer', 'null'],
      device: ['text', 'null'],
      note: ['text', 'null'],
    },
    config: { id: ['integer'], key: ['text'], value: ['text', 'null'], create_time: ['text'] },
  };
  for (const [table, columns] of Object.entries(constraints)) {
    const invalid = Object.entries(columns)
      .map(
        ([column, types]) =>
          `typeof(${column}) NOT IN (${types.map((type) => `'${type}'`).join(',')})`,
      )
      .join(' OR ');
    if (
      db
        .prepare(
          `SELECT 1 FROM ${table} WHERE ${invalid} OR id < 1 OR id > 9007199254740991 LIMIT 1`,
        )
        .get() !== undefined
    )
      throw new StorageError('DATABASE_UNRECOGNIZED');
  }
  for (const table of ['material', 'history']) {
    if (
      db
        .prepare(
          `SELECT 1 FROM ${table} WHERE status NOT BETWEEN -9007199254740991 AND 9007199254740991 OR amount NOT BETWEEN -9007199254740991 AND 9007199254740991 LIMIT 1`,
        )
        .get()
    )
      throw new StorageError('DATABASE_UNRECOGNIZED');
  }
}
export async function openBusinessStore(options: StorageOptions) {
  mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
  const nativeOptions = options.nativeBinding ? { nativeBinding: options.nativeBinding } : {};
  const db = new Database(options.path, { ...nativeOptions, timeout: 1000 });
  let stage: StorageFailureCode = 'INITIALIZATION_FAILED';
  const checkCancelled = () => {
    if (options.signal?.aborted) throw new StorageError('INITIALIZATION_FAILED');
  };
  try {
    stage = 'DATABASE_IN_USE';
    db.pragma('locking_mode = EXCLUSIVE');
    db.exec('BEGIN EXCLUSIVE; COMMIT');
    checkCancelled();
    const version = db.pragma('user_version', { simple: true });
    if (typeof version !== 'number' || version > files.length)
      throw new StorageError('DATABASE_NEWER');
    if (version !== 0 && version !== files.length) throw new StorageError('DATABASE_UNRECOGNIZED');
    const migrationsDir =
      options.migrationsDir ??
      (typeof __BUSINESS_MIGRATIONS__ === 'string'
        ? __BUSINESS_MIGRATIONS__
        : fileURLToPath(new URL('../../migrations/business', import.meta.url)));
    const migrations = files.map((name, index) => {
      const sql = readFileSync(join(migrationsDir, name), 'utf8');
      return {
        version: index + 1,
        name,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
    const empty =
      db.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get() === undefined;
    if (empty && version !== 0) throw new StorageError('DATABASE_UNRECOGNIZED');
    if (!empty) {
      const expected = new Database(':memory:', nativeOptions);
      try {
        for (const migration of migrations)
          if (migration.version === 1 || version === files.length) expected.exec(migration.sql);
        if (schema(db) !== schema(expected)) throw new StorageError('DATABASE_UNRECOGNIZED');
      } finally {
        expected.close();
      }
      validateRows(db);
    }
    if (version === files.length) {
      const ledger = db
        .prepare('SELECT version, name, checksum FROM business_migrations ORDER BY version')
        .all();
      if (
        JSON.stringify(ledger) !==
        JSON.stringify(
          migrations.map(({ version, name, checksum }) => ({ version, name, checksum })),
        )
      )
        throw new StorageError('MIGRATION_CHANGED');
      const state = db.prepare('SELECT id, revision, secret_ref FROM business_settings').all();
      if (
        state.length !== 1 ||
        db
          .prepare(
            "SELECT 1 FROM business_settings WHERE id != 1 OR typeof(revision) != 'integer' OR revision < 0 OR revision > 9007199254740991",
          )
          .get()
      )
        throw new StorageError('DATABASE_UNRECOGNIZED');
      const ref = db.prepare('SELECT secret_ref FROM business_settings WHERE id = 1').pluck().get();
      if (ref !== null) {
        stage = 'CREDENTIAL_UNAVAILABLE';
        await options.verifyCredential(secretRefSchema.parse(ref));
        checkCancelled();
      }
      if (db.prepare("SELECT 1 FROM config WHERE key = 'adsPowerApiKey'").get())
        throw new StorageError('DATABASE_UNRECOGNIZED');
      const store = createBusinessStore(db);
      store.settings.get();
      return { store, backup: null };
    }
    if (!empty && !(await options.confirmLegacy())) throw new StorageError('DATABASE_IN_USE');
    checkCancelled();
    const legacyKey = empty
      ? null
      : db.prepare("SELECT value FROM config WHERE key = 'adsPowerApiKey'").pluck().get();
    if (legacyKey !== undefined && legacyKey !== null && typeof legacyKey !== 'string')
      throw new StorageError('DATABASE_UNRECOGNIZED');
    let backup: { path: string; containsLegacyPlaintext: boolean } | null = null;
    if (!empty) {
      stage = 'BACKUP_FAILED';
      const directory = join(dirname(options.path), 'backups');
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const backupPath = join(directory, `data-before-p2-${randomUUID()}.sqlite3`);
      const temporary = `${backupPath}.tmp`;
      const before = contents(db, ['device', 'material', 'history', 'config', 'sqlite_sequence']);
      const sourceSchema = fingerprint(db);
      await db.backup(temporary);
      checkCancelled();
      const copied = new Database(temporary, {
        ...nativeOptions,
        readonly: true,
        fileMustExist: true,
      });
      try {
        if (
          copied.pragma('integrity_check', { simple: true }) !== 'ok' ||
          fingerprint(copied) !== sourceSchema ||
          contents(copied, ['device', 'material', 'history', 'config', 'sqlite_sequence']) !==
            before
        )
          throw new StorageError('BACKUP_FAILED');
      } finally {
        copied.close();
      }
      chmodSync(temporary, 0o400);
      syncFile(temporary);
      renameSync(temporary, backupPath);
      syncFile(directory);
      backup = {
        path: backupPath,
        containsLegacyPlaintext: typeof legacyKey === 'string' && legacyKey.length > 0,
      };
      writeFileSync(
        `${backupPath}.json`,
        JSON.stringify({
          format: 1,
          integrity: 'ok',
          containsLegacyPlaintext: backup.containsLegacyPlaintext,
        }),
        { mode: 0o400, flag: 'wx' },
      );
      syncFile(`${backupPath}.json`);
      syncFile(directory);
    }
    let secretRef: SecretRef | null = null;
    if (typeof legacyKey === 'string' && legacyKey.length > 0) {
      stage = 'CREDENTIAL_UNAVAILABLE';
      secretRef = await options.prepareLegacy(legacyKey);
      checkCancelled();
    }
    stage = 'MIGRATION_FAILED';
    db.pragma('secure_delete = ON');
    db.transaction(() => {
      for (const migration of migrations) db.exec(migration.sql);
      const insert = db.prepare(
        'INSERT INTO business_migrations (version, name, checksum) VALUES (@version, @name, @checksum)',
      );
      for (const migration of migrations) insert.run(migration);
      db.prepare('UPDATE business_settings SET secret_ref = ? WHERE id = 1').run(secretRef);
      db.prepare("DELETE FROM config WHERE key = 'adsPowerApiKey'").run();
      createBusinessStore(db).settings.get();
      options.beforeCommit?.();
    })();
    db.pragma('wal_checkpoint(TRUNCATE)');
    checkCancelled();
    return { store: createBusinessStore(db), backup };
  } catch (error) {
    if (db.open) db.close();
    if (error instanceof StorageError) throw error;
    throw new StorageError(stage);
  }
}

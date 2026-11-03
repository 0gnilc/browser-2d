import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { applicationSettingsDefaults } from '@browser-2d/contracts/host';
import { createApplicationRepository, type RepositoryOptions } from '../repository';

declare const __APPLICATION_MIGRATIONS__: string;
const files = ['001-application.sql'];
export class ApplicationStorageError extends Error {
  constructor(
    readonly code:
      'DATABASE_NEWER' | 'DATABASE_UNRECOGNIZED' | 'MIGRATION_CHANGED' | 'MIGRATION_FAILED',
  ) {
    super(code);
  }
}
export interface OpenApplicationOptions extends RepositoryOptions {
  path: string;
  nativeBinding?: string;
  migrationsDir?: string;
}
const ledgerSchema = z.array(
  z.strictObject({ version: z.number().int(), name: z.string(), checksum: z.string() }),
);
export function openApplicationRepository(options: OpenApplicationOptions) {
  mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
  const db = new Database(options.path, {
    ...(options.nativeBinding ? { nativeBinding: options.nativeBinding } : {}),
    timeout: 1000,
  });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('locking_mode = EXCLUSIVE');
    db.exec('BEGIN EXCLUSIVE; COMMIT');
    const version = z
      .number()
      .int()
      .nonnegative()
      .parse(db.pragma('user_version', { simple: true }));
    if (version > files.length) throw new ApplicationStorageError('DATABASE_NEWER');
    const migrationsDir =
      options.migrationsDir ??
      (typeof __APPLICATION_MIGRATIONS__ === 'string'
        ? __APPLICATION_MIGRATIONS__
        : fileURLToPath(new URL('../../../migrations/application', import.meta.url)));
    const migrations = files.map((name, index) => {
      const sql = readFileSync(join(migrationsDir, name), 'utf8');
      return {
        version: index + 1,
        name,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    });
    if (
      version === 0 &&
      db.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get()
    )
      throw new ApplicationStorageError('DATABASE_UNRECOGNIZED');
    if (version > 0) {
      const ledger = ledgerSchema.parse(
        db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all(),
      );
      const expected = migrations
        .filter((migration) => migration.version <= version)
        .map(({ version, name, checksum }) => ({ version, name, checksum }));
      if (JSON.stringify(ledger) !== JSON.stringify(expected))
        throw new ApplicationStorageError('MIGRATION_CHANGED');
    }
    db.transaction(() => {
      for (const migration of migrations) {
        if (migration.version <= version) continue;
        db.exec(migration.sql);
        db.prepare(
          'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        ).run(migration.version, migration.name, migration.checksum, new Date().toISOString());
        db.pragma(`user_version = ${migration.version}`);
      }
      if (version === 0) {
        const insert = db.prepare(
          'INSERT INTO settings (key, value_json, revision, updated_at) VALUES (?, ?, 0, ?)',
        );
        for (const [key, value] of Object.entries(applicationSettingsDefaults))
          insert.run(key, JSON.stringify(value), new Date().toISOString());
      }
    })();
    db.pragma('journal_mode = WAL');
    const repository = createApplicationRepository(db, options);
    if (!repository.settings.read().ok) throw new ApplicationStorageError('DATABASE_UNRECOGNIZED');
    return repository;
  } catch (error) {
    db.close();
    if (error instanceof ApplicationStorageError) throw error;
    throw new ApplicationStorageError('MIGRATION_FAILED');
  }
}

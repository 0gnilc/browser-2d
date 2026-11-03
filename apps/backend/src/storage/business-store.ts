import { parseMaterialLine } from './material-import';
import type Database from 'better-sqlite3';
import {
  deviceSchema,
  materialSchema,
  historySchema,
  settingsValuesSchema,
  failure,
  type DeviceCreate,
  type DeviceUpdate,
  type MaterialCreate,
  type MaterialUpdate,
  type MaterialQuery,
  type HistoryQuery,
  type HistoryFilter,
  type SettingsView,
  type SettingsValues,
  type ImportReport,
  type Result,
  type Device,
  type Material,
  type History,
} from '@browser-2d/contracts/public';
import type { SettingsCommit } from '@browser-2d/contracts/host';

const deviceColumns = 'id, create_time AS createTime, symbol, account, amount, count, status, note';
const materialColumns =
  'id, create_time AS createTime, card, month, year, cvv, name, address, city, state, zip, country, extra, amount, status, device, note';
const historyColumns =
  'id, create_time AS createTime, card, month, day, year, cvv, extra, amount, status, device, note';
export const settingsDefaults = {
  browser: { mode: 'launch', executablePath: '', headless: false },
  viewportWidth: 1280,
  viewportHeight: 900,
  pageCount: 1,
} satisfies SettingsValues;

export function createBusinessStore(db: Database.Database) {
  const deviceById = (id: number) =>
    deviceSchema.parse(db.prepare(`SELECT ${deviceColumns} FROM device WHERE id = ?`).get(id));
  const materialById = (id: number) =>
    materialSchema.parse(
      db.prepare(`SELECT ${materialColumns} FROM material WHERE id = ?`).get(id),
    );
  const materialExists = (id: number) =>
    db.prepare('SELECT id FROM material WHERE id = ?').get(id) !== undefined;
  const duplicate = (input: Pick<MaterialCreate, 'card' | 'month' | 'year'>, exceptId = 0) =>
    db
      .prepare('SELECT id FROM material WHERE card IS ? AND month IS ? AND year IS ? AND id != ?')
      .get(input.card, input.month, input.year, exceptId) !== undefined;
  const claimed = (id?: number) =>
    (id === undefined
      ? db.prepare('SELECT id FROM material WHERE status = 1').get()
      : db.prepare('SELECT id FROM material WHERE id = ? AND status = 1').get(id)) !== undefined;
  const deviceReserved = (id: number) =>
    db
      .prepare(
        "SELECT 1 FROM work_runs WHERE device_id = ? AND state IN ('queued','starting','running','stopping') UNION ALL SELECT 1 FROM work_resources WHERE device_id = ? AND state != 'resolved' LIMIT 1",
      )
      .get(id, id) !== undefined;
  const deviceConflict = () => failure('CONFLICT', 'Device has active work or unresolved cleanup');
  const conflict = () => failure('CONFLICT', 'Material is currently claimed');
  function createMaterial(input: MaterialCreate): Result<Material> {
    if (input.status === 1) return failure('CONFLICT', 'Only a worker claim can enter processing');
    if (duplicate(input)) return failure('CONFLICT', 'Material already exists');
    const value = {
      name: null,
      address: null,
      city: null,
      state: null,
      zip: null,
      country: null,
      extra: null,
      amount: 0,
      status: 0,
      device: null,
      note: null,
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    };
    const inserted = db
      .prepare(
        'INSERT INTO material (card, month, year, cvv, name, address, city, state, zip, country, extra, amount, status, device, note) VALUES (@card, @month, @year, @cvv, @name, @address, @city, @state, @zip, @country, @extra, @amount, @status, @device, @note)',
      )
      .run(value);
    return { ok: true, value: materialById(Number(inserted.lastInsertRowid)) };
  }
  function patch(table: 'device' | 'material', input: DeviceUpdate | MaterialUpdate) {
    const fields = Object.entries(input).filter(
      ([key, value]) => key !== 'id' && value !== undefined,
    );
    if (fields.length > 0)
      db.prepare(
        `UPDATE ${table} SET ${fields.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`,
      ).run(...fields.map(([, value]) => value), input.id);
  }
  function filter(input: HistoryFilter) {
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    for (const [name, operator, value] of [
      ['card', '=', input.card],
      ['status', '=', input.status],
      ['create_time', '>=', input.startTime],
      ['create_time', '<=', input.endTime],
      [
        'note',
        'LIKE',
        input.note === undefined || input.note === '' ? undefined : `%${input.note}%`,
      ],
    ] as const) {
      if (value !== undefined && value !== '') {
        clauses.push(`${name} ${operator} ?`);
        values.push(value);
      }
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
  }
  function page<T>(
    table: 'material' | 'history',
    columns: string,
    input: HistoryQuery,
    parse: (value: unknown) => T[],
  ) {
    const { where, values } = filter(input);
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const count = db
      .prepare(`SELECT COUNT(*) FROM ${table} ${where}`)
      .pluck()
      .get(...values);
    if (typeof count !== 'number') throw new Error('Invalid count');
    const items = parse(
      db
        .prepare(
          `SELECT ${columns} FROM ${table} ${where} ORDER BY create_time, id LIMIT ? OFFSET ?`,
        )
        .all(...values, pageSize, (page - 1) * pageSize),
    );
    return { ok: true as const, value: { items, total: count, page, pageSize } };
  }
  function settings(): SettingsView {
    const entries = Object.fromEntries(
      db
        .prepare(
          "SELECT key, value FROM config WHERE key IN ('browser', 'viewportWidth', 'viewportHeight', 'pageCount')",
        )
        .all()
        .map((raw) => {
          if (
            !raw ||
            typeof raw !== 'object' ||
            !('key' in raw) ||
            typeof raw.key !== 'string' ||
            !('value' in raw)
          )
            throw new Error('Invalid setting');
          return [raw.key, raw.value];
        }),
    );
    const values = settingsValuesSchema.parse({
      browser:
        entries.browser == null
          ? settingsDefaults.browser
          : JSON.parse(typeof entries.browser === 'string' ? entries.browser : ''),
      viewportWidth:
        entries.viewportWidth == null || entries.viewportWidth === ''
          ? settingsDefaults.viewportWidth
          : Number(entries.viewportWidth),
      viewportHeight:
        entries.viewportHeight == null || entries.viewportHeight === ''
          ? settingsDefaults.viewportHeight
          : Number(entries.viewportHeight),
      pageCount:
        entries.pageCount == null || entries.pageCount === ''
          ? settingsDefaults.pageCount
          : Number(entries.pageCount),
    });
    const revision = db
      .prepare('SELECT revision FROM business_settings WHERE id = 1')
      .pluck()
      .get();
    if (typeof revision !== 'number') throw new Error('Missing settings revision');
    return { ...values, revision };
  }
  const commitSettings = db.transaction((input: SettingsCommit): Result<SettingsView> => {
    const current = settings();
    if (current.revision !== input.expectedRevision)
      return failure('CONFLICT', 'Settings changed. Refresh before saving');
    const set = db.prepare(
      'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    for (const [key, value] of Object.entries(input.values))
      set.run(key, key === 'browser' ? JSON.stringify(value) : String(value));
    db.prepare('UPDATE business_settings SET revision = revision + 1 WHERE id = 1').run();
    return { ok: true, value: settings() };
  });
  return {
    devices: {
      list: (): Result<Device[]> => ({
        ok: true,
        value: deviceSchema
          .array()
          .parse(db.prepare(`SELECT ${deviceColumns} FROM device ORDER BY create_time, id`).all()),
      }),
      create: db.transaction((input: DeviceCreate): Result<Device> => {
        const value = {
          account: null,
          amount: null,
          count: 0,
          status: 2,
          note: null,
          ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
        };
        const inserted = db
          .prepare(
            'INSERT INTO device (symbol, account, amount, count, status, note) VALUES (@symbol, @account, @amount, @count, @status, @note)',
          )
          .run(value);
        return { ok: true, value: deviceById(Number(inserted.lastInsertRowid)) };
      }),
      update: db.transaction((input: DeviceUpdate): Result<Device> => {
        if (db.prepare('SELECT id FROM device WHERE id = ?').get(input.id) === undefined)
          return failure('NOT_FOUND', 'Device does not exist');
        if (deviceReserved(input.id)) return deviceConflict();
        patch('device', input);
        return { ok: true, value: deviceById(input.id) };
      }),
      delete: db.transaction(({ id }: { id: number }) =>
        deviceReserved(id)
          ? deviceConflict()
          : {
              ok: true as const,
              value: { deleted: db.prepare('DELETE FROM device WHERE id = ?').run(id).changes },
            },
      ),
    },
    materials: {
      page: db.transaction((input: MaterialQuery = {}) =>
        page('material', materialColumns, input, (rows) => materialSchema.array().parse(rows)),
      ),
      create: db.transaction(createMaterial),
      update: db.transaction((input: MaterialUpdate): Result<Material> => {
        if (!materialExists(input.id)) return failure('NOT_FOUND', 'Material does not exist');
        if (claimed(input.id) || input.status === 1) return conflict();
        const previous = materialById(input.id);
        const next = {
          ...previous,
          ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
        };
        if (
          (next.card !== previous.card ||
            next.month !== previous.month ||
            next.year !== previous.year) &&
          duplicate(next, input.id)
        )
          return failure('CONFLICT', 'Material already exists');
        patch('material', input);
        return { ok: true, value: materialById(input.id) };
      }),
      delete: db.transaction(({ id }: { id: number }) =>
        claimed(id)
          ? conflict()
          : {
              ok: true as const,
              value: { deleted: db.prepare('DELETE FROM material WHERE id = ?').run(id).changes },
            },
      ),
      clear: db.transaction(() =>
        claimed()
          ? conflict()
          : {
              ok: true as const,
              value: { deleted: db.prepare('DELETE FROM material').run().changes },
            },
      ),
      reset: db.transaction(({ id }: { id: number }): Result<Material> => {
        if (!materialExists(id)) return failure('NOT_FOUND', 'Material does not exist');
        if (claimed(id)) return conflict();
        db.prepare("UPDATE material SET status = 0, device = '', note = '' WHERE id = ?").run(id);
        return { ok: true, value: materialById(id) };
      }),
      importText: db.transaction(({ text }: { text: string }): Result<ImportReport> => {
        const lines: ImportReport['lines'] = [];
        let committed = 0;
        for (const [index, line] of text.split(/\r?\n/).entries()) {
          if (!line.trim()) {
            lines.push({ line: index + 1, outcome: 'blank' });
            continue;
          }
          const parsed = parseMaterialLine(line);
          if (!parsed.success) {
            lines.push({ line: index + 1, outcome: 'invalid' });
            continue;
          }
          const inserted = createMaterial(parsed.data);
          lines.push({ line: index + 1, outcome: inserted.ok ? 'inserted' : 'duplicate' });
          if (inserted.ok) committed += 1;
        }
        return { ok: true, value: { committed, lines } };
      }),
    },
    history: {
      page: db.transaction((input: HistoryQuery = {}) =>
        page('history', historyColumns, input, (rows) => historySchema.array().parse(rows)),
      ),
      delete: ({ id }: { id: number }) => ({
        ok: true as const,
        value: { deleted: db.prepare('DELETE FROM history WHERE id = ?').run(id).changes },
      }),
      clear: () => ({
        ok: true as const,
        value: { deleted: db.prepare('DELETE FROM history').run().changes },
      }),
      exportText: db.transaction((input: HistoryFilter = {}) => {
        const { where, values } = filter(input);
        const rows = historySchema
          .array()
          .parse(
            db
              .prepare(`SELECT ${historyColumns} FROM history ${where} ORDER BY create_time, id`)
              .all(...values),
          );
        return {
          ok: true as const,
          value: {
            count: rows.length,
            text: rows
              .map((row) => `${row.card}|${row.month ?? ''}|${row.day ?? ''}|${row.cvv ?? ''}\n`)
              .join(''),
          },
        };
      }),
    },
    settings: {
      get: (): Result<SettingsView> => ({ ok: true, value: settings() }),
      commit: commitSettings,
    },
    claimNextMaterial(device: string): Material | null {
      const row = db
        .prepare(
          `UPDATE material SET status = 1, device = ? WHERE id = (SELECT id FROM material WHERE status = 0 ORDER BY create_time, id LIMIT 1) AND status = 0 RETURNING ${materialColumns}`,
        )
        .get(device);
      return row === undefined ? null : materialSchema.parse(row);
    },
    insertHistory(input: Omit<History, 'id' | 'createTime'>): History {
      const result = db
        .prepare(
          'INSERT INTO history (card, month, day, year, cvv, extra, amount, status, device, note) VALUES (@card, @month, @day, @year, @cvv, @extra, @amount, @status, @device, @note)',
        )
        .run(input);
      return historySchema.parse(
        db
          .prepare(`SELECT ${historyColumns} FROM history WHERE id = ?`)
          .get(Number(result.lastInsertRowid)),
      );
    },
    close() {
      if (db.open) db.close();
    },
  };
}
export type BusinessStore = ReturnType<typeof createBusinessStore>;

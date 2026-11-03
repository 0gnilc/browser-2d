import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { to } from '@browser-2d/amount';
import {
  browserCreateSchema,
  browserUpdateSchema,
  cardUpdateSchema,
  cardQuerySchema,
  cardIdSchema,
  type ImportLineResult,
} from '@browser-2d/contracts/public';
import { type ParsedLine } from './import-text';
import {
  browserById,
  cardById,
  browserColumns,
  cardColumns,
  readBrowser,
  readCard,
  reject,
  type RepositoryContext,
} from './shared';
export function createBrowserCards(context: RepositoryContext) {
  const { db, now } = context;
  function requireIdleBrowser(id: number) {
    browserById(context, id);
    if (db.prepare('SELECT 1 FROM work_task WHERE browser_id = ?').get(id))
      reject(
        'CONFLICT',
        'Stop and finish the active task before editing this browser',
        'ACTIVE_TASK',
      );
  }
  function requireUnclaimedCard(id: number) {
    cardById(context, id);
    if (db.prepare('SELECT 1 FROM card_claim WHERE card_id = ?').get(id))
      reject('CONFLICT', 'This card is currently claimed', 'ACTIVE_CLAIM');
  }
  return {
    browsers: {
      list: () =>
        db
          .prepare(`SELECT ${browserColumns} FROM browser ORDER BY created_at ASC, id ASC`)
          .all()
          .map(readBrowser),
      create(input: z.infer<typeof browserCreateSchema>) {
        const values = browserCreateSchema.parse(input);
        if (
          db
            .prepare('SELECT 1 FROM browser WHERE provider = ? AND profile_id = ?')
            .get(values.provider, values.profileId)
        )
          reject('CONFLICT', 'This browser profile is already added');
        const stamp = now();
        const inserted = db
          .prepare(
            'INSERT INTO browser (provider, profile_id, name, account, amount, notes, created_at, updated_at) VALUES (@provider, @profileId, @name, @account, @amount, @notes, @stamp, @stamp)',
          )
          .run({ ...values, amount: to(values.amount), stamp });
        return browserById(context, Number(inserted.lastInsertRowid));
      },
      update(input: z.infer<typeof browserUpdateSchema>) {
        const values = browserUpdateSchema.parse(input);
        requireIdleBrowser(values.id);
        const current = browserById(context, values.id);
        const next = { ...current, ...values };
        if (
          db
            .prepare('SELECT 1 FROM browser WHERE provider = ? AND profile_id = ? AND id != ?')
            .get(next.provider, next.profileId, next.id)
        )
          reject('CONFLICT', 'This browser profile is already added');
        db.prepare(
          'UPDATE browser SET provider = @provider, profile_id = @profileId, name = @name, account = @account, amount = @amount, notes = @notes, updated_at = @stamp WHERE id = @id',
        ).run({ ...next, amount: to(next.amount), stamp: now() });
        return browserById(context, next.id);
      },
      remove(input: { id: number }) {
        requireIdleBrowser(input.id);
        db.prepare('DELETE FROM browser WHERE id = ?').run(input.id);
        return { removed: true } as const;
      },
    },
    cards: {
      list(input: z.infer<typeof cardQuerySchema>) {
        const query = cardQuerySchema.parse(input);
        const predicates = ['1 = 1'];
        const params: Record<string, string | number> = {};
        if (query.status) {
          predicates.push('status = @status');
          params.status = query.status;
        }
        if (query.search !== undefined) {
          predicates.push(
            "(number LIKE @search ESCAPE '\\' OR cardholder_name LIKE @search ESCAPE '\\' OR notes LIKE @search ESCAPE '\\')",
          );
          params.search = `%${query.search.replace(/[\\%_]/g, (value) => `\\${value}`)}%`;
        }
        const where = predicates.join(' AND ');
        const total = z
          .number()
          .int()
          .nonnegative()
          .safe()
          .parse(db.prepare(`SELECT count(*) FROM card WHERE ${where}`).pluck().get(params));
        const items = db
          .prepare(
            `SELECT ${cardColumns} FROM card WHERE ${where} ORDER BY created_at ASC, id ASC LIMIT @limit OFFSET @offset`,
          )
          .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize })
          .map(readCard);
        return { items, total, page: query.page, pageSize: query.pageSize };
      },
      importBatch(lines: ParsedLine[]): ImportLineResult[] {
        const insert = db.prepare(
          'INSERT INTO card (number, expiry_month, expiry_year, security_code, cardholder_name, billing_address, billing_city, billing_region, billing_postal_code, billing_country_code, extra, processing_id, created_at, updated_at) VALUES (@number, @expiryMonth, @expiryYear, @securityCode, @cardholderName, @billingAddress, @billingCity, @billingRegion, @billingPostalCode, @billingCountryCode, @extra, @processingId, @stamp, @stamp) ON CONFLICT(number, expiry_month, expiry_year) DO NOTHING',
        );
        return lines.map((line) => {
          if (line.kind !== 'card') return line;
          const added = insert.run({ ...line.values, processingId: randomUUID(), stamp: now() });
          return added.changes === 0
            ? { line: line.line, kind: 'duplicate' }
            : {
                line: line.line,
                kind: 'inserted',
                cardId: cardIdSchema.parse(Number(added.lastInsertRowid)),
              };
        });
      },
      update(input: z.infer<typeof cardUpdateSchema>) {
        const values = cardUpdateSchema.parse(input);
        requireUnclaimedCard(values.id);
        const current = cardById(context, values.id);
        if (
          db.prepare('SELECT 1 FROM card_operation WHERE card_id = ? LIMIT 1').get(values.id) &&
          Object.keys(values).some((key) => key !== 'id' && key !== 'notes')
        )
          reject(
            'CONFLICT',
            'Processing inputs are locked by a committed operation',
            'INPUT_LOCKED',
          );
        const next = { ...current, ...values };
        if (
          db
            .prepare(
              'SELECT 1 FROM card WHERE number = ? AND expiry_month = ? AND expiry_year = ? AND id != ?',
            )
            .get(next.number, next.expiryMonth, next.expiryYear, next.id)
        )
          reject('CONFLICT', 'A card with this number and expiry already exists');
        db.prepare(
          'UPDATE card SET number = @number, expiry_month = @expiryMonth, expiry_year = @expiryYear, security_code = @securityCode, cardholder_name = @cardholderName, billing_address = @billingAddress, billing_city = @billingCity, billing_region = @billingRegion, billing_postal_code = @billingPostalCode, billing_country_code = @billingCountryCode, extra = @extra, notes = @notes, updated_at = @stamp WHERE id = @id',
        ).run({ ...next, stamp: now() });
        return cardById(context, next.id);
      },
      remove(input: { id: number }) {
        requireUnclaimedCard(input.id);
        if (
          db
            .prepare(
              "SELECT 1 FROM card_operation o JOIN work_task t ON t.id = json_extract(o.result_json, '$.attribution.taskId') WHERE o.card_id = ? LIMIT 1",
            )
            .get(input.id)
        )
          reject(
            'CONFLICT',
            'Finish the active task cleanup before removing this card',
            'ACTIVE_TASK',
          );
        db.prepare('DELETE FROM card WHERE id = ?').run(input.id);
        return { removed: true } as const;
      },
    },
  };
}

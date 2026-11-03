import { z } from 'zod';
import type Database from 'better-sqlite3';
import { from } from '@browser-2d/amount';
import { browserSchema, cardSchema, type Failure } from '@browser-2d/contracts/public';
import { amountUnitsSchema, type Processor } from '@browser-2d/contracts/host';
export interface RepositoryContext {
  db: Database.Database;
  now(): string;
  processors: ReadonlySet<Processor>;
}
export class RepositoryFailure extends Error {
  constructor(readonly failure: Failure) {
    super(failure.error.code);
  }
}
export function reject(
  code: Failure['error']['code'],
  message: string,
  reason?: Failure['error']['reason'],
): never {
  throw new RepositoryFailure({
    ok: false,
    error: { code, message, ...(reason ? { reason } : {}) },
  });
}
export const browserColumns = `id, provider, profile_id AS profileId, name, account, amount, count, status, notes, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt`;
const browserRowSchema = browserSchema.extend({ amount: amountUnitsSchema });
export function readBrowser(raw: unknown) {
  const row = browserRowSchema.parse(raw);
  return browserSchema.parse({ ...row, amount: from(row.amount) });
}
export const cardColumns = `id, number, expiry_month AS expiryMonth, expiry_year AS expiryYear, security_code AS securityCode, cardholder_name AS cardholderName, billing_address AS billingAddress, billing_city AS billingCity, billing_region AS billingRegion, billing_postal_code AS billingPostalCode, billing_country_code AS billingCountryCode, amount, status, extra, notes, last_result AS lastResult, (EXISTS(SELECT 1 FROM card_claim WHERE card_id = card.id) OR EXISTS(SELECT 1 FROM card_operation WHERE processing_id = card.processing_id AND card_id = card.id)) AS inputLocked, created_at AS createdAt, updated_at AS updatedAt`;
const cardRowSchema = cardSchema.extend({
  amount: amountUnitsSchema,
  inputLocked: z.union([z.literal(0), z.literal(1)]),
  lastResult: z.string().nullable(),
});
const storedResultSchema = cardSchema.shape.lastResult
  .unwrap()
  .extend({ processingId: z.uuid(), operationKey: z.string() });
export function readCard(raw: unknown) {
  const row = cardRowSchema.parse(raw);
  let lastResult = null;
  if (row.lastResult !== null) {
    const stored = storedResultSchema.parse(JSON.parse(row.lastResult));
    lastResult = cardSchema.shape.lastResult.unwrap().strip().parse(stored);
  }
  return cardSchema.parse({
    ...row,
    amount: from(row.amount),
    lastResult,
    inputLocked: row.inputLocked === 1,
  });
}
export function browserById(context: RepositoryContext, id: number) {
  const raw = context.db.prepare(`SELECT ${browserColumns} FROM browser WHERE id = ?`).get(id);
  if (!raw) reject('NOT_FOUND', 'Browser was not found');
  return readBrowser(raw);
}
export function cardById(context: RepositoryContext, id: number) {
  const raw = context.db.prepare(`SELECT ${cardColumns} FROM card WHERE id = ?`).get(id);
  if (!raw) reject('NOT_FOUND', 'Card was not found');
  return readCard(raw);
}
type Json = null | boolean | string | number | Json[] | { [key: string]: Json };
function ordered(value: Json): Json {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, ordered(item)]),
    );
  return value;
}
export function canonical(value: unknown) {
  return JSON.stringify(ordered(z.json().parse(value)));
}

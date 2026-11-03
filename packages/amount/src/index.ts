export const PRECISION = 2;
export const SCALE = 100;
export const MAX_SAFE_UNITS = Number.MAX_SAFE_INTEGER;
declare const amountUnits: unique symbol;
export type AmountUnits = number & { readonly [amountUnits]: true };
export function isAmountUnits(value: number): value is AmountUnits {
  return Number.isSafeInteger(value) && value >= 0;
}
export function to(text: string): AmountUnits {
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new RangeError('Invalid amount text');
  const [whole = '', fraction = ''] = text.split('.');
  const units = BigInt(whole) * BigInt(SCALE) + BigInt(fraction.padEnd(PRECISION, '0'));
  if (units > BigInt(MAX_SAFE_UNITS)) throw new RangeError('Amount exceeds safe units');
  const value = Number(units);
  if (!isAmountUnits(value)) throw new RangeError('Invalid amount units');
  return value;
}
export function from(units: number): string {
  if (!isAmountUnits(units)) throw new RangeError('Invalid amount units');
  const value = BigInt(units);
  return `${value / BigInt(SCALE)}.${String(value % BigInt(SCALE)).padStart(PRECISION, '0')}`;
}
export const amount = { to, from };

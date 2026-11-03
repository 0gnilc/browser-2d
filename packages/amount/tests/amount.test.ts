import { describe, expect, it } from 'vitest';
import { amount, MAX_SAFE_UNITS } from '../src';
describe('exact amount conversion', () => {
  it.each([
    ['0', 0],
    ['0.29', 29],
    ['1.2', 120],
    ['12.34', 1234],
    ['90071992547409.91', MAX_SAFE_UNITS],
  ])('converts %s exactly', (text, units) => {
    expect(amount.to(text)).toBe(units);
    expect(amount.to(amount.from(units))).toBe(units);
  });
  it('formats two decimals without floating point division', () => {
    expect(amount.from(0)).toBe('0.00');
    expect(amount.from(MAX_SAFE_UNITS - 81)).toBe('90071992547409.10');
    expect(amount.from(MAX_SAFE_UNITS)).toBe('90071992547409.91');
  });
  it.each([
    '',
    '-1',
    '1.234',
    '1e2',
    '1,000',
    ' 1',
    '.2',
    '1.',
    'NaN',
    'Infinity',
    '90071992547409.92',
  ])('rejects invalid text %s', (text) => expect(() => amount.to(text)).toThrow(RangeError));
  it.each([-1, 0.1, NaN, Infinity, -Infinity, MAX_SAFE_UNITS + 1])(
    'rejects invalid units %s',
    (units) => expect(() => amount.from(units)).toThrow(RangeError),
  );
});

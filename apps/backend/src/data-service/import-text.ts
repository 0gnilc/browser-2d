import {
  limits,
  type ImportReport,
  type ImportLineResult,
  type Result,
} from '@browser-2d/contracts/public';
import { fieldTextSchema } from '@browser-2d/contracts/public';
import { reject } from './shared';
export const importedFields = [
  'number',
  'expiryMonth',
  'expiryYear',
  'securityCode',
  'cardholderName',
  'billingAddress',
  'billingCity',
  'billingRegion',
  'billingPostalCode',
  'billingCountryCode',
  'extra',
] as const;
export type ImportedFields = Record<(typeof importedFields)[number], string>;
export type ParsedLine =
  | { line: number; kind: 'card'; values: ImportedFields }
  | Exclude<ImportLineResult, { kind: 'inserted' | 'duplicate' }>;
export function parseImport(text: string): ParsedLine[] {
  if (Buffer.byteLength(text, 'utf8') > limits.importBytes)
    reject('INVALID_INPUT', 'Import exceeds the size limit');
  const lines = (text.startsWith('\uFEFF') ? text.slice(1) : text).split(/\r?\n/);
  if (lines.length > limits.importLines) reject('INVALID_INPUT', 'Import exceeds the line limit');
  return lines.map((text, index) => {
    const line = index + 1;
    if (!text.trim()) return { line, kind: 'blank' };
    const fields = text.split('|').map((field) => field.trim());
    if (fields.length !== importedFields.length)
      return { line, kind: 'invalid', message: 'Expected exactly 11 pipe-separated fields' };
    if (fields.slice(0, 4).some((field) => !field))
      return { line, kind: 'invalid', message: 'The first four fields are required' };
    if (fields.some((field) => !fieldTextSchema.safeParse(field).success))
      return { line, kind: 'invalid', message: 'A field exceeds the length limit' };
    const [
      number = '',
      expiryMonth = '',
      expiryYear = '',
      securityCode = '',
      cardholderName = '',
      billingAddress = '',
      billingCity = '',
      billingRegion = '',
      billingPostalCode = '',
      billingCountryCode = '',
      extra = '',
    ] = fields;
    return {
      line,
      kind: 'card',
      values: {
        number,
        expiryMonth,
        expiryYear,
        securityCode,
        cardholderName,
        billingAddress,
        billingCity,
        billingRegion,
        billingPostalCode,
        billingCountryCode,
        extra,
      },
    };
  });
}
export function createImportPump(
  commit: (lines: ParsedLine[]) => Result<ImportLineResult[]>,
  yieldControl: () => Promise<void> = () => new Promise((resolve) => setImmediate(resolve)),
) {
  let tail = Promise.resolve();
  return (lines: ParsedLine[]): Promise<Result<ImportReport>> => {
    const pending = tail.then(async () => {
      const report: ImportReport = {
        outcome: 'complete',
        inserted: 0,
        duplicates: 0,
        invalid: 0,
        blank: 0,
        lines: [],
        unprocessedFromLine: null,
        message: '',
      };
      for (let index = 0; index < lines.length; index += limits.importBatchRows) {
        const batch = lines.slice(index, index + limits.importBatchRows);
        const result = commit(batch);
        if (!result.ok) {
          report.outcome = 'partial';
          report.unprocessedFromLine = batch[0]?.line ?? null;
          report.message = 'Import stopped after the committed lines';
          return { ok: true, value: report } satisfies Result<ImportReport>;
        }
        for (const line of result.value) {
          report.lines.push(line);
          switch (line.kind) {
            case 'inserted':
              report.inserted++;
              break;
            case 'duplicate':
              report.duplicates++;
              break;
            case 'invalid':
              report.invalid++;
              break;
            case 'blank':
              report.blank++;
              break;
          }
        }
        await yieldControl();
      }
      return { ok: true, value: report } satisfies Result<ImportReport>;
    });
    tail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };
}

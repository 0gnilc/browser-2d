import { materialCreateSchema } from '@browser-2d/contracts/public';

export function parseMaterialLine(line: string) {
  function parse(fields: string[]) {
    const expiry = fields[1]?.match(/^(\d{1,2})\/(\d+)$/);
    if (expiry) fields.splice(1, 1, expiry[1] ?? '', expiry[2] ?? '');
    const [card, month, year, cvv, name, address, city, state, zip, country, ...extra] = fields;
    return materialCreateSchema.safeParse({
      card,
      month,
      year,
      cvv,
      name,
      address,
      city,
      state,
      zip,
      country,
      ...(extra.length ? { extra: extra.join('|') } : {}),
    });
  }
  const split = (delimiter: string) => line.split(delimiter).map((value) => value.trim());
  if (line.includes('|')) {
    const normal = parse(split('|'));
    if (normal.success || !line.includes('||')) return normal;
    return parse(split('||'));
  }
  const delimiter = ['----', '--', '/', '-'].find((value) => line.includes(value));
  return parse(delimiter ? split(delimiter) : [line.trim()]);
}

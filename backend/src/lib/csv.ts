/**
 * CSV for exports that people open in a spreadsheet (M10, ADR 0022).
 *
 * Every field is quoted, quotes are doubled (RFC 4180), and lines end CRLF. A field a spreadsheet
 * would read as a formula — one starting with `=`, `+`, `-`, `@`, a tab or a carriage return — is
 * prefixed with an apostrophe (OWASP "CSV injection"): a customer's name or address must never run
 * as a formula on an administrator's machine. Numbers are written by the caller as plain strings,
 * so a negative amount is not mistaken for a formula only because the caller formats it.
 */
export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return '""';

  const text = typeof value === 'string' ? value : String(value);
  const safe = typeof value === 'string' && FORMULA_START.test(text) ? `'${text}` : text;

  return `"${safe.replaceAll('"', '""')}"`;
}

export function csvRow(values: readonly CsvValue[]): string {
  return values.map(csvField).join(',');
}

const BOM = String.fromCharCode(0xfeff);

/** A byte-order mark first, so Excel opens UTF-8 (৳, Bengali names) correctly. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return `${BOM}${[csvRow(header), ...rows.map(csvRow)].join('\r\n')}\r\n`;
}

/** Minor units as a decimal string, `285000` → `2850.00`. */
export function minorToDecimal(amountMinor: number): string {
  const sign = amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(amountMinor);
  return `${sign}${String(Math.floor(absolute / 100))}.${String(absolute % 100).padStart(2, '0')}`;
}

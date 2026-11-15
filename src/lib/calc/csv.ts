// CSV export (FINANCIAL_MODEL_REQUIREMENTS 6.2). RFC 4180, header row, CRLF line breaks,
// numbers unformatted with the unit in the column name, and text cells that could start a
// spreadsheet formula prefixed with an apostrophe.

export type CsvCell = string | number;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`csvCell: ${value} is not finite`);
    return String(value);
  }
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  for (const row of rows) {
    if (row.length !== header.length) throw new RangeError('toCsv: every row needs one cell per column');
  }
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Cents as dollars with exactly two decimals, unformatted: 123456 gives "1234.56". */
export function centsToCsv(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`centsToCsv: ${cents} is not whole cents`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

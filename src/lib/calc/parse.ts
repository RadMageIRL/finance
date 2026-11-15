// Parsing visitor input. Presentation only. Accepts what people type or paste
// ("$1,234.56", "5.25%", " 30 ") and returns exact values or a reason it could not.

import type { Cents } from '../engines/money';

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: 'empty' | 'not-a-number' | 'too-many-decimals' };

const cleaned = (text: string): string => text.trim().replace(/[\s,$%]/g, '');

/** "1,234.56" or "$1234.5" to cents, exactly (no floating point). At most two decimals. */
export function parseMoney(text: string): Parsed<Cents> {
  const t = cleaned(text);
  if (t === '') return { ok: false, reason: 'empty' };
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(t) ?? /^(-?)()\.(\d+)$/.exec(t);
  if (!m) return { ok: false, reason: 'not-a-number' };
  const [, sign, whole = '', fraction = ''] = m;
  if (fraction.length > 2) return { ok: false, reason: 'too-many-decimals' };
  const cents = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) return { ok: false, reason: 'not-a-number' };
  return { ok: true, value: sign === '-' ? -cents : cents };
}

/**
 * "5.25" or "5.25%" (a percent) to a rate fraction, 0.0525. Up to four decimals in the
 * percent. The fraction is built from the decimal text so 5.25 becomes exactly the double
 * nearest 0.0525.
 */
export function parsePercent(text: string): Parsed<number> {
  const t = cleaned(text);
  if (t === '') return { ok: false, reason: 'empty' };
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return { ok: false, reason: 'not-a-number' };
  const [, sign, whole = '', fraction = ''] = m;
  if (fraction.length > 4) return { ok: false, reason: 'too-many-decimals' };
  // Shift the decimal point two places left in text, then let Number read it once.
  const digits = `${whole || '0'}${fraction}`.replace(/^0+(?=\d)/, '');
  const scale = fraction.length + 2;
  const padded = digits.padStart(scale + 1, '0');
  const value = Number(`${sign}${padded.slice(0, -scale)}.${padded.slice(-scale)}`);
  return { ok: true, value: Object.is(value, -0) ? 0 : value };
}

/** A whole number, for years or months. */
export function parseWhole(text: string): Parsed<number> {
  const t = cleaned(text);
  if (t === '') return { ok: false, reason: 'empty' };
  if (!/^-?\d+$/.test(t)) return { ok: false, reason: /^-?\d*\.\d+$/.test(t) ? 'too-many-decimals' : 'not-a-number' };
  return { ok: true, value: Number(t) };
}

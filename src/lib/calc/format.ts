// Display formatting for calculators. Presentation only: engines never format.

import type { Cents } from '../engines/money';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** $1,234.56 from 123456 cents. Exact: whole dollars and cents are formatted separately. */
export function formatUSD(cents: Cents): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`formatUSD: ${cents} is not whole cents`);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  const text = `$${integer.format(dollars)}.${String(rest).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

const usd4 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 });

/**
 * An unrounded amount of cents in dollars to four decimals (a hundredth of a cent), for
 * interest accrued but not yet credited: 3745.678 cents gives $37.4568.
 */
export function formatUSD4(cents: number): string {
  if (!Number.isFinite(cents)) throw new RangeError(`formatUSD4: ${cents} is not finite`);
  const text = usd4.format(cents / 100);
  // A value that rounds to zero shows no sign.
  return text === '-$0.0000' ? '$0.0000' : text;
}

/** $1,235 from 123456 cents, for chart axes and compact summaries. */
export function formatUSDWhole(cents: Cents): string {
  return usdWhole.format(Math.round(cents / 100));
}

/** Compact axis labels: $950, $12K, $1.2M. */
export function formatUSDCompact(cents: Cents): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  if (abs >= 1e9) return `$${trim(dollars / 1e9)}B`;
  if (abs >= 1e6) return `$${trim(dollars / 1e6)}M`;
  if (abs >= 1e3) return `$${trim(dollars / 1e3)}K`;
  return usdWhole.format(dollars);
}

function trim(value: number): string {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1).replace(/\.0$/, '') : value.toFixed(2).replace(/\.?0+$/, '');
}

/** A rate fraction as a percent with up to `digits` decimals, trailing zeros removed: 0.0525 gives 5.25%. */
export function formatRate(fraction: number, digits = 4): string {
  const percent = (fraction * 100).toFixed(digits).replace(/\.?0+$/, '');
  return `${percent}%`;
}

export function formatInteger(value: number): string {
  return integer.format(value);
}

/** Exported for tests: the Intl formatter, to check formatUSD against it for ordinary values. */
export const intlUSD = (cents: Cents): string => usd.format(cents / 100);

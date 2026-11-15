// Rate illustration for the APR/APY page (ENGINE_CONVENTIONS section 12, v1.4). Pure.
//
// What each account's APY means over time: a single deposit, left alone, compounding at the
// account's periodic rate at the end of each compounding period on the calendar, with
// interest not rounded. After each full year the balance is the deposit times (1 + APY) to
// the power of the years, exactly. It models no bank's posting; the savings calculator does.

import { CALENDAR_PERIODS, completedPeriods, periodBoundaries, YEAR_DAYS } from './calendar';
import { MAX_CENTS, roundCents, type Cents } from './money';
import { COMPOUNDING_FREQUENCIES, type CompoundingFrequency } from './rates';
import type { Grouping } from './schedule';
import { Checker, type Result } from './validate';

export interface IllustrationAccount {
  /** Interest rate (nominal annual rate) as a fraction. */
  annualRate: number;
  periodsPerYear: CompoundingFrequency;
}

export interface IllustrationInput {
  deposit: Cents;
  years: number;
  accounts: readonly IllustrationAccount[];
}

export interface IllustrationRow {
  /** 1-based number of the day, month or year. */
  index: number;
  /** The boundary the row ends at. */
  end: number;
  /** Per account: compounding periods completed by the end of the row. */
  periods: number[];
  /** Per account: the balance, unrounded cents. */
  balances: number[];
  /** Per account: the balance rounded to the cent, as shown. */
  shown: Cents[];
}

export const ILLUSTRATION_LIMITS = {
  deposit: { min: 1, max: MAX_CENTS, integer: true },
  years: { min: 1, max: 30, integer: true },
  annualRate: { min: 0, max: 1 },
} as const;

export const MAX_ILLUSTRATED_ACCOUNTS = 3;

// Every compounding frequency the comparison offers also follows the calendar.
const ON_CALENDAR: readonly number[] = CALENDAR_PERIODS;
if (!COMPOUNDING_FREQUENCIES.every((n) => ON_CALENDAR.includes(n))) throw new Error('rate illustration: a compounding frequency is not on the calendar');

/** The balance after k completed periods: deposit (1 + r/n)^k, unrounded (conventions 12.2). */
function balanceAfter(deposit: Cents, account: IllustrationAccount, k: number): number {
  // log1p keeps the digits that forming 1 + r/n first would lose (conventions 12.3).
  return deposit * Math.exp(k * Math.log1p(account.annualRate / account.periodsPerYear));
}

export function validateIllustration(input: IllustrationInput): Checker {
  const check = new Checker();
  check.number('deposit', input.deposit, ILLUSTRATION_LIMITS.deposit);
  check.number('years', input.years, ILLUSTRATION_LIMITS.years);
  const accounts = Array.isArray(input.accounts) ? input.accounts : [];
  if (accounts.length < 1) check.add({ field: 'accounts', code: 'below-minimum', limit: 1 });
  if (accounts.length > MAX_ILLUSTRATED_ACCOUNTS) check.add({ field: 'accounts', code: 'above-maximum', limit: MAX_ILLUSTRATED_ACCOUNTS });
  accounts.forEach((a, i) => {
    check.number(`accounts[${i}].annualRate`, a.annualRate, ILLUSTRATION_LIMITS.annualRate);
    check.oneOf(`accounts[${i}].periodsPerYear`, a.periodsPerYear, COMPOUNDING_FREQUENCIES);
  });
  return check;
}

/** The boundaries the rows of a grouping end at: every day, month end or year end of the term. */
function rowEnds(grouping: Grouping, years: number): number[] {
  if (grouping === 'year') return Array.from({ length: years }, (_, y) => (y + 1) * YEAR_DAYS);
  if (grouping === 'month') return periodBoundaries(12, years).slice(1);
  return Array.from({ length: years * YEAR_DAYS }, (_, d) => d + 1);
}

/** Rows of the illustration by day, month or year (conventions 12.3). */
export function rateIllustration(input: IllustrationInput, grouping: Grouping): Result<IllustrationRow[]> {
  const check = validateIllustration(input);
  if (!check.ok) return check.fail();
  // Balances only grow, so the first year whose end balance passes the cap is where the
  // illustration stops being exact in cents (conventions section 7 and 12.2).
  for (let year = 1; year <= input.years; year += 1) {
    if (input.accounts.some((a) => balanceAfter(input.deposit, a, a.periodsPerYear * year) > Number.MAX_SAFE_INTEGER)) {
      check.add({ field: 'years', code: 'result-too-large', limit: year });
      return check.fail();
    }
  }
  const rows = rowEnds(grouping, input.years).map((end, i) => {
    const periods = input.accounts.map((a) => completedPeriods(a.periodsPerYear, end));
    const balances = input.accounts.map((a, j) => balanceAfter(input.deposit, a, periods[j]!));
    return { index: i + 1, end, periods, balances, shown: balances.map(roundCents) };
  });
  return { ok: true, value: rows };
}

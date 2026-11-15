// Compound interest engine (ENGINE_CONVENTIONS section 5, v1.2). Pure.
//
// Interest is credited at the end of each compounding period, rounded to the cent. Each
// period earns the annual rate divided by the compounding frequency, applied to the
// period's average daily balance, so a contribution made part way through a period earns
// interest for the days it was in the account. Contributions follow their own frequency and
// the calendar in calendar.ts (months of their real lengths, 7 and 14 day cycles).

import { contributionBoundaries, CONTRIBUTION_FREQUENCIES, periodBoundaries, type ContributionFrequency, type ContributionTiming } from './calendar';
import { averageBalanceInterest, MAX_CENTS, type Cents } from './money';
import { Checker, type Result } from './validate';

export { CONTRIBUTION_FREQUENCIES, type ContributionFrequency, type ContributionTiming } from './calendar';

export const COMPOUND_FREQUENCIES = [1, 2, 4, 12, 365] as const;
export type CompoundFrequency = (typeof COMPOUND_FREQUENCIES)[number];

export interface CompoundInput {
  principal: Cents;
  annualRate: number;
  /** Compounding frequency. */
  periodsPerYear: CompoundFrequency;
  years: number;
  contributionFrequency: ContributionFrequency;
  /** Each contribution; not used when the frequency is none. */
  contribution: Cents;
  /** Start or end of each contribution interval; not used when the frequency is none. */
  timing: ContributionTiming;
}

export interface CompoundYear {
  year: number;
  startBalance: Cents;
  contributions: Cents;
  interest: Cents;
  endBalance: Cents;
}

/** One compounding period: interest is credited, rounded to the cent, at its end. */
export interface CompoundPeriod {
  /** Boundaries (day numbers) where the period starts and ends. */
  start: number;
  end: number;
  startBalance: Cents;
  contributions: Cents;
  interest: Cents;
  endBalance: Cents;
}

export interface CompoundResult {
  finalBalance: Cents;
  totalContributions: Cents;
  totalInterest: Cents;
  /** Number of contributions made over the term. */
  contributionCount: number;
  /** Number of compounding periods. */
  periods: number;
  years: CompoundYear[];
  /** Every compounding period in order, for schedules by day, month or year (conventions 11). */
  creditPeriods: CompoundPeriod[];
}

export const COMPOUND_LIMITS = {
  principal: { min: 0, max: MAX_CENTS, integer: true },
  annualRate: { min: 0, max: 1 },
  years: { min: 1, max: 100, integer: true },
  contribution: { min: 0, max: MAX_CENTS, integer: true },
} as const;

export function validateCompound(input: CompoundInput): Checker {
  const check = new Checker();
  check.number('principal', input.principal, COMPOUND_LIMITS.principal);
  check.number('annualRate', input.annualRate, COMPOUND_LIMITS.annualRate);
  check.oneOf('periodsPerYear', input.periodsPerYear, COMPOUND_FREQUENCIES);
  check.number('years', input.years, COMPOUND_LIMITS.years);
  if (check.oneOf('contributionFrequency', input.contributionFrequency, CONTRIBUTION_FREQUENCIES) && input.contributionFrequency !== 'none') {
    check.number('contribution', input.contribution, COMPOUND_LIMITS.contribution);
    check.oneOf('timing', input.timing, ['start', 'end'] as const);
  }
  return check;
}

export function compoundInterest(input: CompoundInput): Result<CompoundResult> {
  const check = validateCompound(input);
  if (!check.ok) return check.fail();

  const { principal, annualRate, periodsPerYear: n, years, contributionFrequency, timing } = input;
  const contribution = contributionFrequency === 'none' ? 0 : input.contribution;
  const bounds = periodBoundaries(n, years);
  const deposits = contributionBoundaries(contributionFrequency, timing, years);
  // A start-timing contribution belongs to the period it starts; an end-timing one to the
  // period it ends (conventions 5.4 step 1). It earns interest from its own day either way.
  const belongs = timing === 'start' ? (t: number, end: number) => t < end : (t: number, end: number) => t <= end;

  const rows: CompoundYear[] = [];
  const creditPeriods: CompoundPeriod[] = [];
  let balance = principal;
  let totalInterest = 0;
  let next = 0;

  for (let year = 1; year <= years; year += 1) {
    const startBalance = balance;
    let yearInterest = 0;
    let yearCount = 0;
    for (let k = (year - 1) * n; k < year * n; k += 1) {
      const start = bounds[k]!;
      const end = bounds[k + 1]!;
      const days = end - start;
      let count = 0;
      let heldDays = 0;
      while (next < deposits.length && belongs(deposits[next]!, end)) {
        heldDays += end - deposits[next]!;
        count += 1;
        next += 1;
      }
      // Sum of the daily balances over the period, in cent-days (conventions 5.4 step 3).
      const balanceDays = BigInt(balance) * BigInt(days) + BigInt(contribution) * BigInt(heldDays);
      const interest = averageBalanceInterest(balanceDays, days, annualRate, n);
      const startBalance = balance;
      balance += contribution * count + interest;
      yearInterest += interest;
      yearCount += count;
      // Beyond 2^53 - 1 cents floats no longer hold exact cents (conventions section 7).
      if (balance > Number.MAX_SAFE_INTEGER) {
        check.add({ field: 'years', code: 'result-too-large', limit: year });
        return check.fail();
      }
      creditPeriods.push({ start, end, startBalance, contributions: contribution * count, interest, endBalance: balance });
    }
    totalInterest += yearInterest;
    rows.push({ year, startBalance, contributions: contribution * yearCount, interest: yearInterest, endBalance: balance });
  }

  return {
    ok: true,
    value: {
      finalBalance: balance,
      totalContributions: contribution * deposits.length,
      totalInterest,
      contributionCount: deposits.length,
      periods: n * years,
      years: rows,
      creditPeriods,
    },
  };
}

// Compound interest engine (ENGINE_CONVENTIONS section 5). Pure.
//
// Interest is credited at the end of each compounding period and rounded to the cent when
// credited. A contribution is made once per compounding period, at its start (before that
// period's interest) or its end (after it).

import { MAX_CENTS, periodicInterest, type Cents } from './money';
import { annuityFactor, growthFactor } from './rates';
import { Checker, type Result } from './validate';

export const COMPOUND_FREQUENCIES = [1, 2, 4, 12, 365] as const;
export type CompoundFrequency = (typeof COMPOUND_FREQUENCIES)[number];
export type ContributionTiming = 'start' | 'end';

export interface CompoundInput {
  principal: Cents;
  annualRate: number;
  periodsPerYear: CompoundFrequency;
  years: number;
  contribution: Cents;
  timing: ContributionTiming;
}

export interface CompoundYear {
  year: number;
  startBalance: Cents;
  contributions: Cents;
  interest: Cents;
  endBalance: Cents;
}

export interface CompoundResult {
  finalBalance: Cents;
  totalContributions: Cents;
  totalInterest: Cents;
  periods: number;
  years: CompoundYear[];
  /** The unrounded textbook closed form, for explanation only. */
  closedForm: number;
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
  check.number('contribution', input.contribution, COMPOUND_LIMITS.contribution);
  check.oneOf('timing', input.timing, ['start', 'end'] as const);
  return check;
}

/** The unrounded closed form: P(1+i)^N + C((1+i)^N - 1)/i, times (1+i) for start timing. */
export function compoundClosedForm(input: CompoundInput): number {
  const i = input.annualRate / input.periodsPerYear;
  const periods = input.periodsPerYear * input.years;
  const contributionTerm = input.contribution * annuityFactor(i, periods) * (input.timing === 'start' ? 1 + i : 1);
  return input.principal * growthFactor(i, periods) + contributionTerm;
}

export function compoundInterest(input: CompoundInput): Result<CompoundResult> {
  const check = validateCompound(input);
  if (!check.ok) return check.fail();

  const { principal, annualRate, periodsPerYear: n, years, contribution, timing } = input;
  const periods = n * years;
  const rows: CompoundYear[] = [];
  let balance = principal;
  let totalInterest = 0;

  for (let year = 1; year <= years; year += 1) {
    const startBalance = balance;
    let yearInterest = 0;
    for (let p = 0; p < n; p += 1) {
      if (timing === 'start') balance += contribution;
      // Exact: balance x rate / n, rounded half away from zero (conventions section 2).
      const interest = periodicInterest(balance, annualRate, n);
      balance += interest;
      yearInterest += interest;
      if (timing === 'end') balance += contribution;
      // Beyond 2^53 - 1 cents floats no longer hold exact cents (conventions section 7).
      if (balance > Number.MAX_SAFE_INTEGER) {
        check.add({ field: 'years', code: 'result-too-large', limit: year });
        return check.fail();
      }
    }
    totalInterest += yearInterest;
    rows.push({ year, startBalance, contributions: contribution * n, interest: yearInterest, endBalance: balance });
  }

  return {
    ok: true,
    value: {
      finalBalance: balance,
      totalContributions: contribution * periods,
      totalInterest,
      periods,
      years: rows,
      closedForm: compoundClosedForm(input),
    },
  };
}

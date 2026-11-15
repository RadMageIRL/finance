// Interest rate conventions for deposits: nominal rate and APY conversions, Regulation DD
// formulas, daily compounding and annuity factors (ENGINE_CONVENTIONS sections 3 and 4).
// Pure functions. They expect validated input and throw RangeError on anything else,
// because reaching them with bad input is a programming error, not a visitor error.

import { roundCents, type Cents } from './money';

/** Compounding frequencies per year: annual, semiannual, quarterly, monthly, weekly, daily. */
export const COMPOUNDING_FREQUENCIES = [1, 2, 4, 12, 52, 365] as const;
export type CompoundingFrequency = (typeof COMPOUNDING_FREQUENCIES)[number];

/** Regulation DD annualizes on a 365-day year. */
export const DAYS_IN_YEAR = 365;

function requireRate(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name}: ${value} is not a rate of 0 or more`);
}

function requireFrequency(n: number): void {
  if (!(COMPOUNDING_FREQUENCIES as readonly number[]).includes(n)) {
    throw new RangeError(`unsupported compounding frequency ${n}`);
  }
}

/** APY as a fraction: (1 + r/n)^n - 1. */
export function apyFromNominal(annualRate: number, periodsPerYear: CompoundingFrequency): number {
  requireRate('annualRate', annualRate);
  requireFrequency(periodsPerYear);
  return Math.expm1(periodsPerYear * Math.log1p(annualRate / periodsPerYear));
}

/** Nominal annual rate from an APY fraction: n((1 + APY)^(1/n) - 1). */
export function nominalFromApy(apy: number, periodsPerYear: CompoundingFrequency): number {
  requireRate('apy', apy);
  requireFrequency(periodsPerYear);
  return (periodsPerYear - 1) * Math.expm1(Math.log1p(apy) / periodsPerYear);
}

/**
 * Regulation DD annual percentage yield, as an unrounded percent:
 * 100[(1 + Interest/Principal)^(365/Days) - 1] (12 CFR part 1030, Appendix A, part I).
 */
export function regDdApyPercent(interest: Cents, principal: Cents, days: number): number {
  if (!(principal > 0)) throw new RangeError('principal must be positive');
  if (!Number.isInteger(days) || days < 1) throw new RangeError('days must be a positive integer');
  if (!(interest >= 0)) throw new RangeError('interest must be 0 or more');
  return 100 * Math.expm1((DAYS_IN_YEAR / days) * Math.log1p(interest / principal));
}

/**
 * Regulation DD annual percentage yield earned for a statement period, as an unrounded
 * percent: the same formula, with the interest actually credited and the average daily
 * balance (12 CFR part 1030, Appendix A, part II.A).
 */
export function apyEarnedPercent(interestEarned: Cents, averageDailyBalance: Cents, days: number): number {
  return regDdApyPercent(interestEarned, averageDailyBalance, days);
}

export interface RateSegment {
  annualRate: number;
  days: number;
}

/**
 * Interest on a single deposit compounded daily on a 365-day basis with no transactions,
 * through one or more rate segments (stepped or variable rates). Unrounded cents.
 */
export function dailyCompoundedInterest(principal: Cents, segments: readonly RateSegment[]): number {
  if (!(principal >= 0)) throw new RangeError('principal must be 0 or more');
  let logGrowth = 0;
  for (const segment of segments) {
    requireRate('annualRate', segment.annualRate);
    if (!Number.isInteger(segment.days) || segment.days < 0) throw new RangeError('days must be a whole number');
    logGrowth += segment.days * Math.log1p(segment.annualRate / DAYS_IN_YEAR);
  }
  return principal * Math.expm1(logGrowth);
}

/**
 * Interest on a single deposit with no transactions, compounded daily on a 365-day basis
 * and credited, rounded to the cent, at the end of each 365-day year of the term and at
 * maturity (ENGINE_CONVENTIONS section 4, v1.1). A rate change inside a year is not a
 * crediting point. This reproduces every Regulation DD Appendix A example.
 */
export function creditedDailyInterest(principal: Cents, segments: readonly RateSegment[]): Cents {
  if (!Number.isInteger(principal) || principal < 0) throw new RangeError('principal must be whole cents, 0 or more');
  let balance = principal;
  let pendingLog = 0;
  let daysInPeriod = 0;
  const credit = () => {
    balance += roundCents(balance * Math.expm1(pendingLog));
    pendingLog = 0;
    daysInPeriod = 0;
  };
  for (const segment of segments) {
    requireRate('annualRate', segment.annualRate);
    if (!Number.isInteger(segment.days) || segment.days < 0) throw new RangeError('days must be a whole number');
    let remaining = segment.days;
    while (remaining > 0) {
      const take = Math.min(remaining, DAYS_IN_YEAR - daysInPeriod);
      // Every pass must consume days; anything else is a defect, never an endless loop.
      if (take <= 0) throw new Error('creditedDailyInterest: crediting period did not advance');
      pendingLog += take * Math.log1p(segment.annualRate / DAYS_IN_YEAR);
      daysInPeriod += take;
      remaining -= take;
      if (daysInPeriod === DAYS_IN_YEAR) credit();
    }
  }
  if (daysInPeriod > 0) credit();
  return balance - principal;
}

/** Future value of 1 per period for `periods` periods at periodic rate i: ((1+i)^n - 1)/i. */
export function annuityFactor(periodicRate: number, periods: number): number {
  requireRate('periodicRate', periodicRate);
  if (periodicRate === 0) return periods;
  return Math.expm1(periods * Math.log1p(periodicRate)) / periodicRate;
}

/** (1 + i)^n. */
export function growthFactor(periodicRate: number, periods: number): number {
  requireRate('periodicRate', periodicRate);
  return Math.exp(periods * Math.log1p(periodicRate));
}

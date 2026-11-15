// Savings account (HYSA) engine (ENGINE_CONVENTIONS section 10, v1.3). Pure.
//
// A savings account as a bank runs one, as far as Regulation DD fixes it: interest is
// figured with a daily rate of 1/365 of the interest rate on each day's balance (12 CFR
// 1030.7(a)(1)), compounded daily or monthly, and credited at the end of each month,
// rounded to the cent. The advertised APY is turned into the interest rate by the
// calibration rule of section 10.3. Rates can change at the start of any month.
// Contributions follow the calendar in calendar.ts, exactly as in the compound engine.

import { contributionBoundaries, CONTRIBUTION_FREQUENCIES, MONTH_DAYS, periodBoundaries, YEAR_DAYS, type ContributionFrequency, type ContributionTiming } from './calendar';
import { MAX_CENTS, roundCents, type Cents } from './money';
import { Checker, type Result } from './validate';

export type HysaCompounding = 'daily' | 'monthly';
export const HYSA_COMPOUNDING = ['daily', 'monthly'] as const;

export interface RateStep {
  /** The first month (1-based) this APY applies to. */
  fromMonth: number;
  /** Advertised APY as a fraction: 4.5% is 0.045. */
  apy: number;
}

export interface HysaInput {
  principal: Cents;
  years: number;
  compounding: HysaCompounding;
  rates: readonly RateStep[];
  contributionFrequency: ContributionFrequency;
  contribution: Cents;
  timing: ContributionTiming;
}

export interface HysaRate extends RateStep {
  /** The interest rate (nominal annual rate) the APY implies under this compounding, unrounded. */
  annualRate: number;
}

export interface HysaMonth {
  month: number;
  days: number;
  startBalance: Cents;
  contributions: Cents;
  interest: Cents;
  endBalance: Cents;
  /** Regulation DD APY earned for the month, unrounded percent; null when the average daily balance is 0. */
  apyEarned: number | null;
  /** Index into `rates` of the rate in effect. */
  rate: number;
}

export interface HysaYear {
  year: number;
  startBalance: Cents;
  contributions: Cents;
  interest: Cents;
  endBalance: Cents;
}

export interface HysaResult {
  finalBalance: Cents;
  totalContributions: Cents;
  totalInterest: Cents;
  contributionCount: number;
  rates: HysaRate[];
  months: HysaMonth[];
  years: HysaYear[];
}

export const HYSA_LIMITS = {
  principal: { min: 0, max: MAX_CENTS, integer: true },
  years: { min: 1, max: 50, integer: true },
  apy: { min: 0, max: 1 },
  contribution: { min: 0, max: MAX_CENTS, integer: true },
} as const;

export const MAX_RATE_STEPS = 4;

/** Bisection steps for the monthly calibration: far more than reaching adjacent doubles needs. */
const CALIBRATION_STEPS = 200;

/**
 * The interest rate an advertised APY implies (ENGINE_CONVENTIONS 10.3): the rate at which a
 * single deposit held one 365-day year of the calendar, with no other transactions and with
 * interest unrounded, earns exactly the APY.
 */
export function rateFromApy(apy: number, compounding: HysaCompounding): number {
  if (!Number.isFinite(apy) || apy < 0) throw new RangeError(`rateFromApy: ${apy} is not an APY of 0 or more`);
  if (compounding === 'daily') return YEAR_DAYS * Math.expm1(Math.log1p(apy) / YEAR_DAYS);
  if (apy === 0) return 0;
  // prod (1 + r L_k / 365) = 1 + APY: the left side rises with r, and r <= APY since the
  // product is at least 1 + r. Bisect until the interval cannot shrink any further.
  const target = Math.log1p(apy);
  const growth = (r: number) => MONTH_DAYS.reduce((sum, days) => sum + Math.log1p((r * days) / YEAR_DAYS), 0);
  let low = 0;
  let high = apy;
  for (let step = 0; step < CALIBRATION_STEPS; step += 1) {
    const mid = (low + high) / 2;
    if (mid <= low || mid >= high) break;
    if (growth(mid) < target) low = mid;
    else high = mid;
  }
  return Math.abs(growth(low) - target) <= Math.abs(growth(high) - target) ? low : high;
}

export function validateHysa(input: HysaInput): Checker {
  const check = new Checker();
  check.number('principal', input.principal, HYSA_LIMITS.principal);
  const yearsOk = check.number('years', input.years, HYSA_LIMITS.years);
  check.oneOf('compounding', input.compounding, HYSA_COMPOUNDING);
  const rates = Array.isArray(input.rates) ? input.rates : [];
  if (rates.length < 1) check.add({ field: 'rates', code: 'below-minimum', limit: 1 });
  if (rates.length > MAX_RATE_STEPS) check.add({ field: 'rates', code: 'above-maximum', limit: MAX_RATE_STEPS });
  const lastMonth = yearsOk ? input.years * 12 : Number.POSITIVE_INFINITY;
  rates.forEach((step, i) => {
    if (i === 0) check.oneOf('rates[0].fromMonth', step.fromMonth, [1]);
    else {
      const earliest = rates[i - 1]!.fromMonth + 1;
      check.number(`rates[${i}].fromMonth`, step.fromMonth, { min: Number.isInteger(earliest) ? earliest : 2, max: lastMonth, integer: true });
    }
    check.number(`rates[${i}].apy`, step.apy, HYSA_LIMITS.apy);
  });
  if (check.oneOf('contributionFrequency', input.contributionFrequency, CONTRIBUTION_FREQUENCIES) && input.contributionFrequency !== 'none') {
    check.number('contribution', input.contribution, HYSA_LIMITS.contribution);
    check.oneOf('timing', input.timing, ['start', 'end'] as const);
  }
  return check;
}

/** Regulation DD APY earned for a period, unrounded percent (Appendix A, part II). */
function apyEarned(interest: Cents, balanceDays: number, days: number): number | null {
  if (!(balanceDays > 0)) return null;
  const averageDailyBalance = balanceDays / days;
  return 100 * Math.expm1((YEAR_DAYS / days) * Math.log1p(interest / averageDailyBalance));
}

export function savingsGrowth(input: HysaInput): Result<HysaResult> {
  const check = validateHysa(input);
  if (!check.ok) return check.fail();

  const { principal, years, compounding, contributionFrequency, timing } = input;
  const contribution = contributionFrequency === 'none' ? 0 : input.contribution;
  const rates: HysaRate[] = input.rates.map((step) => ({ ...step, annualRate: rateFromApy(step.apy, compounding) }));
  const bounds = periodBoundaries(12, years);
  const deposits = contributionBoundaries(contributionFrequency, timing, years);
  // A start-timing contribution belongs to the month it starts, an end-timing one to the
  // month it ends (conventions 10.2); either way it is in the account from its own day.
  const belongs = timing === 'start' ? (t: number, end: number) => t < end : (t: number, end: number) => t <= end;

  const months: HysaMonth[] = [];
  const yearRows: HysaYear[] = [];
  let balance = principal;
  let totalInterest = 0;
  let next = 0;
  let rateIndex = 0;

  for (let year = 1; year <= years; year += 1) {
    const yearStart = balance;
    let yearContributions = 0;
    let yearInterest = 0;
    for (let m = (year - 1) * 12; m < year * 12; m += 1) {
      const month = m + 1;
      while (rateIndex + 1 < rates.length && rates[rateIndex + 1]!.fromMonth <= month) rateIndex += 1;
      const rate = rates[rateIndex]!;
      const start = bounds[m]!;
      const end = bounds[m + 1]!;
      const days = end - start;
      const heldEnds: number[] = [];
      while (next < deposits.length && belongs(deposits[next]!, end)) {
        heldEnds.push(end - deposits[next]!);
        next += 1;
      }
      const heldDays = heldEnds.reduce((sum, d) => sum + d, 0);
      // Sum of the daily balances over the month, in cent-days (conventions 10.4 step 1).
      const balanceDays = balance * days + contribution * heldDays;
      let interest: Cents;
      if (compounding === 'monthly') {
        // Daily rate r/365 on each day's balance, added at the end of the month.
        interest = roundCents((balanceDays * rate.annualRate) / YEAR_DAYS);
      } else {
        // Daily growth g = (1 + APY)^(1/365), applied to the balance and to each deposit.
        const logDaily = Math.log1p(rate.apy) / YEAR_DAYS;
        const onDeposits = heldEnds.reduce((sum, d) => sum + Math.expm1(d * logDaily), 0);
        interest = roundCents(balance * Math.expm1(days * logDaily) + contribution * onDeposits);
      }
      const startBalance = balance;
      const added = contribution * heldEnds.length;
      balance += added + interest;
      // Beyond 2^53 - 1 cents floats no longer hold exact cents (conventions section 7).
      if (balance > Number.MAX_SAFE_INTEGER) {
        check.add({ field: 'years', code: 'result-too-large', limit: year });
        return check.fail();
      }
      months.push({ month, days, startBalance, contributions: added, interest, endBalance: balance, apyEarned: apyEarned(interest, balanceDays, days), rate: rateIndex });
      totalInterest += interest;
      yearContributions += added;
      yearInterest += interest;
    }
    // No APY earned for a year: Regulation DD defines it per statement period (10.5).
    yearRows.push({ year, startBalance: yearStart, contributions: yearContributions, interest: yearInterest, endBalance: balance });
  }

  return {
    ok: true,
    value: {
      finalBalance: balance,
      totalContributions: contribution * deposits.length,
      totalInterest,
      contributionCount: deposits.length,
      rates,
      months,
      years: yearRows,
    },
  };
}

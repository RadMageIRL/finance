// Schedules by day, month and year (ENGINE_CONVENTIONS section 11, v1.4). Pure.
//
// The compound interest and savings engines calculate per crediting period: interest is
// credited, rounded to the cent, at the end of each compounding period (compound) or each
// month (savings). A schedule shows that same calculation by day, month or year of the
// calendar. Day rows come from the engine's own crediting periods: each day gets its
// deposits, the interest it accrues (unrounded), and the period's credit on the period's
// last day only. Month and year rows are sums of day rows. Nothing is found by dividing a
// total, and the balances and credits are the engine's integers, never recomputed.

import { contributionBoundaries, MONTH_STARTS, YEAR_DAYS, type ContributionFrequency, type ContributionTiming } from './calendar';
import type { CompoundInput, CompoundResult } from './compound';
import type { HysaInput, HysaResult } from './hysa';
import type { Cents } from './money';

export const GROUPINGS = ['day', 'month', 'year'] as const;
export type Grouping = (typeof GROUPINGS)[number];

export interface ScheduleRow {
  /** 1-based number of the day, month or year within the term. */
  index: number;
  /** First and last day (0-based day numbers) the row covers. */
  firstDay: number;
  lastDay: number;
  opening: Cents;
  deposits: Cents;
  /** Interest accrued over the row, unrounded cents. */
  accrued: number;
  /** Interest credited in the row, from the engine. */
  credited: Cents;
  closing: Cents;
  /** Interest credited from the start of the term through the row. */
  cumulativeInterest: Cents;
  /** Indexes of the rate entries in effect, in order (always [0] when there is one rate). */
  rates: readonly number[];
}

/** A crediting period as the expansion needs it: boundaries, balances, the credit and the rate entry. */
interface CreditingPeriod {
  start: number;
  end: number;
  startBalance: Cents;
  interest: Cents;
  endBalance: Cents;
  rate: number;
}

/** Interest accrued on one day of a period, given the day's balance and the period's accrual so far. */
type Accrual = (period: CreditingPeriod, dayBalance: Cents, accruedSoFar: number) => number;

/** How many contributions fall on each day (conventions 11.1 step 1). */
function depositCounts(frequency: ContributionFrequency, timing: ContributionTiming, years: number): Uint16Array {
  const counts = new Uint16Array(years * YEAR_DAYS);
  // A start-timing contribution at boundary t is made at the start of day t; an end-timing
  // one at the end of day t - 1.
  for (const t of contributionBoundaries(frequency, timing, years)) counts[timing === 'start' ? t : t - 1]! += 1;
  return counts;
}

/** Shared rate lists, so 36,500 day rows do not each allocate one. */
const SINGLE_RATE: readonly (readonly number[])[] = [[0], [1], [2], [3]];

function expandDays(principal: Cents, periods: readonly CreditingPeriod[], counts: Uint16Array, contribution: Cents, timing: ContributionTiming, accrual: Accrual): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let opening = principal;
  let cumulative = 0;
  for (const period of periods) {
    if (period.startBalance !== opening) throw new Error(`schedule: the period from day ${period.start} does not start at the previous closing balance`);
    const rates = SINGLE_RATE[period.rate] ?? [period.rate];
    let accrued = 0;
    for (let day = period.start; day < period.end; day += 1) {
      const deposits = contribution * counts[day]!;
      const dayBalance = timing === 'start' ? opening + deposits : opening;
      const dayAccrued = accrual(period, dayBalance, accrued);
      accrued += dayAccrued;
      const credited = day === period.end - 1 ? period.interest : 0;
      const closing = opening + deposits + credited;
      cumulative += credited;
      rows.push({ index: day + 1, firstDay: day, lastDay: day, opening, deposits, accrued: dayAccrued, credited, closing, cumulativeInterest: cumulative, rates });
      opening = closing;
    }
    if (opening !== period.endBalance) throw new Error(`schedule: the days of the period from day ${period.start} do not reach its end balance`);
  }
  return rows;
}

/** Day rows for a compound interest result (conventions 11.1, section 5 accrual). */
export function compoundDays(input: CompoundInput, result: CompoundResult): ScheduleRow[] {
  const { annualRate, periodsPerYear: n } = input;
  const contribution = input.contributionFrequency === 'none' ? 0 : input.contribution;
  const periods = result.creditPeriods.map((p) => ({ ...p, rate: 0 }));
  const counts = depositCounts(input.contributionFrequency, input.timing, input.years);
  // Each day earns its share of the period's rate on that day's balance: annual_rate / (n L).
  return expandDays(input.principal, periods, counts, contribution, input.timing, (p, dayBalance) => (dayBalance * annualRate) / (n * (p.end - p.start)));
}

/** Day rows for a savings result (conventions 11.1, section 10 accrual). */
export function savingsDays(input: HysaInput, result: HysaResult): ScheduleRow[] {
  const contribution = input.contributionFrequency === 'none' ? 0 : input.contribution;
  const periods: CreditingPeriod[] = [];
  let start = 0;
  for (const m of result.months) {
    periods.push({ start, end: start + m.days, startBalance: m.startBalance, interest: m.interest, endBalance: m.endBalance, rate: m.rate });
    start += m.days;
  }
  const counts = depositCounts(input.contributionFrequency, input.timing, input.years);
  const rates = result.rates;
  let accrual: Accrual;
  if (input.compounding === 'monthly') {
    // A daily rate of r / 365 on each day's balance; accrued interest earns nothing until credited.
    accrual = (p, dayBalance) => (dayBalance * rates[p.rate]!.annualRate) / YEAR_DAYS;
  } else {
    // Daily compounding: the day's balance plus the interest accrued so far grows by g - 1.
    const growth = rates.map((r) => Math.expm1(Math.log1p(r.apy) / YEAR_DAYS));
    accrual = (p, dayBalance, accruedSoFar) => (dayBalance + accruedSoFar) * growth[p.rate]!;
  }
  return expandDays(input.principal, periods, counts, contribution, input.timing, accrual);
}

/** A row covering consecutive rows: sums in order, balances from the first and last. */
function combine(index: number, parts: readonly ScheduleRow[]): ScheduleRow {
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  let deposits = 0;
  let accrued = 0;
  let credited = 0;
  const rates: number[] = [];
  for (const part of parts) {
    deposits += part.deposits;
    accrued += part.accrued;
    credited += part.credited;
    for (const r of part.rates) if (rates[rates.length - 1] !== r) rates.push(r);
  }
  return { index, firstDay: first.firstDay, lastDay: last.lastDay, opening: first.opening, deposits, accrued, credited, closing: last.closing, cumulativeInterest: last.cumulativeInterest, rates };
}

/** Month rows (conventions 11.2): each calendar month of the term, summed from its days in order. */
function monthRows(days: readonly ScheduleRow[]): ScheduleRow[] {
  const out: ScheduleRow[] = [];
  const years = days.length / YEAR_DAYS;
  for (let year = 0; year < years; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      const from = year * YEAR_DAYS + MONTH_STARTS[month]!;
      const to = month === 11 ? (year + 1) * YEAR_DAYS : year * YEAR_DAYS + MONTH_STARTS[month + 1]!;
      out.push(combine(year * 12 + month + 1, days.slice(from, to)));
    }
  }
  return out;
}

/** Year rows (conventions 11.2): summed from the year's twelve month rows in order. */
function yearRows(months: readonly ScheduleRow[]): ScheduleRow[] {
  const out: ScheduleRow[] = [];
  for (let i = 0; i < months.length; i += 12) out.push(combine(i / 12 + 1, months.slice(i, i + 12)));
  return out;
}

/**
 * A schedule at every granularity, from the day rows. Month and year rows are built once,
 * on first use, so switching views never recalculates anything.
 */
export class Schedule {
  readonly days: readonly ScheduleRow[];
  #months: ScheduleRow[] | undefined;
  #years: ScheduleRow[] | undefined;

  constructor(days: readonly ScheduleRow[]) {
    if (days.length === 0 || days.length % YEAR_DAYS !== 0) throw new RangeError(`Schedule: ${days.length} days is not a whole number of years`);
    this.days = days;
  }

  get months(): readonly ScheduleRow[] {
    this.#months ??= monthRows(this.days);
    return this.#months;
  }

  get years(): readonly ScheduleRow[] {
    this.#years ??= yearRows(this.months);
    return this.#years;
  }

  rows(grouping: Grouping): readonly ScheduleRow[] {
    return grouping === 'day' ? this.days : grouping === 'month' ? this.months : this.years;
  }
}

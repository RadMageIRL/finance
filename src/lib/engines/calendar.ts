// Calendar conventions for the savings engines (ENGINE_CONVENTIONS 5.1 to 5.3, v1.2). Pure.
//
// Time is counted in whole days from day 0, January 1 of year 1. Every year has 365 days
// and the months of a common year; leap days are ignored and months are never treated as
// 30 days. A boundary t is the point between day t - 1 and day t, so boundary 0 starts the
// term and boundary 365 * years ends it.

/** Days in each month of a common (non-leap) year, January first. */
export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Days in every year of the calendar. */
export const YEAR_DAYS = 365;

/** Day offsets of the month starts within a year: 0, 31, 59, 90, ... 334. */
export const MONTH_STARTS: readonly number[] = MONTH_DAYS.reduce<number[]>((starts, days, i) => {
  if (i < MONTH_DAYS.length - 1) starts.push(starts[i]! + days);
  return starts;
}, [0]);

/** Periods per year that follow the calendar, and where each starts within a year. */
const PERIOD_STARTS: Readonly<Record<number, readonly number[]>> = {
  1: [0],
  2: [MONTH_STARTS[0]!, MONTH_STARTS[6]!],
  4: [MONTH_STARTS[0]!, MONTH_STARTS[3]!, MONTH_STARTS[6]!, MONTH_STARTS[9]!],
  12: MONTH_STARTS,
  365: Array.from({ length: YEAR_DAYS }, (_, day) => day),
};

export const CALENDAR_PERIODS = [1, 2, 4, 12, 365] as const;
export type CalendarPeriods = (typeof CALENDAR_PERIODS)[number];

export const CONTRIBUTION_FREQUENCIES = ['none', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annually'] as const;
export type ContributionFrequency = (typeof CONTRIBUTION_FREQUENCIES)[number];
export type ContributionTiming = 'start' | 'end';

/** Every 7 or 14 days: cycles that run across year ends and never restart. */
const CYCLE_DAYS: Readonly<Partial<Record<ContributionFrequency, number>>> = { weekly: 7, biweekly: 14 };

/** Calendar contribution frequencies, as periods per year. */
const CALENDAR_FREQUENCY: Readonly<Partial<Record<ContributionFrequency, CalendarPeriods>>> = { monthly: 12, quarterly: 4, annually: 1 };

/**
 * The boundaries of the calendar periods (months, quarters, half years, years or days) over
 * a term of `years` years, from 0 to the end of the term inclusive, in order.
 */
export function periodBoundaries(periodsPerYear: CalendarPeriods, years: number): number[] {
  const starts = PERIOD_STARTS[periodsPerYear];
  if (!starts) throw new RangeError(`periodBoundaries: ${periodsPerYear} periods a year does not follow the calendar`);
  if (!Number.isInteger(years) || years < 1) throw new RangeError(`periodBoundaries: ${years} years`);
  const out: number[] = [];
  for (let year = 0; year < years; year += 1) {
    for (const offset of starts) out.push(year * YEAR_DAYS + offset);
  }
  out.push(years * YEAR_DAYS);
  return out;
}

/**
 * The boundaries at which contributions are made (ENGINE_CONVENTIONS 5.3): the start of
 * each contribution interval (from the first day of the term, before its end) or the end of
 * each interval (after the first day, up to and including the end of the term). In order.
 */
export function contributionBoundaries(frequency: ContributionFrequency, timing: ContributionTiming, years: number): number[] {
  if (frequency === 'none') return [];
  const term = years * YEAR_DAYS;
  const cycle = CYCLE_DAYS[frequency];
  let intervals: number[];
  if (cycle) {
    intervals = [];
    for (let t = 0; t <= term; t += cycle) intervals.push(t);
  } else {
    const periods = CALENDAR_FREQUENCY[frequency];
    if (!periods) throw new RangeError(`contributionBoundaries: unknown frequency ${frequency}`);
    intervals = periodBoundaries(periods, years);
  }
  return timing === 'start' ? intervals.filter((t) => t < term) : intervals.filter((t) => t > 0);
}

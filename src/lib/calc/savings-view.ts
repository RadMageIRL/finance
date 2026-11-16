// Everything the high-yield savings page displays, derived from the engine result in one
// place, so the build-time render, the browser render, the CSV and the report show
// identical text.

import type { HysaCompounding, HysaInput, HysaResult } from '../engines/hysa';
import { percent2Text } from '../engines/money';
import { savingsDays, Schedule, type Grouping, type ScheduleRow } from '../engines/schedule';
import type { Issue } from '../engines/validate';
import { REPORT_ROW_LIMIT, reportSchedule, type Report } from '../report/report';
import { formatInteger, formatUSD } from './format';
import { contributionOption } from './frequency';
import { percentText } from './rates-view';
import { composition, groupingOption, monthName, scheduleChartSvg, scheduleTable, type ScheduleConfig } from './schedule-view';
import { AMOUNTS_FIELD, type Schema } from './share';

export const COMPOUNDING_OPTIONS: readonly { value: HysaCompounding; label: string; phrase: string }[] = [
  { value: 'daily', label: 'Daily, credited monthly', phrase: 'compounded daily and credited monthly' },
  { value: 'monthly', label: 'Monthly', phrase: 'compounded and credited monthly' },
];

export const compoundingOption = (value: HysaCompounding) => COMPOUNDING_OPTIONS.find((o) => o.value === value)!;

/** Up to three rate changes after the starting APY (the engine allows four steps in all). */
export const CHANGE_SLOTS = [1, 2, 3] as const;

/** The example shown before any change (also the no-JavaScript view). */
export const DEFAULT_SAVINGS: HysaInput = {
  principal: 1_000_000, // $10,000.00
  years: 5,
  compounding: 'daily',
  rates: [{ fromMonth: 1, apy: 0.045 }],
  contributionFrequency: 'monthly',
  contribution: 50_000, // $500.00
  timing: 'end',
};

export const SAVINGS_SERIES = [
  { key: 'principal', label: 'Starting balance' },
  { key: 'contributions', label: 'Deposits' },
  { key: 'interest', label: 'Interest' },
] as const;

export const SAVINGS_CALCULATOR = 'High-yield savings calculator';

/**
 * The page's assumptions, also printed in every report. The five the owner approved after
 * the M1.5 review (ENGINE_CONVENTIONS 10.8, items A to E) say so in their own words.
 */
export const SAVINGS_ASSUMPTIONS: readonly string[] = [
  'Interest is figured each day on that day\'s balance (the daily balance method), with a daily rate of 1/365 of the interest rate, the lowest daily rate 12 CFR 1030.7(a)(1) allows.',
  'Assumption (interest rate from the APY): the interest rate is worked out from the advertised APY so that a single deposit left for one year with no other transactions earns exactly that APY before rounding. Banks do not publish which formula they used, and advertised APYs are rounded to two decimals, so a bank\'s own rate can differ slightly.',
  'Assumption (rounding): each month\'s interest is rounded to the nearest cent, with half a cent rounding up, and no fraction of a cent is carried over. Some banks drop fractions of a cent instead, or carry them to the next month.',
  'Assumption (monthly crediting): interest is credited at the end of each calendar month. Some accounts credit quarterly or on another schedule.',
  'Statements are assumed to be monthly, one per calendar month, so the APY earned is shown for each month. Regulation DD does not require any particular statement period.',
  'Daily compounding: interest accrued each day earns interest from the next day, though it is credited only at the end of the month. Monthly compounding: interest earns nothing until it is credited.',
  'Assumption (calendar): every year has 365 days and starts on January 1, months have their real lengths, and leap days are ignored, so results are not tied to real dates. With a real start date, deposits and monthly credits would fall on different days, so results would differ. A leap day adds about one more day\'s interest on the balance at a bank that uses 1/365 of the interest rate every day; at a bank that uses 1/366 in leap years, as 12 CFR 1030.7(a)(1) allows, the year\'s interest comes out about the same. A rate change starts on the first day of its month.',
  'Assumption (deposit day): each deposit earns interest from the day it is made. A bank may start later: it must begin by the business day it receives credit for the funds, which for a check can be after the day of the deposit, and a deposit made after its cutoff hour or on a day that is not a banking day can count as made the next banking day (12 CFR 1030.7(c); 12 CFR 229.14(a), 229.19(a)(5)).',
  'Monthly, quarterly and yearly deposits are made on the first day of each period (start) or at the close of its last day (end). Weekly and biweekly deposits are made every 7 or 14 days from the first day, so the number per year varies; with deposits at the end of each interval, a partial interval left at the end of the term gets none. A deposit at the end of the last period is added on the final day and earns no interest.',
  'No withdrawals, fees, minimum balances, balance tiers, bonuses or taxes, and amounts are not adjusted for inflation.',
];

export const SAVINGS_SOURCES: readonly string[] = [
  '12 CFR part 1030 (Regulation DD, Truth in Savings), sections 1030.1, 1030.2, 1030.4, 1030.6, 1030.7 and appendix A, and the official commentary (Supplement I). Electronic Code of Federal Regulations, text as of November 1, 2026, verified November 15, 2026.',
  '12 CFR part 229 (Regulation CC, Availability of Funds and Collection of Checks), sections 229.14 and 229.19. Code of Federal Regulations, revised as of January 1, 2025, verified November 15, 2026.',
  '12 CFR part 707 (National Credit Union Administration, Truth in Savings), section 707.1. Code of Federal Regulations, revised as of January 1, 2025, verified November 15, 2026.',
];

/** An APY as disclosed: two decimals (12 CFR 1030.3(f)(1)). */
const apyText = (fraction: number) => `${percent2Text(fraction * 100)}%`;
/** An APY earned, already a percent. */
const earnedText = (percent: number | null) => (percent === null ? 'None' : `${percent2Text(percent)}%`);

export interface SavingsView {
  final: string;
  breakdown: { label: string; value: string }[];
  summary: string;
  rates: { months: string; apy: string; rate: string; earned: string }[];
}

function monthRange(from: number, to: number): string {
  return from === to ? `Month ${from}` : `Months ${formatInteger(from)} to ${formatInteger(to)}`;
}

/** The last month (1-based) each rate entry applies to. */
const lastMonthOf = (result: HysaResult, i: number) => (result.rates[i + 1]?.fromMonth ?? result.months.length + 1) - 1;

export function savingsView(input: HysaInput, result: HysaResult): SavingsView {
  const comp = compoundingOption(input.compounding);
  const rates = result.rates.map((r, i) => {
    const earned = result.months.filter((m) => m.rate === i && m.apyEarned !== null).map((m) => Number(percent2Text(m.apyEarned!)));
    const low = earned.length ? Math.min(...earned) : null;
    const high = earned.length ? Math.max(...earned) : null;
    return {
      months: monthRange(r.fromMonth, lastMonthOf(result, i)),
      apy: apyText(r.apy),
      rate: percentText(r.annualRate, 4),
      earned: low === null ? 'None' : low === high ? `${low.toFixed(2)}%` : `${low!.toFixed(2)}% to ${high!.toFixed(2)}%`,
    };
  });

  const deposits = result.contributionCount > 0 && result.totalContributions > 0;
  const often = contributionOption(input.contributionFrequency);
  const depositPhrase = deposits
    ? `${formatUSD(input.contribution)} ${often.often} at the ${input.timing} of each ${often.interval} (${formatInteger(result.contributionCount)} deposits, ${formatUSD(result.totalContributions)} in all)`
    : 'no regular deposits';
  const rateText =
    result.rates.length === 1
      ? `a ${apyText(result.rates[0]!.apy)} APY`
      : `APYs of ${result.rates.map((r) => apyText(r.apy)).join(', then ')}`;
  const summary =
    `After ${formatInteger(input.years)} ${input.years === 1 ? 'year' : 'years'} at ${rateText}, ${comp.phrase}, with ${depositPhrase}, ` +
    `the balance would be ${formatUSD(result.finalBalance)}, of which ${formatUSD(result.totalInterest)} is interest.`;

  return {
    final: formatUSD(result.finalBalance),
    breakdown: [
      { label: 'Starting balance', value: formatUSD(input.principal) },
      { label: 'Deposits', value: formatUSD(result.totalContributions) },
      { label: 'Interest earned', value: formatUSD(result.totalInterest) },
    ],
    summary,
    rates,
  };
}

export function savingsSchedule(input: HysaInput, result: HysaResult): Schedule {
  return new Schedule(savingsDays(input, result));
}

/** The rate columns and the APY earned column of the savings schedule. */
export function savingsScheduleConfig(result: HysaResult): ScheduleConfig {
  const apys = (row: ScheduleRow) => row.rates.map((i) => apyText(result.rates[i]!.apy));
  return {
    depositsLabel: 'Deposits',
    rates: {
      label: 'APY',
      text: (row) => apys(row).join(' then '),
      note: (row, previous) => (previous && row.rates[0] !== previous.rates[previous.rates.length - 1] ? 'New APY' : undefined),
      csvHeader: (g: Grouping) => (g === 'year' ? ['apy_percent', 'apy_end_percent'] : ['apy_percent', 'interest_rate_percent']),
      csv: (row, g) => {
        const first = result.rates[row.rates[0]!]!;
        const last = result.rates[row.rates[row.rates.length - 1]!]!;
        return g === 'year' ? [percent2Text(first.apy * 100), percent2Text(last.apy * 100)] : [percent2Text(first.apy * 100), (first.annualRate * 100).toFixed(10)];
      },
    },
    monthExtra: {
      label: 'APY earned',
      csv: 'apy_earned_percent',
      text: (row) => earnedText(result.months[row.index - 1]!.apyEarned),
      csvValue: (row) => {
        const earned = result.months[row.index - 1]!.apyEarned;
        return earned === null ? '' : earned.toFixed(10);
      },
    },
  };
}

/** Notes printed with the schedule: what accrued and credited mean for these settings. */
export function savingsScheduleNotes(input: HysaInput, grouping: Grouping): string[] {
  const notes = [
    'Interest accrued is figured each day without rounding and shown to a hundredth of a cent. It is credited, rounded to the cent, at the end of each month, and only credited interest is part of the balance.',
    input.compounding === 'daily'
      ? 'With daily compounding, interest accrued earlier in the month also earns interest each day, though it is credited only at the end of the month.'
      : 'With monthly compounding, interest accrued during a month earns nothing until it is credited at the end of the month.',
  ];
  if (grouping === 'day') notes.push('Day rows show a credit only on the last day of each month; on every other day the credited amount is zero.');
  if (grouping === 'month') notes.push('APY earned is the Regulation DD figure for each monthly statement period. Day and year rows have none.');
  if (grouping === 'year') notes.push('A year row adds up its twelve months. Regulation DD defines no APY earned for a year.');
  return notes;
}

export function savingsChartSvg(input: HysaInput, schedule: Schedule, grouping: Grouping, description: string, options: { idPrefix?: string; width?: number } = {}): string {
  return scheduleChartSvg(schedule, grouping, {
    principal: input.principal,
    series: SAVINGS_SERIES,
    depositsLabel: 'Deposits',
    title: `Savings balance at the end of each ${groupingOption(grouping).noun}`,
    description,
    idPrefix: options.idPrefix ?? 'sg-chart',
    ...(options.width ? { width: options.width } : {}),
  });
}

/** Each rate change in words, or a statement that the APY never changes. */
export function savingsRateChanges(input: HysaInput, result: HysaResult): string[] {
  const comp = input.compounding === 'daily' ? 'compounded daily' : 'compounded monthly';
  if (result.rates.length === 1) {
    const r = result.rates[0]!;
    return [`No rate changes: the APY is ${apyText(r.apy)} (interest rate ${percentText(r.annualRate, 4)}, ${comp}) for all ${formatInteger(result.months.length)} months.`];
  }
  return result.rates.map((r, i) => {
    const to = lastMonthOf(result, i);
    const when = i === 0 ? `From the start (month 1, ${monthName(1)})` : `From month ${formatInteger(r.fromMonth)} (${monthName(r.fromMonth)})`;
    return `${when} to month ${formatInteger(to)} (${monthName(to)}): APY ${apyText(r.apy)}, interest rate ${percentText(r.annualRate, 4)}, ${comp}.`;
  });
}

export function savingsInputs(input: HysaInput): { label: string; value: string }[] {
  const often = contributionOption(input.contributionFrequency);
  const out = [
    { label: 'Starting balance', value: formatUSD(input.principal) },
    { label: 'Starting APY', value: apyText(input.rates[0]!.apy) },
    { label: 'Compounding', value: compoundingOption(input.compounding).label },
    { label: 'Years', value: formatInteger(input.years) },
    { label: 'Deposit frequency', value: often.label },
  ];
  if (input.contributionFrequency !== 'none') {
    out.push({ label: 'Deposit amount', value: formatUSD(input.contribution) }, { label: 'Deposit timing', value: `${input.timing === 'start' ? 'Start' : 'End'} of each ${often.interval}` });
  }
  out.push({ label: 'Rate changes', value: input.rates.length === 1 ? 'None' : formatInteger(input.rates.length - 1) });
  return out;
}

/** The report for a scenario, with the schedule at the chosen grouping. */
export function savingsReport(input: HysaInput, result: HysaResult, schedule: Schedule, grouping: Grouping, generated: Date): Report {
  const view = savingsView(input, result);
  const config = savingsScheduleConfig(result);
  const part = (g: Grouping) => ({ heading: groupingOption(g).heading, table: scheduleTable(schedule, g, config), notes: savingsScheduleNotes(input, g) });
  const shown = reportSchedule(part(grouping), grouping === 'day' ? part('month') : null);
  const chartGrouping: Grouping = grouping === 'day' && schedule.days.length > REPORT_ROW_LIMIT ? 'month' : grouping;
  return {
    calculator: SAVINGS_CALCULATOR,
    generated,
    headline: { label: 'Projected balance', value: view.final },
    summary: [
      ...view.breakdown,
      { label: 'Number of deposits', value: formatInteger(result.contributionCount) },
      { label: 'APY earned by month', value: view.rates.map((r) => r.earned).join('; ') },
    ],
    sentence: view.summary,
    inputs: savingsInputs(input),
    composition: composition(input.principal, result.totalContributions, result.totalInterest, 'Deposits'),
    rateChanges: savingsRateChanges(input, result),
    tables: [],
    chart: {
      heading: `Balance by ${groupingOption(chartGrouping).noun}`,
      svg: savingsChartSvg(input, schedule, chartGrouping, view.summary, { idPrefix: 'report-chart', width: 720 }),
      legend: SAVINGS_SERIES.map((s) => s.label),
      summary: `${view.summary} The chart stacks the starting balance, the deposits made so far and the interest credited so far at the end of each ${groupingOption(chartGrouping).noun}; the schedule below has every figure.`,
    },
    schedule: shown,
    assumptions: SAVINGS_ASSUMPTIONS,
    sources: SAVINGS_SOURCES,
  };
}

const PERCENT: Schema[string] = { kind: 'decimal', min: 0, max: 100, decimals: 4 };
const MONTH: Schema[string] = { kind: 'int', min: 2, max: 600 };

/** Share link schema (version 1). Money fields: p and c. */
export const SAVINGS_SHARE_SCHEMA: Schema = {
  p: { kind: 'int', min: 0, max: 10_000_000_000 },
  r0: PERCENT,
  cmp: { kind: 'choice', values: ['daily', 'monthly'] },
  y: { kind: 'int', min: 1, max: 50 },
  m1: MONTH, r1: PERCENT,
  m2: MONTH, r2: PERCENT,
  m3: MONTH, r3: PERCENT,
  f: { kind: 'choice', values: ['none', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annually'] },
  c: { kind: 'int', min: 0, max: 10_000_000_000 },
  t: { kind: 'choice', values: ['start', 'end'] },
  a: AMOUNTS_FIELD,
};

export const SAVINGS_MONEY_KEYS = ['p', 'c'] as const;

export function savingsShareState(input: HysaInput): Record<string, number | string> {
  const state: Record<string, number | string> = {
    p: input.principal,
    r0: percentText(input.rates[0]!.apy, 4).replace('%', ''),
    cmp: input.compounding,
    y: input.years,
  };
  input.rates.slice(1).forEach((r, i) => {
    state[`m${i + 1}`] = r.fromMonth;
    state[`r${i + 1}`] = percentText(r.apy, 4).replace('%', '');
  });
  state.f = input.contributionFrequency;
  if (input.contributionFrequency !== 'none') {
    state.c = input.contribution;
    state.t = input.timing;
  }
  return state;
}

/**
 * Plain-language message for an engine issue, and the form field it belongs to. `slots`
 * maps each engine rate step after the first to its change row (1 to 3).
 */
export function savingsIssueMessage(issue: Issue, slots: readonly number[]): { field: string; message: string } {
  const step = /^rates\[(\d)\]\.(fromMonth|apy)$/.exec(issue.field);
  if (step) {
    const index = Number(step[1]);
    const slot = index === 0 ? 0 : slots[index - 1] ?? 1;
    if (step[2] === 'apy') return { field: `r${slot}`, message: issue.code === 'above-maximum' ? 'APYs up to 100% only.' : 'An APY cannot be negative.' };
    return {
      field: `m${slot}`,
      message: issue.code === 'above-maximum' ? 'This month is after the end of the projection.' : 'Each change must start after the one above it, from month 2 on.',
    };
  }
  switch (issue.field) {
    case 'principal':
      return { field: 'principal', message: issue.code === 'below-minimum' ? 'Starting balance cannot be negative.' : 'Starting balance is above the largest this calculator accepts.' };
    case 'years':
      return {
        field: 'years',
        message: issue.code === 'result-too-large' ? `The balance grows past $90 trillion by year ${issue.limit}, beyond what this calculator can show to the cent.` : 'Years must be a whole number from 1 to 50.',
      };
    case 'contribution':
      return { field: 'contribution', message: issue.code === 'below-minimum' ? 'A deposit cannot be negative.' : 'The deposit is above the largest this calculator accepts.' };
    default:
      return { field: 'r0', message: 'Check the entries.' };
  }
}

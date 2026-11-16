// Everything the compound interest page displays, derived from the engine result in one
// place, so the build-time render, the browser render, the CSV and the report show
// identical numbers.

import type { CompoundFrequency, CompoundInput, CompoundResult } from '../engines/compound';
import { compoundDays, Schedule, type Grouping } from '../engines/schedule';
import type { Issue } from '../engines/validate';
import { REPORT_ROW_LIMIT, reportSchedule, type Report } from '../report/report';
import { formatInteger, formatRate, formatUSD } from './format';
import { contributionOption } from './frequency';
import { composition, groupingOption, scheduleChartSvg, scheduleTable, type ScheduleConfig } from './schedule-view';
import { AMOUNTS_FIELD, type Schema } from './share';

export const FREQUENCIES: readonly { value: CompoundFrequency; label: string; period: string; periods: string }[] = [
  { value: 1, label: 'Annually', period: 'year', periods: 'years' },
  { value: 2, label: 'Semiannually', period: 'half year', periods: 'half years' },
  { value: 4, label: 'Quarterly', period: 'quarter', periods: 'quarters' },
  { value: 12, label: 'Monthly', period: 'month', periods: 'months' },
  { value: 365, label: 'Daily', period: 'day', periods: 'days' },
];

export const frequencyInfo = (n: CompoundFrequency) => FREQUENCIES.find((f) => f.value === n)!;

/** The scenario shown before the visitor changes anything (also the no-JavaScript view). */
export const DEFAULT_INPUT: CompoundInput = {
  principal: 1_000_000, // $10,000.00
  annualRate: 0.05,
  periodsPerYear: 12,
  years: 10,
  contributionFrequency: 'monthly',
  contribution: 10_000, // $100.00 a month
  timing: 'end',
};

export const SERIES = [
  { key: 'principal', label: 'Starting balance' },
  { key: 'contributions', label: 'Contributions' },
  { key: 'interest', label: 'Interest' },
] as const;

export const COMPOUND_CALCULATOR = 'Compound interest calculator';

/** The page's assumptions, also printed in every report. */
export const COMPOUND_ASSUMPTIONS: readonly string[] = [
  'The interest rate stays the same for the whole period. Real savings rates change.',
  'Interest is credited at the end of each compounding period and rounded to the nearest cent when it is credited, half a cent rounding up.',
  'Each compounding period earns the annual rate divided by the number of periods in a year, whatever its length: February earns the same monthly rate as January.',
  'Contributions follow their own schedule, separate from compounding. A contribution at the start of an interval earns interest from that day; one at the end is added at the close of the interval\'s last day and earns interest from the next day. One made part way through a compounding period earns that period\'s interest in proportion to the days it was in the account.',
  'The calendar: every year has 365 days and starts on January 1, months have their real lengths (31 days in January, 28 in February, and so on), quarters start in January, April, July and October, and leap days are ignored. Months are never treated as 30 days.',
  'Monthly, quarterly and yearly contributions are made on the first day of each month, quarter or year (start), or on its last day (end). Weekly and biweekly contributions are made every 7 or 14 days, counted from the first day.',
  'A 365-day year is 52 weeks and 1 day, so the number of weekly or biweekly contributions changes a little from year to year. With contributions at the start of each week, the first year has 53.',
  'With weekly or biweekly contributions at the end of each interval, a partial interval left at the end of the term gets no contribution.',
  'A contribution at the end of the last interval is added on the final day and earns no interest.',
  'No taxes, fees or withdrawals, and amounts are not adjusted for inflation.',
];

export interface CompoundView {
  final: string;
  breakdown: { label: string; value: string }[];
  summary: string;
}

/** "$100.00 a month at the end of each month, 120 contributions", or "no contributions". */
export function contributionPhrase(input: CompoundInput, result: CompoundResult): string {
  if (input.contributionFrequency === 'none' || result.totalContributions === 0) return 'no regular contributions';
  const o = contributionOption(input.contributionFrequency);
  const count = `${formatInteger(result.contributionCount)} ${result.contributionCount === 1 ? 'contribution' : 'contributions'}`;
  return `${formatUSD(input.contribution)} ${o.often} at the ${input.timing} of each ${o.interval}, ${count}`;
}

export function compoundView(input: CompoundInput, result: CompoundResult): CompoundView {
  const freq = frequencyInfo(input.periodsPerYear);
  const parts =
    result.totalContributions > 0
      ? `${formatUSD(input.principal)} starting balance, ${formatUSD(result.totalContributions)} in contributions (${contributionPhrase(input, result)}) and ${formatUSD(result.totalInterest)} in interest`
      : `${formatUSD(input.principal)} starting balance and ${formatUSD(result.totalInterest)} in interest, with no regular contributions`;
  const summary =
    `After ${formatInteger(input.years)} ${input.years === 1 ? 'year' : 'years'}, the balance would be ${formatUSD(result.finalBalance)}: ` +
    `${parts}, at ${formatRate(input.annualRate)} compounded ${freq.label.toLowerCase()}.`;
  return {
    final: formatUSD(result.finalBalance),
    breakdown: [
      { label: 'Starting balance', value: formatUSD(input.principal) },
      { label: 'Contributions', value: formatUSD(result.totalContributions) },
      { label: 'Interest earned', value: formatUSD(result.totalInterest) },
    ],
    summary,
  };
}

export function compoundSchedule(input: CompoundInput, result: CompoundResult): Schedule {
  return new Schedule(compoundDays(input, result));
}

export function compoundScheduleConfig(input: CompoundInput): ScheduleConfig {
  const rate = formatRate(input.annualRate);
  const csvRate = (input.annualRate * 100).toFixed(10);
  return {
    depositsLabel: 'Contributions',
    rates: { label: 'Rate', text: () => rate, csvHeader: () => ['annual_rate_percent'], csv: () => [csvRate] },
  };
}

/** Notes printed with the schedule: when interest is credited for this compounding. */
export function compoundScheduleNotes(input: CompoundInput, grouping: Grouping): string[] {
  const f = frequencyInfo(input.periodsPerYear);
  const notes =
    input.periodsPerYear === 365
      ? ['Interest is compounded and credited every day, rounded to the cent; interest accrued is the unrounded amount for the day, shown to a hundredth of a cent.']
      : [
          `Interest is credited at the end of each ${f.period}, rounded to the cent, and only then becomes part of the balance. Interest accrued is each day's share of the ${f.period}'s interest, figured without rounding and shown to a hundredth of a cent.`,
        ];
  if (input.periodsPerYear < 12 && grouping !== 'year') notes.push(`Rows that do not end a ${f.period} show interest accrued but no interest credited.`);
  if (input.periodsPerYear !== 365 && grouping === 'day') notes.push(`Day rows show a credit only on the last day of each ${f.period}.`);
  return notes;
}

export function compoundChartSvg(input: CompoundInput, schedule: Schedule, grouping: Grouping, description: string, options: { idPrefix?: string; width?: number } = {}): string {
  return scheduleChartSvg(schedule, grouping, {
    principal: input.principal,
    series: SERIES,
    depositsLabel: 'Contributions',
    title: `Balance at the end of each ${groupingOption(grouping).noun}`,
    description,
    idPrefix: options.idPrefix ?? 'ci-chart',
    ...(options.width ? { width: options.width } : {}),
  });
}

export function compoundInputs(input: CompoundInput): { label: string; value: string }[] {
  const often = contributionOption(input.contributionFrequency);
  const out = [
    { label: 'Starting balance', value: formatUSD(input.principal) },
    { label: 'Annual interest rate', value: formatRate(input.annualRate) },
    { label: 'Compounding', value: frequencyInfo(input.periodsPerYear).label },
    { label: 'Years', value: formatInteger(input.years) },
    { label: 'Contribution frequency', value: often.label },
  ];
  if (input.contributionFrequency !== 'none') {
    out.push({ label: 'Contribution amount', value: formatUSD(input.contribution) }, { label: 'Contribution timing', value: `${input.timing === 'start' ? 'Start' : 'End'} of each ${often.interval}` });
  }
  return out;
}

/** The report for a scenario, with the schedule at the chosen grouping. */
export function compoundReport(input: CompoundInput, result: CompoundResult, schedule: Schedule, grouping: Grouping, generated: Date): Report {
  const view = compoundView(input, result);
  const config = compoundScheduleConfig(input);
  const part = (g: Grouping) => ({ heading: groupingOption(g).heading, table: scheduleTable(schedule, g, config), notes: compoundScheduleNotes(input, g) });
  const shown = reportSchedule(part(grouping), grouping === 'day' ? part('month') : null);
  const chartGrouping: Grouping = grouping === 'day' && schedule.days.length > REPORT_ROW_LIMIT ? 'month' : grouping;
  return {
    calculator: COMPOUND_CALCULATOR,
    generated,
    headline: { label: 'Projected balance', value: view.final },
    summary: [...view.breakdown, { label: 'Number of contributions', value: formatInteger(result.contributionCount) }, { label: 'Compounding periods', value: formatInteger(result.periods) }],
    sentence: view.summary,
    inputs: compoundInputs(input),
    composition: composition(input.principal, result.totalContributions, result.totalInterest, 'Contributions'),
    rateChanges: null,
    tables: [],
    chart: {
      heading: `Balance by ${groupingOption(chartGrouping).noun}`,
      svg: compoundChartSvg(input, schedule, chartGrouping, view.summary, { idPrefix: 'report-chart', width: 720 }),
      legend: SERIES.map((s) => s.label),
      summary: `${view.summary} The chart stacks the starting balance, the contributions made so far and the interest credited so far at the end of each ${groupingOption(chartGrouping).noun}; the schedule below has every figure.`,
    },
    schedule: shown,
    assumptions: COMPOUND_ASSUMPTIONS,
    sources: [],
  };
}

/**
 * Share link schema (version 1): whole cents, percent with up to 4 decimals, choices, and
 * the amounts mode `a`. The money fields (p, c) are the ones a Rounded link rounds and a
 * No amounts link leaves out.
 */
export const SHARE_SCHEMA: Schema = {
  p: { kind: 'int', min: 0, max: 10_000_000_000 },
  r: { kind: 'decimal', min: 0, max: 100, decimals: 4 },
  n: { kind: 'choice', values: ['1', '2', '4', '12', '365'] },
  y: { kind: 'int', min: 1, max: 100 },
  f: { kind: 'choice', values: ['none', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annually'] },
  c: { kind: 'int', min: 0, max: 10_000_000_000 },
  t: { kind: 'choice', values: ['start', 'end'] },
  a: AMOUNTS_FIELD,
};

export const SHARE_MONEY_KEYS = ['p', 'c'] as const;

/** The share state for a scenario, before the amounts mode is applied. */
export function compoundShareState(input: CompoundInput): Record<string, number | string> {
  return {
    p: input.principal,
    r: formatRate(input.annualRate).replace('%', ''),
    n: String(input.periodsPerYear),
    y: input.years,
    f: input.contributionFrequency,
    ...(input.contributionFrequency === 'none' ? {} : { c: input.contribution, t: input.timing }),
  };
}

/** Plain-language message for an engine issue on a field. */
export function issueMessage(issue: Issue, label: string): string {
  const limit = typeof issue.limit === 'number' ? issue.limit : undefined;
  switch (issue.code) {
    case 'below-minimum':
      return issue.field === 'years' ? `${label} must be at least ${limit}.` : `${label} cannot be negative.`;
    case 'above-maximum':
      return issue.field === 'annualRate' ? `${label} can be at most 100%.` : `${label} is above the largest value this calculator accepts.`;
    case 'not-an-integer':
      return `${label} must be a whole number.`;
    case 'result-too-large':
      return `The balance grows past $90 trillion by year ${limit}, beyond what this calculator can show to the cent. Try fewer years or a lower rate.`;
    case 'unsupported-value':
      return `Choose one of the listed options for ${label.toLowerCase()}.`;
    default:
      return `Enter a number for ${label.toLowerCase()}.`;
  }
}

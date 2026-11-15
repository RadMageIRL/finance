// Everything the compound interest page displays, derived from the engine result in one
// place, so the build-time render and the browser render show identical numbers.

import type { CompoundFrequency, CompoundInput, CompoundResult } from '../engines/compound';
import type { Issue } from '../engines/validate';
import { stackedColumnsSvg } from './chart';
import { centsToCsv, toCsv } from './csv';
import { formatInteger, formatRate, formatUSD, formatUSDCompact } from './format';
import type { Schema } from './share';

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
  contribution: 10_000, // $100.00 a month
  timing: 'end',
};

export const SERIES = [
  { key: 'principal', label: 'Starting balance' },
  { key: 'contributions', label: 'Contributions' },
  { key: 'interest', label: 'Interest' },
] as const;

export interface CompoundRow {
  year: number;
  start: string;
  contributions: string;
  interest: string;
  end: string;
}

export interface CompoundView {
  final: string;
  breakdown: { label: string; value: string }[];
  summary: string;
  rows: CompoundRow[];
  totals: { contributions: string; interest: string; end: string };
  chartSvg: string;
  tooltips: string[][];
}

export function compoundView(input: CompoundInput, result: CompoundResult, chartWidth?: number): CompoundView {
  const freq = frequencyInfo(input.periodsPerYear);
  const summary =
    `After ${formatInteger(input.years)} ${input.years === 1 ? 'year' : 'years'}, the balance would be ${formatUSD(result.finalBalance)}: ` +
    `${formatUSD(input.principal)} starting balance, ${formatUSD(result.totalContributions)} in contributions and ${formatUSD(result.totalInterest)} in interest, ` +
    `at ${formatRate(input.annualRate)} compounded ${freq.label.toLowerCase()}.`;

  let contributionsToDate = 0;
  let interestToDate = 0;
  const values: number[][] = [];
  const tooltips: string[][] = [];
  const rows = result.years.map((y) => {
    contributionsToDate += y.contributions;
    interestToDate += y.interest;
    values.push([input.principal, contributionsToDate, interestToDate]);
    tooltips.push([
      `Year ${y.year}: ${formatUSD(y.endBalance)}`,
      `Starting balance ${formatUSD(input.principal)}`,
      `Contributions to date ${formatUSD(contributionsToDate)}`,
      `Interest to date ${formatUSD(interestToDate)}`,
    ]);
    return {
      year: y.year,
      start: formatUSD(y.startBalance),
      contributions: formatUSD(y.contributions),
      interest: formatUSD(y.interest),
      end: formatUSD(y.endBalance),
    };
  });

  return {
    final: formatUSD(result.finalBalance),
    breakdown: [
      { label: 'Starting balance', value: formatUSD(input.principal) },
      { label: 'Contributions', value: formatUSD(result.totalContributions) },
      { label: 'Interest earned', value: formatUSD(result.totalInterest) },
    ],
    summary,
    rows,
    totals: { contributions: formatUSD(result.totalContributions), interest: formatUSD(result.totalInterest), end: formatUSD(result.finalBalance) },
    chartSvg: stackedColumnsSvg({
      categories: result.years.map((y) => String(y.year)),
      series: SERIES,
      values,
      formatTick: formatUSDCompact,
      formatTotal: formatUSD,
      title: 'Balance at the end of each year',
      description: summary,
      idPrefix: 'ci-chart',
      ...(chartWidth ? { width: chartWidth } : {}),
    }),
    tooltips,
  };
}

export function compoundCsv(result: CompoundResult): string {
  return toCsv(
    ['year', 'start_balance_usd', 'contributions_usd', 'interest_usd', 'end_balance_usd'],
    result.years.map((y) => [y.year, centsToCsv(y.startBalance), centsToCsv(y.contributions), centsToCsv(y.interest), centsToCsv(y.endBalance)]),
  );
}

/** Share link schema (version 1): whole cents, percent with up to 4 decimals, choices. */
export const SHARE_SCHEMA: Schema = {
  p: { kind: 'int', min: 0, max: 10_000_000_000 },
  r: { kind: 'decimal', min: 0, max: 100, decimals: 4 },
  n: { kind: 'choice', values: ['1', '2', '4', '12', '365'] },
  y: { kind: 'int', min: 1, max: 100 },
  c: { kind: 'int', min: 0, max: 10_000_000_000 },
  t: { kind: 'choice', values: ['start', 'end'] },
};

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

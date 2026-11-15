// Everything the high-yield savings page displays, derived from the engine result in one
// place, so the build-time render and the browser render show identical text.

import type { HysaCompounding, HysaInput, HysaResult } from '../engines/hysa';
import { percent2Text } from '../engines/money';
import type { Issue } from '../engines/validate';
import { stackedColumnsSvg } from './chart';
import { centsToCsv, toCsv } from './csv';
import { formatInteger, formatUSD, formatUSDCompact } from './format';
import { contributionOption } from './frequency';
import { percentText } from './rates-view';
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

/** An APY as disclosed: two decimals (12 CFR 1030.3(f)(1)). */
const apyText = (fraction: number) => `${percent2Text(fraction * 100)}%`;
/** An APY earned, already a percent. */
const earnedText = (percent: number | null) => (percent === null ? 'None' : `${percent2Text(percent)}%`);

export interface SavingsRow {
  label: string;
  cells: string[];
}

export interface SavingsView {
  final: string;
  breakdown: { label: string; value: string }[];
  summary: string;
  rates: { months: string; apy: string; rate: string; earned: string }[];
  yearRows: SavingsRow[];
  monthRows: SavingsRow[];
  totals: { contributions: string; interest: string; end: string };
  chartSvg: string;
  tooltips: string[][];
}

function monthRange(from: number, to: number): string {
  return from === to ? `Month ${from}` : `Months ${formatInteger(from)} to ${formatInteger(to)}`;
}

export function savingsView(input: HysaInput, result: HysaResult, chartWidth?: number): SavingsView {
  const comp = compoundingOption(input.compounding);
  const lastMonth = result.months.length;
  const rates = result.rates.map((r, i) => {
    const to = (result.rates[i + 1]?.fromMonth ?? lastMonth + 1) - 1;
    const earned = result.months.filter((m) => m.rate === i && m.apyEarned !== null).map((m) => Number(percent2Text(m.apyEarned!)));
    const low = earned.length ? Math.min(...earned) : null;
    const high = earned.length ? Math.max(...earned) : null;
    return {
      months: monthRange(r.fromMonth, to),
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

  let depositsToDate = 0;
  let interestToDate = 0;
  const values: number[][] = [];
  const tooltips: string[][] = [];
  const yearRows = result.years.map((y) => {
    depositsToDate += y.contributions;
    interestToDate += y.interest;
    values.push([input.principal, depositsToDate, interestToDate]);
    tooltips.push([`Year ${y.year}: ${formatUSD(y.endBalance)}`, `Starting balance ${formatUSD(input.principal)}`, `Deposits to date ${formatUSD(depositsToDate)}`, `Interest to date ${formatUSD(interestToDate)}`]);
    return { label: String(y.year), cells: [formatUSD(y.startBalance), formatUSD(y.contributions), formatUSD(y.interest), formatUSD(y.endBalance)] };
  });
  const monthRows = result.months.map((m) => ({
    label: String(m.month),
    cells: [String(m.days), apyText(result.rates[m.rate]!.apy), formatUSD(m.startBalance), formatUSD(m.contributions), formatUSD(m.interest), formatUSD(m.endBalance), earnedText(m.apyEarned)],
  }));

  return {
    final: formatUSD(result.finalBalance),
    breakdown: [
      { label: 'Starting balance', value: formatUSD(input.principal) },
      { label: 'Deposits', value: formatUSD(result.totalContributions) },
      { label: 'Interest earned', value: formatUSD(result.totalInterest) },
    ],
    summary,
    rates,
    yearRows,
    monthRows,
    totals: { contributions: formatUSD(result.totalContributions), interest: formatUSD(result.totalInterest), end: formatUSD(result.finalBalance) },
    chartSvg: stackedColumnsSvg({
      categories: result.years.map((y) => String(y.year)),
      series: SAVINGS_SERIES,
      values,
      formatTick: formatUSDCompact,
      formatTotal: formatUSD,
      title: 'Savings balance at the end of each year',
      description: summary,
      idPrefix: 'sg-chart',
      ...(chartWidth ? { width: chartWidth } : {}),
    }),
    tooltips,
  };
}

export function savingsCsv(result: HysaResult): string {
  return toCsv(
    ['month', 'year', 'days', 'apy_percent', 'interest_rate_percent', 'start_balance_usd', 'deposits_usd', 'interest_usd', 'end_balance_usd', 'apy_earned_percent'],
    result.months.map((m) => {
      const rate = result.rates[m.rate]!;
      return [
        m.month,
        Math.ceil(m.month / 12),
        m.days,
        percent2Text(rate.apy * 100),
        (rate.annualRate * 100).toFixed(10),
        centsToCsv(m.startBalance),
        centsToCsv(m.contributions),
        centsToCsv(m.interest),
        centsToCsv(m.endBalance),
        m.apyEarned === null ? '' : m.apyEarned.toFixed(10),
      ];
    }),
  );
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

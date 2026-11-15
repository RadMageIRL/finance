// Everything the APR/APY page displays, derived from the engine result in one place, so the
// build-time render and the browser render show identical text.

import type { Cents } from '../engines/money';
import { percent2Text } from '../engines/money';
import type { RateAccount, RateAccountInput, RateComparison, RateKind } from '../engines/rate-compare';
import { apyFromNominal, type CompoundingFrequency } from '../engines/rates';
import type { Issue } from '../engines/validate';
import { horizontalBarsSvg } from './chart';
import { centsToCsv, toCsv } from './csv';
import { formatUSD } from './format';
import { AMOUNTS_FIELD, type Schema } from './share';

export const RATE_FREQUENCIES: readonly { value: CompoundingFrequency; label: string; period: string }[] = [
  { value: 365, label: 'Daily', period: 'day' },
  { value: 52, label: 'Weekly', period: 'week' },
  { value: 12, label: 'Monthly', period: 'month' },
  { value: 4, label: 'Quarterly', period: 'quarter' },
  { value: 2, label: 'Semiannually', period: 'half year' },
  { value: 1, label: 'Annually', period: 'year' },
];

export const rateFrequency = (n: CompoundingFrequency) => RATE_FREQUENCIES.find((f) => f.value === n)!;

export const ACCOUNT_NAMES = ['Account A', 'Account B', 'Account C'] as const;
export const ACCOUNT_LETTERS = ['A', 'B', 'C'] as const;

export interface RatesInput {
  balance: Cents;
  /** One entry per account slot; null for a slot left blank. */
  accounts: (RateAccountInput | null)[];
}

/** The example shown before any change (also the no-JavaScript view). */
export const DEFAULT_RATES: RatesInput = {
  balance: 1_000_000, // $10,000.00
  accounts: [
    { kind: 'rate', value: 0.045, periodsPerYear: 365 },
    { kind: 'apy', value: 0.0455, periodsPerYear: 12 },
    null,
  ],
};

/** A slot's controls before any input: kind and compounding for a blank account. */
export const BLANK_ACCOUNT = { kind: 'rate' as RateKind, periodsPerYear: 12 as CompoundingFrequency };

/** "4.6%" style text for a fraction, with up to `digits` decimals of a percent, trailing zeros removed. */
export function percentText(fraction: number, digits: number): string {
  const text = (fraction * 100).toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `${text}%`;
}

/** The APY as disclosed: a percent to two decimals, rounded half up (12 CFR 1030.3(f)(1)). */
export const apyText = (apy: number): string => `${percent2Text(apy * 100)}%`;

/** The interest rate: as entered, or to four decimals when derived from an APY. */
export const rateText = (a: RateAccount): string => percentText(a.annualRate, 4);

export interface AccountRow {
  name: string;
  entered: string;
  compounding: string;
  rate: string;
  periodic: string;
  apy: string;
  interest: string;
  after: string;
  best: boolean;
}

export interface RatesView {
  hero: string;
  heroNote: string;
  summary: string;
  rows: AccountRow[];
  chartSvg: string;
  tooltips: string[][];
  /** APY of the first account's interest rate at every compounding frequency. */
  byFrequency: { label: string; apy: string; current: boolean }[];
  byFrequencyRate: string;
}

const names = (indexes: readonly number[]) => indexes.map((i) => ACCOUNT_NAMES[i]!);

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

export function ratesView(result: RateComparison, chartWidth?: number): RatesView {
  const balance = formatUSD(result.balance);
  const rows: AccountRow[] = result.accounts.map((a) => {
    const f = rateFrequency(a.periodsPerYear);
    return {
      name: ACCOUNT_NAMES[a.index]!,
      entered: a.kind === 'rate' ? 'Interest rate' : 'APY',
      compounding: f.label,
      rate: rateText(a),
      periodic: `${percentText(a.periodicRate, 6)} a ${f.period}`,
      apy: apyText(a.apy),
      interest: formatUSD(a.oneYearInterest),
      after: formatUSD(result.balance + a.oneYearInterest),
      best: result.best.includes(a.index) && result.accounts.length > 1,
    };
  });

  const best = result.accounts.filter((a) => result.best.includes(a.index));
  const top = best[0]!;
  let hero: string;
  let heroNote: string;
  let summary: string;
  if (result.accounts.length === 1) {
    const f = rateFrequency(top.periodsPerYear).label.toLowerCase();
    hero = `${apyText(top.apy)} APY`;
    heroNote = `${rateText(top)} interest rate, compounded ${f}`;
    summary =
      `An interest rate of ${rateText(top)} compounded ${f} is an annual percentage yield of ${apyText(top.apy)}. ` +
      `${balance} left in the account for a year with no deposits or withdrawals earns about ${formatUSD(top.oneYearInterest)}.`;
  } else {
    const ranked = [...result.accounts].sort((x, y) => y.apy - x.apy || x.index - y.index);
    const leaders = names(result.best);
    hero = `${apyText(top.apy)} APY`;
    heroNote = leaders.length > 1 ? `${list(leaders)} tie for the highest APY` : `${leaders[0]} has the highest APY`;
    // Disclosed APYs are rounded to 0.01 point, so a lower APY can show the same figure.
    const sameShown = ranked.filter((a) => !result.best.includes(a.index) && apyText(a.apy) === apyText(top.apy)).map((a) => ACCOUNT_NAMES[a.index]!);
    if (sameShown.length) heroNote += `. ${list(sameShown)} also ${sameShown.length > 1 ? 'show' : 'shows'} ${apyText(top.apy)} once rounded, but ${sameShown.length > 1 ? 'earn' : 'earns'} a little less`;
    const others = ranked.filter((a) => !result.best.includes(a.index)).map((a) => `${formatUSD(a.oneYearInterest)} for ${ACCOUNT_NAMES[a.index]}`);
    summary =
      `On ${balance} left for a year with no deposits or withdrawals, ${list(leaders)} ${leaders.length > 1 ? 'each earn' : 'earns'} about ${formatUSD(top.oneYearInterest)}` +
      (others.length ? `, compared with ${list(others)}.` : '.') +
      ' Compare accounts by APY: it already includes compounding, so it is the one figure that puts them on the same footing.';
  }

  const first = result.accounts[0]!;
  const byFrequency = [...RATE_FREQUENCIES].reverse().map((f) => ({
    label: f.label,
    apy: apyText(apyFromNominal(first.annualRate, f.value)),
    current: f.value === first.periodsPerYear,
  }));

  return {
    hero,
    heroNote,
    summary,
    rows,
    chartSvg: horizontalBarsSvg({
      categories: rows.map((r) => r.name),
      values: result.accounts.map((a) => a.oneYearInterest),
      formatValue: formatUSD,
      title: `Interest on ${balance} in one year`,
      description: summary,
      idPrefix: 'ra-chart',
      ...(chartWidth ? { width: chartWidth } : {}),
    }),
    tooltips: result.accounts.map((_a, i) => [
      `${rows[i]!.name}: ${rows[i]!.interest}`,
      `APY ${rows[i]!.apy}`,
      `Interest rate ${rows[i]!.rate}, compounded ${rows[i]!.compounding.toLowerCase()}`,
    ]),
    byFrequency,
    byFrequencyRate: `${rateText(first)} (${ACCOUNT_NAMES[first.index]})`,
  };
}

export function ratesCsv(result: RateComparison): string {
  return toCsv(
    ['account', 'entered', 'periods_per_year', 'interest_rate_percent', 'periodic_rate_percent', 'apy_percent', 'apy_unrounded_percent', 'reference_balance_usd', 'one_year_interest_usd', 'balance_after_one_year_usd'],
    result.accounts.map((a) => [
      ACCOUNT_LETTERS[a.index]!,
      a.kind === 'rate' ? 'interest rate' : 'apy',
      a.periodsPerYear,
      (a.annualRate * 100).toFixed(10),
      ((a.annualRate / a.periodsPerYear) * 100).toFixed(10),
      percent2Text(a.apy * 100),
      (a.apy * 100).toFixed(10),
      centsToCsv(result.balance),
      centsToCsv(a.oneYearInterest),
      centsToCsv(result.balance + a.oneYearInterest),
    ]),
  );
}

const PERCENT: Schema[string] = { kind: 'decimal', min: 0, max: 100, decimals: 4 };
const KIND: Schema[string] = { kind: 'choice', values: ['rate', 'apy'] };
const FREQ: Schema[string] = { kind: 'choice', values: RATE_FREQUENCIES.map((f) => String(f.value)) };

/** Share link schema (version 1): the balance (money), each account's kind, percent and compounding. */
export const RATES_SHARE_SCHEMA: Schema = {
  b: { kind: 'int', min: 1, max: 10_000_000_000 },
  k0: KIND, v0: PERCENT, n0: FREQ,
  k1: KIND, v1: PERCENT, n1: FREQ,
  k2: KIND, v2: PERCENT, n2: FREQ,
  a: AMOUNTS_FIELD,
};

export const RATES_MONEY_KEYS = ['b'] as const;

export function ratesShareState(input: RatesInput): Record<string, number | string> {
  const state: Record<string, number | string> = { b: input.balance };
  input.accounts.forEach((a, i) => {
    if (!a) return;
    state[`k${i}`] = a.kind;
    state[`v${i}`] = percentText(a.value, 4).replace('%', '');
    state[`n${i}`] = String(a.periodsPerYear);
  });
  return state;
}

/** Plain-language message for an engine issue. */
export function ratesIssueMessage(issue: Issue): { field: string; message: string } {
  const account = /^accounts\[(\d)\]\.value$/.exec(issue.field);
  if (account) {
    const field = `value${account[1]}`;
    return { field, message: issue.code === 'above-maximum' ? 'Rates up to 100% only.' : issue.code === 'below-minimum' ? 'A rate cannot be negative.' : 'Enter the rate as a number, for example 4.5.' };
  }
  if (issue.field === 'accounts') return { field: 'value0', message: 'Enter a rate for at least one account.' };
  if (issue.field === 'balance') {
    return { field: 'balance', message: issue.code === 'above-maximum' ? 'The balance is above the largest this calculator accepts ($100,000,000).' : 'Enter a balance of at least $0.01.' };
  }
  return { field: 'value0', message: 'Check the entries for each account.' };
}

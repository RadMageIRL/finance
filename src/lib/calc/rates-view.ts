// Everything the APR/APY page displays, derived from the engine result in one place, so the
// build-time render and the browser render show identical text.

import { calendarDay } from '../engines/calendar';
import type { Cents } from '../engines/money';
import { percent2Text } from '../engines/money';
import type { RateAccount, RateAccountInput, RateComparison, RateKind } from '../engines/rate-compare';
import type { IllustrationInput, IllustrationRow } from '../engines/rate-illustration';
import { apyFromNominal, type CompoundingFrequency } from '../engines/rates';
import type { Grouping } from '../engines/schedule';
import type { Issue } from '../engines/validate';
import { REPORT_ROW_LIMIT, type Report } from '../report/report';
import { staticTable, type TableColumn, type TableSource } from '../report/table';
import { horizontalBarsSvg, linesSvg } from './chart';
import { centsToCsv, toCsv, type CsvCell } from './csv';
import { formatUSD, formatUSD4, formatUSDCompact } from './format';
import { groupingOption, MONTH_NAMES, monthName, PAGE_SIZE } from './schedule-view';
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
  /** Years the balance illustration runs (ENGINE_CONVENTIONS section 12). */
  years: number;
}

/** The example shown before any change (also the no-JavaScript view). */
export const DEFAULT_RATES: RatesInput = {
  balance: 1_000_000, // $10,000.00
  accounts: [
    { kind: 'rate', value: 0.045, periodsPerYear: 365 },
    { kind: 'apy', value: 0.0455, periodsPerYear: 12 },
    null,
  ],
  years: 5,
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
  y: { kind: 'int', min: 1, max: 30 },
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
  state.y = input.years;
  return state;
}

export const RATES_CALCULATOR = 'APR and APY calculator';

/** The page's assumptions, also printed in every report. */
export const RATES_ASSUMPTIONS: readonly string[] = [
  'Each rate stays the same for the whole time shown. Savings rates change.',
  'The interest for a year is the balance times the APY (before the APY is rounded for display), rounded once to the cent. It assumes the balance stays in the account all year with no deposits or withdrawals, the same assumption the APY itself makes. A bank rounds each interest payment, so its total can differ by a cent or two.',
  'A year has 365 days. Weekly compounding means 52 times a year.',
  'Balance illustration: a single deposit of the balance above on the first day, then no deposits or withdrawals for the years shown.',
  'In the illustration each account adds its rate per period (the interest rate divided by the compounding periods in a year) at the end of each compounding period, on the calendar the other calculators use: 365-day years from January 1, real month lengths, quarters from January, April, July and October, and 52 weeks a year with the last week of each year 8 days long.',
  'In the illustration interest is not rounded to the cent, so after each full year the balance is exactly the deposit grown by the APY; balances are shown rounded to the cent. A balance includes interest only for compounding periods that have ended.',
  'No fees, minimum balances, balance tiers or introductory rates, and no taxes.',
];

export const RATES_SOURCES: readonly string[] = [
  '12 CFR part 1030 (Regulation DD, Truth in Savings), sections 1030.1, 1030.2, 1030.3 and appendix A. Electronic Code of Federal Regulations, text as of November 1, 2026, verified November 16, 2026.',
  '12 CFR part 1026 (Regulation Z, Truth in Lending), sections 1026.2, 1026.4, 1026.18 and 1026.22 and appendix J. Electronic Code of Federal Regulations, text as of November 1, 2026, verified November 16, 2026.',
  '12 CFR part 707 (National Credit Union Administration, Truth in Savings), section 707.1. Code of Federal Regulations, revised as of January 1, 2025, verified November 16, 2026.',
];

/** What the illustration's rows mean, shown with the table and in the report. */
export function illustrationNotes(): string[] {
  return [
    'Balances come from a single deposit of the balance above, with no further deposits or withdrawals. Interest is added at the end of each compounding period and is not rounded; balances are shown rounded to the cent, so each row adds up to the cent.',
    'A balance includes interest only for compounding periods that have ended, so an account that compounds less often steps up less often. After each full year every account has grown by exactly its APY.',
  ];
}

/** The illustration's input: the comparison's balance and accounts, over the chosen years. */
export function illustrationInput(comparison: RateComparison, years: number): IllustrationInput {
  return {
    deposit: comparison.balance,
    years,
    accounts: comparison.accounts.map((a) => ({ annualRate: a.annualRate, periodsPerYear: a.periodsPerYear })),
  };
}

/** "Mar 5, year 2", "Mar, year 2" or "Year 2" for a row of the illustration. */
function illustrationLabel(grouping: Grouping, row: IllustrationRow): string {
  if (grouping === 'year') return `Year ${row.index}`;
  if (grouping === 'month') return monthName(row.index);
  const c = calendarDay(row.end - 1);
  return `${MONTH_NAMES[c.month - 1]!} ${c.dayOfMonth}, year ${c.year}`;
}

const ILLUSTRATION_PERIOD_CSV: Readonly<Record<Grouping, readonly string[]>> = { day: ['day', 'year', 'month', 'day_of_month'], month: ['month', 'year', 'month_of_year'], year: ['year'] };

/**
 * Months of the illustration with each account's opening balance, interest accrued, interest
 * credited and closing balance (ENGINE_CONVENTIONS 12.5), and with two or three accounts each
 * later account's closing balance minus the first's. `from` and `to` are 0-based month
 * indexes into `months` (every month of the term); a footer, when given, totals the rows.
 */
function illustrationMonths(comparison: RateComparison, months: readonly IllustrationRow[], from: number, to: number, caption: string, footerHead: string | null): TableSource {
  const deposit = comparison.balance;
  const names = comparison.accounts.map((a) => ACCOUNT_NAMES[a.index]!);
  const letters = comparison.accounts.map((a) => ACCOUNT_LETTERS[a.index]!.toLowerCase());
  const opening = (i: number, a: number) => (i === 0 ? deposit : months[i - 1]!.shown[a]!);
  const columns: TableColumn[] = [{ label: 'Month', numeric: false }];
  names.forEach((name) =>
    columns.push(
      { label: `${name} opening balance`, numeric: true },
      { label: `${name} interest accrued`, numeric: true },
      { label: `${name} interest credited`, numeric: true },
      { label: `${name} closing balance`, numeric: true },
    ),
  );
  names.slice(1).forEach((name) => columns.push({ label: `${name} minus ${names[0]}`, numeric: true }));
  const csvHeader: string[] = ['month', 'year', 'month_of_year'];
  letters.forEach((l) => csvHeader.push(`${l}_opening_usd`, `${l}_interest_accrued_usd`, `${l}_interest_credited_usd`, `${l}_closing_usd`));
  letters.slice(1).forEach((l) => csvHeader.push(`${l}_minus_${letters[0]}_usd`));
  const cells = (i: number) => {
    const r = months[i]!;
    return [
      ...r.shown.flatMap((closing, a) => [formatUSD(opening(i, a)), formatUSD4(r.accrued[a]!), formatUSD(closing - opening(i, a)), formatUSD(closing)]),
      ...r.shown.slice(1).map((closing) => formatUSD(closing - r.shown[0]!)),
    ];
  };
  const count = to - from;
  const accounts = comparison.accounts.map((_a, a) => a);
  const sum = (pick: (r: IllustrationRow, i: number) => number) => {
    let total = 0;
    for (let i = from; i < to; i += 1) total += pick(months[i]!, i);
    return total;
  };
  const last = months[to - 1]!;
  return {
    caption,
    columns,
    count,
    row: (k) => ({ head: monthName(months[from + k]!.index), cells: cells(from + k) }),
    csvHeader,
    csvRow: (k) => {
      const i = from + k;
      const r = months[i]!;
      const c = calendarDay(r.end - 1);
      return [
        r.index, c.year, c.month,
        ...r.shown.flatMap((closing, a) => [centsToCsv(opening(i, a)), (r.accrued[a]! / 100).toFixed(6), centsToCsv(closing - opening(i, a)), centsToCsv(closing)]),
        ...r.shown.slice(1).map((closing) => centsToCsv(closing - r.shown[0]!)),
      ];
    },
    pageSize: PAGE_SIZE.month,
    pageLabel: (page) => `Years ${page * 10 + 1} to ${Math.min(page * 10 + 10, Math.ceil(count / 12))}`,
    ...(footerHead
      ? {
          footer: {
            head: footerHead,
            cells: [
              ...accounts.flatMap((a) => [formatUSD(opening(from, a)), formatUSD4(sum((r) => r.accrued[a]!)), formatUSD(sum((r, i) => r.shown[a]! - opening(i, a))), formatUSD(last.shown[a]!)]),
              ...accounts.slice(1).map((a) => formatUSD(last.shown[a]! - last.shown[0]!)),
            ],
          },
        }
      : {}),
  };
}

/** Every month of the illustration with the detail columns: the CSV when months are included. */
export function illustrationMonthsAll(comparison: RateComparison, months: readonly IllustrationRow[]): TableSource {
  return illustrationMonths(comparison, months, 0, months.length, `Schedule by month: each account's interest accrued and credited from a single deposit of ${formatUSD(comparison.balance)}`, null);
}

/** The months of year `year` (1-based) under its row (ENGINE_CONVENTIONS 12.5 and 14). */
export function illustrationYearMonths(comparison: RateComparison, months: readonly IllustrationRow[], year: number): TableSource {
  return illustrationMonths(comparison, months, 12 * (year - 1), 12 * year, `Year ${year} by month: each account's opening balance, interest accrued and credited, and closing balance`, `Year ${year} total`);
}

/** The illustration as a table: each account's balance and interest to date at the end of each row. */
export function illustrationTable(comparison: RateComparison, rows: readonly IllustrationRow[], grouping: Grouping, months?: readonly IllustrationRow[]): TableSource {
  const deposit = comparison.balance;
  const names = comparison.accounts.map((a) => ACCOUNT_NAMES[a.index]!);
  const letters = comparison.accounts.map((a) => ACCOUNT_LETTERS[a.index]!.toLowerCase());
  const columns: TableColumn[] = [{ label: groupingOption(grouping).label, numeric: false }];
  names.forEach((name) => columns.push({ label: `${name} balance`, numeric: true }, { label: `${name} interest to date`, numeric: true }));
  const csvHeader = [...ILLUSTRATION_PERIOD_CSV[grouping]];
  letters.forEach((l) => csvHeader.push(`${l}_periods_completed`, `${l}_balance_usd`, `${l}_interest_in_period_usd`, `${l}_interest_to_date_usd`, `${l}_balance_unrounded_usd`));
  const years = rows.length ? Math.ceil(rows[rows.length - 1]!.end / 365) : 0;
  return {
    caption: `${groupingOption(grouping).heading}: each account's balance from a single deposit of ${formatUSD(deposit)}`,
    columns,
    count: rows.length,
    row: (i) => {
      const r = rows[i]!;
      return { head: illustrationLabel(grouping, r), cells: r.shown.flatMap((shown) => [formatUSD(shown), formatUSD(shown - deposit)]) };
    },
    csvHeader,
    csvRow: (i) => {
      const r = rows[i]!;
      const c = calendarDay(r.end - 1);
      const period: CsvCell[] = grouping === 'day' ? [r.index, c.year, c.month, c.dayOfMonth] : grouping === 'month' ? [r.index, c.year, c.month] : [r.index];
      const before = rows[i - 1]?.shown;
      return [
        ...period,
        ...r.shown.flatMap((shown, a) => [r.periods[a]!, centsToCsv(shown), centsToCsv(shown - (before?.[a] ?? deposit)), centsToCsv(shown - deposit), (r.balances[a]! / 100).toFixed(6)]),
      ];
    },
    pageSize: PAGE_SIZE[grouping],
    pageLabel: (page) => (grouping === 'day' ? `Year ${page + 1}` : grouping === 'month' ? `Years ${page * 10 + 1} to ${Math.min(page * 10 + 10, years)}` : 'All years'),
    ...(grouping === 'year' && months
      ? { detail: { table: (i: number) => illustrationYearMonths(comparison, months, i + 1), all: () => illustrationMonthsAll(comparison, months), noun: 'months' } }
      : {}),
  };
}

/** Interest to date on each account at the end of each row, as lines with labeled ends. */
export function illustrationChartSvg(comparison: RateComparison, rows: readonly IllustrationRow[], grouping: Grouping, options: { idPrefix?: string; width?: number } = {}): string {
  const deposit = comparison.balance;
  const series = comparison.accounts.map((a) => ({ key: ACCOUNT_LETTERS[a.index]!, label: ACCOUNT_NAMES[a.index]! }));
  const xLabels: { index: number; label: string }[] = [];
  rows.forEach((r, i) => {
    if (r.end % 365 === 0) xLabels.push({ index: i, label: String(r.end / 365) });
  });
  if (xLabels.length < 2 && grouping !== 'year') {
    xLabels.length = 0;
    rows.forEach((r, i) => {
      const c = calendarDay(r.end - 1);
      if (calendarDay(r.end).month !== c.month && (grouping === 'month' || c.month % 3 === 0)) xLabels.push({ index: i, label: MONTH_NAMES[c.month - 1]! });
    });
  }
  return linesSvg({
    count: rows.length,
    series,
    values: (i) => rows[i]!.shown.map((s) => s - deposit),
    xLabels,
    formatTick: formatUSDCompact,
    formatTotal: formatUSD,
    title: `Interest earned to date on ${formatUSD(deposit)}, by ${groupingOption(grouping).noun}`,
    description: `Interest earned to date on a single deposit of ${formatUSD(deposit)} in each account, with no deposits or withdrawals.`,
    idPrefix: options.idPrefix ?? 'ra-ill-chart',
    ...(options.width ? { width: options.width } : {}),
  });
}

export function illustrationTooltip(comparison: RateComparison, rows: readonly IllustrationRow[], grouping: Grouping, index: number): string[] {
  const r = rows[index];
  if (!r) return [];
  return [illustrationLabel(grouping, r), ...comparison.accounts.map((a, j) => `${ACCOUNT_NAMES[a.index]}: ${formatUSD(r.shown[j]!)}, interest ${formatUSD(r.shown[j]! - comparison.balance)}`)];
}

/** The account comparison as a short table for the report. */
export function comparisonTable(result: RateComparison): TableSource {
  const view = ratesView(result);
  const columns: TableColumn[] = ['Account', 'Entered as', 'Compounding', 'Interest rate', 'Rate per period', 'APY', 'Interest in a year', 'Balance after a year'].map((label, i) => ({ label, numeric: i >= 3 }));
  return staticTable({
    caption: `Rates and one year's interest on ${formatUSD(result.balance)} for each account`,
    columns,
    rows: view.rows.map((r) => ({ head: r.name, cells: [r.entered, r.compounding, r.rate, r.periodic, r.apy, r.interest, r.after], ...(r.best ? { note: 'Highest APY' } : {}) })),
  });
}

export function ratesInputs(input: RatesInput, result: RateComparison): { label: string; value: string }[] {
  const out = [{ label: 'Balance to compare', value: formatUSD(input.balance) }];
  for (const a of result.accounts) {
    const entered = input.accounts[a.index]!;
    out.push({ label: `${ACCOUNT_NAMES[a.index]}`, value: `${entered.kind === 'rate' ? 'Interest rate' : 'APY'} ${percentText(entered.value, 4)}, compounded ${rateFrequency(a.periodsPerYear).label.toLowerCase()}` });
  }
  out.push({ label: 'Years illustrated', value: String(input.years) });
  return out;
}

/** "Balance illustration by day" and so on, the report heading for a grouping. */
const illustrationHeading = (g: Grouping) => `Balance illustration ${groupingOption(g).heading.replace('Schedule ', '')}`;

/**
 * The report: the comparison, then the balance illustration at the chosen grouping (by
 * month instead when a daily illustration is too long to print). `rowsFor` gives the
 * illustration rows for a grouping.
 */
export function ratesReport(input: RatesInput, result: RateComparison, rowsFor: (g: Grouping) => readonly IllustrationRow[], chosen: Grouping, generated: Date): Report {
  const view = ratesView(result);
  const long = chosen === 'day' && rowsFor('day').length > REPORT_ROW_LIMIT;
  const grouping: Grouping = long ? 'month' : chosen;
  const rows = rowsFor(grouping);
  const notes = [
    ...(long ? [`The illustration by day has ${rowsFor('day').length.toLocaleString('en-US')} rows, too many for a readable report, so this report shows it by month. Download the CSV for every row.`] : []),
    ...illustrationNotes(),
  ];
  return {
    calculator: RATES_CALCULATOR,
    generated,
    headline: { label: result.accounts.length > 1 ? 'Highest APY' : 'APY', value: view.hero },
    summary: [{ label: 'Note', value: view.heroNote }, ...view.rows.map((r) => ({ label: `${r.name} APY`, value: `${r.apy}, ${r.interest} in a year` }))],
    sentence: view.summary,
    inputs: ratesInputs(input, result),
    composition: null,
    rateChanges: null,
    tables: [{ heading: 'Accounts compared', table: comparisonTable(result) }],
    chart: {
      heading: `Interest earned to date, by ${groupingOption(grouping).noun}`,
      svg: illustrationChartSvg(result, rows, grouping, { idPrefix: 'report-chart', width: 720 }),
      legend: result.accounts.map((a) => ACCOUNT_NAMES[a.index]!),
      summary: `Interest earned to date on a single deposit of ${formatUSD(result.balance)} in each account over ${input.years} ${input.years === 1 ? 'year' : 'years'}. Each line is labeled at its end; the table below has every figure.`,
    },
    schedule: {
      heading: illustrationHeading(grouping),
      table: illustrationTable(result, rows, grouping, rowsFor('month')),
      notes,
      ...(long ? { fallbackFrom: { heading: illustrationHeading('day'), rows: rowsFor('day').length } } : {}),
    },
    assumptions: RATES_ASSUMPTIONS,
    sources: RATES_SOURCES,
  };
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

// Schedule tables and charts by day, month or year, shared by the compound interest and
// savings calculators. Every figure comes from the engine's schedule rows
// (src/lib/engines/schedule.ts); this file only labels and formats them. The same table
// source feeds the page, the CSV, the HTML report and the print view.

import { calendarDay } from '../engines/calendar';
import type { Grouping, Schedule, ScheduleRow } from '../engines/schedule';
import { stackedAreaSvg, stackedColumnsSvg, type StackSeries } from './chart';
import { centsToCsv, type CsvCell } from './csv';
import { formatUSD, formatUSD4, formatUSDCompact } from './format';
import type { TableColumn, TableSource } from '../report/table';

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export const GROUPING_OPTIONS: readonly { value: Grouping; label: string; noun: string; heading: string }[] = [
  { value: 'day', label: 'Day', noun: 'day', heading: 'Schedule by day' },
  { value: 'month', label: 'Month', noun: 'month', heading: 'Schedule by month' },
  { value: 'year', label: 'Year', noun: 'year', heading: 'Schedule by year' },
];

export const groupingOption = (g: Grouping) => GROUPING_OPTIONS.find((o) => o.value === g)!;

/** Rows per page in the live table: a year of days, ten years of months, every year. */
export const PAGE_SIZE: Readonly<Record<Grouping, number>> = { day: 365, month: 120, year: 100 };

/** "Mar 5, year 2", "Mar, year 2" or "Year 2" (the standardized calendar of conventions 5.1). */
export function periodLabel(grouping: Grouping, row: ScheduleRow): string {
  if (grouping === 'year') return `Year ${row.index}`;
  const c = calendarDay(row.firstDay);
  const month = MONTH_NAMES[c.month - 1]!;
  return grouping === 'day' ? `${month} ${c.dayOfMonth}, year ${c.year}` : `${month}, year ${c.year}`;
}

/** "Jan, year 2" for a month of the term (1-based). */
export function monthName(termMonth: number): string {
  return `${MONTH_NAMES[(termMonth - 1) % 12]!}, year ${Math.ceil(termMonth / 12)}`;
}

export interface ScheduleRates {
  /** Column header: "Rate" or "APY". */
  label: string;
  text: (row: ScheduleRow) => string;
  /** A marker for the first row of a new rate, for example "New APY". */
  note?: (row: ScheduleRow, previous: ScheduleRow | undefined) => string | undefined;
  csvHeader: (grouping: Grouping) => readonly string[];
  csv: (row: ScheduleRow, grouping: Grouping) => readonly CsvCell[];
}

export interface ScheduleConfig {
  /** "Contributions" or "Deposits". */
  depositsLabel: string;
  rates: ScheduleRates;
  /** One more column for month rows only (APY earned). */
  monthExtra?: { label: string; csv: string; text: (row: ScheduleRow) => string; csvValue: (row: ScheduleRow) => CsvCell };
}

/** Unrounded cents as dollars to six decimals for CSV: interest accrued. */
const accruedCsv = (cents: number) => (cents / 100).toFixed(6);

const PERIOD_CSV: Readonly<Record<Grouping, readonly string[]>> = {
  day: ['day', 'year', 'month', 'day_of_month'],
  month: ['month', 'year', 'month_of_year', 'days'],
  year: ['year', 'days'],
};

function periodCsv(grouping: Grouping, row: ScheduleRow): CsvCell[] {
  const c = calendarDay(row.firstDay);
  if (grouping === 'day') return [row.index, c.year, c.month, c.dayOfMonth];
  if (grouping === 'month') return [row.index, c.year, c.month, row.lastDay - row.firstDay + 1];
  return [row.index, row.lastDay - row.firstDay + 1];
}

/**
 * The months of year `year` (1-based) as their own table, for the expandable year rows
 * (ENGINE_CONVENTIONS section 14). The rows are the engine's month rows; the footer totals
 * them, so it reconciles with the year's row: deposits and credited add up exactly, and the
 * year's accrued interest is by definition the sum of its months' in month order (11.3).
 */
export function yearMonthsTable(schedule: Schedule, year: number, config: ScheduleConfig): TableSource {
  const months = schedule.rows('month').slice(12 * (year - 1), 12 * year);
  const full = scheduleTable(schedule, 'month', config);
  const offset = 12 * (year - 1);
  const first = months[0]!;
  const last = months[months.length - 1]!;
  const extra = config.monthExtra;
  const deposits = months.reduce((sum, m) => sum + m.deposits, 0);
  const accrued = months.reduce((sum, m) => sum + m.accrued, 0);
  const credited = months.reduce((sum, m) => sum + m.credited, 0);
  return {
    ...full,
    caption: `Year ${year} by month: balances, ${config.depositsLabel.toLowerCase()}, interest accrued and credited`,
    count: months.length,
    row: (i) => full.row(offset + i),
    csvRow: (i) => full.csvRow(offset + i),
    pageSize: Math.max(1, months.length),
    pageLabel: () => `Year ${year}`,
    footer: {
      head: `Year ${year} total`,
      cells: [formatUSD(first.opening), formatUSD(deposits), formatUSD4(accrued), formatUSD(credited), '', formatUSD(last.closing), formatUSD(last.cumulativeInterest), ...(extra ? [''] : [])],
    },
  };
}

export function scheduleTable(schedule: Schedule, grouping: Grouping, config: ScheduleConfig): TableSource {
  const rows = schedule.rows(grouping);
  const extra = grouping === 'month' ? config.monthExtra : undefined;
  const option = groupingOption(grouping);
  const detail: TableSource['detail'] =
    grouping === 'year'
      ? { table: (i) => yearMonthsTable(schedule, i + 1, config), all: () => scheduleTable(schedule, 'month', config), noun: 'months' }
      : undefined;
  // Compact view: what went in, the interest credited (the interest that became part of the
  // balance) and the balance; the opening balance plus these reconciles each row.
  const columns: TableColumn[] = [
    { label: option.label, numeric: false },
    { label: 'Opening balance', numeric: true },
    { label: config.depositsLabel, numeric: true, key: 1 },
    { label: 'Interest accrued', numeric: true },
    { label: 'Interest credited', numeric: true, key: 2 },
    { label: config.rates.label, numeric: true },
    { label: 'Closing balance', numeric: true, key: 3 },
    { label: 'Cumulative interest', numeric: true },
    ...(extra ? [{ label: extra.label, numeric: true }] : []),
  ];
  const years = schedule.years;
  const totalDeposits = years.reduce((sum, y) => sum + y.deposits, 0);
  const totalAccrued = years.reduce((sum, y) => sum + y.accrued, 0);
  const totalCredited = years.reduce((sum, y) => sum + y.credited, 0);
  const last = years[years.length - 1]!;
  const depositsKey = config.depositsLabel.toLowerCase();
  return {
    caption: `${option.heading}: balances, ${depositsKey}, interest accrued and credited`,
    columns,
    count: rows.length,
    row: (i) => {
      const r = rows[i]!;
      const note = config.rates.note?.(r, rows[i - 1]);
      return {
        head: periodLabel(grouping, r),
        cells: [
          formatUSD(r.opening),
          formatUSD(r.deposits),
          formatUSD4(r.accrued),
          formatUSD(r.credited),
          config.rates.text(r),
          formatUSD(r.closing),
          formatUSD(r.cumulativeInterest),
          ...(extra ? [extra.text(r)] : []),
        ],
        ...(note ? { note } : {}),
      };
    },
    csvHeader: [
      ...PERIOD_CSV[grouping],
      'opening_balance_usd',
      `${depositsKey}_usd`,
      'interest_accrued_usd',
      'interest_credited_usd',
      ...config.rates.csvHeader(grouping),
      'closing_balance_usd',
      'cumulative_interest_usd',
      ...(extra ? [extra.csv] : []),
    ],
    csvRow: (i) => {
      const r = rows[i]!;
      return [
        ...periodCsv(grouping, r),
        centsToCsv(r.opening),
        centsToCsv(r.deposits),
        accruedCsv(r.accrued),
        centsToCsv(r.credited),
        ...config.rates.csv(r, grouping),
        centsToCsv(r.closing),
        centsToCsv(r.cumulativeInterest),
        ...(extra ? [extra.csvValue(r)] : []),
      ];
    },
    pageSize: PAGE_SIZE[grouping],
    pageLabel: (page) => {
      if (grouping === 'day') return `Year ${page + 1}`;
      if (grouping === 'month') return `Years ${page * 10 + 1} to ${Math.min(page * 10 + 10, years.length)}`;
      return 'All years';
    },
    footer: {
      head: 'Total',
      cells: ['', formatUSD(totalDeposits), formatUSD4(totalAccrued), formatUSD(totalCredited), '', formatUSD(last.closing), formatUSD(last.cumulativeInterest), ...(extra ? [''] : [])],
    },
    ...(detail ? { detail } : {}),
  };
}

export interface ScheduleChartSpec {
  principal: number;
  series: readonly StackSeries[];
  depositsLabel: string;
  title: string;
  description: string;
  idPrefix: string;
  width?: number;
}

/** Starting balance, deposits to date and interest to date at the end of a row. */
export function stackValues(principal: number, row: ScheduleRow): [number, number, number] {
  return [principal, row.closing - principal - row.cumulativeInterest, row.cumulativeInterest];
}

/** Year end positions for the x axis of a month or day chart, labeled with the year. */
function yearLabels(rows: readonly ScheduleRow[], grouping: Grouping): { index: number; label: string }[] {
  if (rows.length && grouping !== 'year' && rows[rows.length - 1]!.lastDay < 365) {
    // A one-year term: label the month ends instead.
    const out: { index: number; label: string }[] = [];
    rows.forEach((r, i) => {
      const c = calendarDay(r.lastDay);
      if (calendarDay(r.lastDay + 1).month !== c.month || i === rows.length - 1) out.push({ index: i, label: MONTH_NAMES[c.month - 1]! });
    });
    return grouping === 'month' ? out : out.filter((_l, k) => k % 3 === 2);
  }
  const out: { index: number; label: string }[] = [];
  rows.forEach((r, i) => {
    if ((r.lastDay + 1) % 365 === 0) out.push({ index: i, label: String((r.lastDay + 1) / 365) });
  });
  return out;
}

/** The chart for a grouping: columns for years, stacked areas for months and days. */
export function scheduleChartSvg(schedule: Schedule, grouping: Grouping, spec: ScheduleChartSpec): string {
  const rows = schedule.rows(grouping);
  const common = {
    series: spec.series,
    formatTick: formatUSDCompact,
    formatTotal: formatUSD,
    title: spec.title,
    description: spec.description,
    idPrefix: spec.idPrefix,
    ...(spec.width ? { width: spec.width } : {}),
  };
  if (grouping === 'year') {
    return stackedColumnsSvg({ ...common, categories: rows.map((r) => String(r.index)), values: rows.map((r) => stackValues(spec.principal, r)) });
  }
  return stackedAreaSvg({ ...common, count: rows.length, values: (i) => stackValues(spec.principal, rows[i]!), xLabels: yearLabels(rows, grouping) });
}

/** Tooltip lines for one row of a chart. */
export function scheduleTooltip(schedule: Schedule, grouping: Grouping, principal: number, depositsLabel: string, index: number): string[] {
  const row = schedule.rows(grouping)[index];
  if (!row) return [];
  const [, deposits, interest] = stackValues(principal, row);
  return [`${periodLabel(grouping, row)}: ${formatUSD(row.closing)}`, `Starting balance ${formatUSD(principal)}`, `${depositsLabel} to date ${formatUSD(deposits)}`, `Interest to date ${formatUSD(interest)}`];
}

/** How the final balance splits: starting balance, what was added, interest, with shares. */
export function composition(principal: number, deposits: number, interest: number, depositsLabel: string): { label: string; value: string; share: string }[] | null {
  const total = principal + deposits + interest;
  if (total <= 0) return null;
  const share = (part: number) => `${((part / total) * 100).toFixed(1)}%`;
  return [
    { label: 'Starting balance', value: formatUSD(principal), share: share(principal) },
    { label: depositsLabel, value: formatUSD(deposits), share: share(deposits) },
    { label: 'Interest', value: formatUSD(interest), share: share(interest) },
    { label: 'Final balance', value: formatUSD(total), share: '100.0%' },
  ];
}


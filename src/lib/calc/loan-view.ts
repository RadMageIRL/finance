// Everything the loan amortization and mortgage payoff pages display, derived from the
// engine results in one place, so the build-time render, the browser render, the CSV and the
// report show identical figures. Loans are reported by payment month and by calendar year
// (ENGINE_CONVENTIONS section 13); a day view would mean nothing, since interest is figured
// monthly.

import { LOAN_LIMITS, type LoanInput } from '../engines/loan';
import { paymentDate, type HousingCosts, type LoanMonthRow, type LoanPlan, type LoanYearRow, type PaymentBreakdown, type PaymentDate, type PayoffComparison } from '../engines/loan-report';
import type { Grouping } from '../engines/schedule';
import type { Issue } from '../engines/validate';
import type { Report } from '../report/report';
import { staticTable, type TableColumn, type TableSource } from '../report/table';
import { linesSvg, stackedAreaSvg, stackedColumnsSvg } from './chart';
import { centsToCsv, type CsvCell } from './csv';
import { formatInteger, formatRate, formatUSD, formatUSDCompact } from './format';
import { MONTH_NAMES } from './schedule-view';
import { AMOUNTS_FIELD, type Schema } from './share';

export type LoanGrouping = Extract<Grouping, 'month' | 'year'>;
export const LOAN_GROUPINGS: readonly { value: LoanGrouping; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

export const LOAN_SERIES = [
  { key: 'principal', label: 'Principal' },
  { key: 'interest', label: 'Interest' },
] as const;

export const PAYOFF_SERIES = [
  { key: 'baseline', label: 'Without extra payments' },
  { key: 'accelerated', label: 'With extra payments' },
] as const;

export const TERM_UNITS = [
  { value: 'years', label: 'Years' },
  { value: 'months', label: 'Months' },
] as const;
export type TermUnit = (typeof TERM_UNITS)[number]['value'];

export const AMORTIZATION_CALCULATOR = 'Loan amortization calculator';
export const PAYOFF_CALCULATOR = 'Mortgage payoff calculator';

/** The month after `today`: the default first payment. */
export function nextMonth(today: Date): PaymentDate {
  return paymentDate({ year: today.getFullYear(), month: today.getMonth() + 1 }, 2);
}

export const dateLabel = (d: PaymentDate): string => `${MONTH_NAMES[d.month - 1]} ${d.year}`;

/** "7 years 4 months", "11 months", "1 year". */
export function durationText(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(`${formatInteger(y)} ${y === 1 ? 'year' : 'years'}`);
  if (m || !y) parts.push(`${m} ${m === 1 ? 'month' : 'months'}`);
  return parts.join(' ');
}

export const LOAN_ASSUMPTIONS: readonly string[] = [
  'Each month the loan charges one twelfth of the interest rate on the balance, whatever the length of the month, and the interest is rounded to the nearest cent, half a cent rounding up.',
  'Many loans figure interest by the day instead. On auto loans, simple interest is "far more common," and the CFPB says it "calculates the interest based on the outstanding balance of the loan either on a daily or monthly basis." Where interest is figured daily, paying before or after the due date changes the interest a little; this calculator does not model that.',
  'The monthly payment of principal and interest is rounded to the cent. The last payment is the remaining balance plus that month\'s interest, so it can differ from the others: usually by a little, and by more when extra payments end the loan early.',
  'The interest rate is the note rate, fixed for the whole loan. It is not the loan\'s APR, which also counts certain fees.',
  'Payments are made on time, in full, once a month, starting in the month you choose. Dates only label the payments; they do not change the interest.',
  'No late fees, prepayment penalties, rate changes or loan modifications. A real loan\'s terms may include a prepayment penalty or other restrictions on paying early. The CFPB says a prepayment penalty is "a fee that some lenders charge if you pay off all or part of your mortgage early" and that "not all mortgages have a prepayment penalty"; check your loan documents.',
];

export const PAYOFF_ASSUMPTIONS: readonly string[] = [
  ...LOAN_ASSUMPTIONS,
  'For a loan you already have, the payment is worked out from today\'s balance, the interest rate and the time left, so it can differ a little from the payment on your statement.',
  'Extra payments go entirely to principal, applied right after that month\'s regular payment. A one-time payment is applied in the month you give it. Servicers handle extra payments in different ways; check how yours applies them.',
  'An extra payment is never more than the balance left; once the loan is paid off, later extra payments are not made.',
  'The regular payment stays the same after extra payments, so they end the loan sooner instead of lowering the payment.',
  'Property tax, homeowners insurance, mortgage insurance and HOA dues stay the same every month and never enter the loan\'s balance. In real life they change, and mortgage insurance can end before the loan does; this calculator does not model when it ends.',
];

export const LOAN_SOURCES: readonly string[] = [
  'Consumer Financial Protection Bureau, "On a mortgage, what\'s the difference between my principal and interest payment and my total monthly payment?" (last reviewed August 28, 2023), consumerfinance.gov/ask-cfpb/on-a-mortgage-whats-the-difference-between-my-principal-and-interest-payment-and-my-total-monthly-payment-en-1941/.',
  'Consumer Financial Protection Bureau, "How does paying down a mortgage work?" (last reviewed May 28, 2024), consumerfinance.gov/ask-cfpb/how-does-paying-down-a-mortgage-work-en-1943/.',
  'Consumer Financial Protection Bureau, "What\'s the difference between a simple interest rate and precomputed interest on an auto loan?" (last reviewed January 30, 2024), consumerfinance.gov/ask-cfpb/whats-the-difference-between-a-simple-interest-rate-and-precomputed-interest-on-an-auto-loan-en-841/.',
  'Consumer Financial Protection Bureau, "What is a prepayment penalty?" (last reviewed September 11, 2024), consumerfinance.gov/ask-cfpb/what-is-a-prepayment-penalty-en-1957/.',
  '12 CFR part 1026 (Regulation Z, Truth in Lending), sections 1026.4 and 1026.22 and appendix J, on the finance charge and the loan APR. Electronic Code of Federal Regulations, text as of November 1, 2026, verified November 15, 2026.',
];

export interface LoanView {
  payment: string;
  breakdown: { label: string; value: string }[];
  payoff: string;
  summary: string;
}

export function loanView(input: LoanInput, plan: LoanPlan): LoanView {
  const s = plan.schedule;
  const payoff = dateLabel(plan.payoff);
  const first = dateLabel(plan.months[0]!.date);
  return {
    payment: formatUSD(s.payment),
    breakdown: [
      { label: 'Loan amount', value: formatUSD(input.principal) },
      { label: 'Total interest', value: formatUSD(s.totalInterest) },
      { label: 'Total paid (principal and interest)', value: formatUSD(s.totalPaid) },
      { label: 'Number of payments', value: formatInteger(s.months) },
    ],
    payoff,
    summary:
      `Borrowing ${formatUSD(input.principal)} at ${formatRate(input.annualRate)} for ${durationText(input.termMonths)} costs ${formatUSD(s.payment)} a month in principal and interest, ` +
      `${formatInteger(s.months)} payments from ${first} to ${payoff}. Over the loan you pay ${formatUSD(s.totalInterest)} in interest, ${formatUSD(s.totalPaid)} in all.`,
  };
}

export interface PayoffView {
  hero: string;
  heroNote: string;
  rows: { label: string; baseline: string; accelerated: string }[];
  summary: string;
}

export function payoffView(c: PayoffComparison): PayoffView {
  const a = c.accelerated.schedule;
  const b = c.baseline.schedule;
  const extras = c.monthsSaved > 0 || c.interestSaved > 0;
  const summary = extras
    ? `With the extra payments the loan is paid off in ${dateLabel(c.accelerated.payoff)} instead of ${dateLabel(c.baseline.payoff)}, ${durationText(c.monthsSaved)} sooner, and costs ${formatUSD(c.interestSaved)} less in interest (${formatUSD(a.totalInterest)} instead of ${formatUSD(b.totalInterest)}).`
    : `Without extra payments the loan is paid off in ${dateLabel(c.baseline.payoff)} after ${formatInteger(b.months)} payments, with ${formatUSD(b.totalInterest)} in interest. Add an extra monthly or one-time payment to see what it saves.`;
  return {
    hero: formatUSD(c.interestSaved),
    heroNote: extras ? `less interest, paid off ${durationText(c.monthsSaved)} sooner` : 'saved: no extra payments entered yet',
    rows: [
      { label: 'Payoff date', baseline: dateLabel(c.baseline.payoff), accelerated: dateLabel(c.accelerated.payoff) },
      { label: 'Number of payments', baseline: formatInteger(b.months), accelerated: formatInteger(a.months) },
      { label: 'Total interest', baseline: formatUSD(b.totalInterest), accelerated: formatUSD(a.totalInterest) },
      { label: 'Total paid (principal and interest)', baseline: formatUSD(b.totalPaid), accelerated: formatUSD(a.totalPaid) },
    ],
    summary,
  };
}

export type BreakdownKey = 'pi' | 'tax' | 'insurance' | 'escrow' | 'mi' | 'mortgage' | 'hoa' | 'total';

export interface BreakdownLine {
  key: BreakdownKey;
  label: string;
  /** The label in a flat list such as the report table, where the group heading is not shown. */
  reportLabel: string;
  value: string;
  kind: 'item' | 'subtotal' | 'total';
}

export interface BreakdownGroup {
  heading: string | null;
  lines: BreakdownLine[];
}

export const ESCROW_GROUP = 'Escrow items, assumed to be collected with the mortgage payment';
export const HOA_GROUP = 'Not part of the mortgage payment: usually paid to the association';

/**
 * The first month's housing costs in display order (conventions 13.5, v1.6): principal and
 * interest, the escrow items and their subtotal, mortgage insurance, the mortgage payment,
 * then HOA dues outside it and the estimated total housing cost.
 */
export function breakdownGroups(b: PaymentBreakdown): BreakdownGroup[] {
  const line = (key: BreakdownKey, label: string, value: number, kind: BreakdownLine['kind'] = 'item', reportLabel = label): BreakdownLine => ({
    key,
    label,
    reportLabel,
    value: formatUSD(value),
    kind,
  });
  return [
    { heading: null, lines: [line('pi', 'Principal and interest', b.principalAndInterest)] },
    {
      heading: ESCROW_GROUP,
      lines: [
        line('tax', 'Property tax', b.propertyTax, 'item', 'Property tax (escrow)'),
        line('insurance', 'Homeowners insurance', b.insurance, 'item', 'Homeowners insurance (escrow)'),
        line('escrow', 'Escrow total', b.escrow, 'subtotal'),
      ],
    },
    {
      heading: null,
      lines: [
        line('mi', 'Mortgage insurance', b.mortgageInsurance),
        line('mortgage', 'Estimated mortgage payment', b.mortgagePayment, 'total', 'Estimated mortgage payment (to the lender)'),
      ],
    },
    { heading: HOA_GROUP, lines: [line('hoa', 'HOA dues', b.hoa, 'item', 'HOA dues (not part of the mortgage payment)')] },
    { heading: null, lines: [line('total', 'Estimated total monthly housing cost', b.total, 'total')] },
  ];
}

export const breakdownLines = (b: PaymentBreakdown): BreakdownLine[] => breakdownGroups(b).flatMap((g) => g.lines);

interface TableOptions {
  /** Include the extra-payment column (the payoff calculator). */
  extra: boolean;
  /** The plan without extra payments, for a "balance without extra payments" column. */
  baseline?: LoanPlan;
}

/** The loan schedule by payment month or calendar year (conventions 13.3). */
export function loanTable(plan: LoanPlan, grouping: LoanGrouping, options: TableOptions): TableSource {
  const extraCol = options.extra;
  const base = options.baseline;
  if (grouping === 'month') {
    const rows = plan.months;
    const columns: TableColumn[] = [
      { label: 'Payment', numeric: false },
      { label: 'Regular payment', numeric: true },
      { label: 'Principal', numeric: true },
      { label: 'Interest', numeric: true },
      ...(extraCol ? [{ label: 'Extra', numeric: true }] : []),
      { label: 'Remaining balance', numeric: true },
      { label: 'Cumulative interest', numeric: true },
      ...(base ? [{ label: 'Balance without extra payments', numeric: true }] : []),
    ];
    return {
      caption: 'Each payment: principal, interest and the balance left',
      columns,
      count: rows.length,
      row: (i) => {
        const r = rows[i]!;
        return {
          head: `${dateLabel(r.date)} (#${r.month})`,
          cells: [
            formatUSD(r.payment),
            formatUSD(r.principal),
            formatUSD(r.interest),
            ...(extraCol ? [formatUSD(r.extra)] : []),
            formatUSD(r.balance),
            formatUSD(r.cumulativeInterest),
            ...(base ? [formatUSD(base.months[i]?.balance ?? 0)] : []),
          ],
        };
      },
      csvHeader: [
        'payment_number', 'year', 'month', 'payment_usd', 'principal_usd', 'interest_usd',
        ...(extraCol ? ['extra_usd'] : []),
        'balance_usd', 'cumulative_interest_usd', 'cumulative_principal_usd',
        ...(base ? ['balance_without_extra_usd'] : []),
      ],
      csvRow: (i) => {
        const r = rows[i]!;
        return [
          r.month, r.date.year, r.date.month, centsToCsv(r.payment), centsToCsv(r.principal), centsToCsv(r.interest),
          ...(extraCol ? [centsToCsv(r.extra)] : []),
          centsToCsv(r.balance), centsToCsv(r.cumulativeInterest), centsToCsv(r.cumulativePrincipal),
          ...(base ? [centsToCsv(base.months[i]?.balance ?? 0)] : []),
        ];
      },
      pageSize: 120,
      pageLabel: (page) => `Payments ${page * 120 + 1} to ${Math.min((page + 1) * 120, rows.length)}`,
      footer: {
        head: 'Total',
        cells: [
          formatUSD(plan.schedule.totalPaid - plan.months.reduce((s, r) => s + r.extra, 0)),
          formatUSD(plan.months.reduce((s, r) => s + r.principal, 0)),
          formatUSD(plan.schedule.totalInterest),
          ...(extraCol ? [formatUSD(plan.months.reduce((s, r) => s + r.extra, 0))] : []),
          formatUSD(0),
          formatUSD(plan.schedule.totalInterest),
          ...(base ? [''] : []),
        ],
      },
    };
  }
  const rows = plan.years;
  const baseByYear = new Map((base?.years ?? []).map((y) => [y.year, y.endBalance]));
  const detail: TableSource['detail'] = { table: (i) => loanYearMonths(plan, rows[i]!.year, options), all: () => loanTable(plan, 'month', options), noun: 'payments' };
  const columns: TableColumn[] = [
    { label: 'Year', numeric: false },
    { label: 'Payments', numeric: true },
    { label: 'Total paid', numeric: true },
    { label: 'Principal', numeric: true },
    { label: 'Interest', numeric: true },
    ...(extraCol ? [{ label: 'Extra', numeric: true }] : []),
    { label: 'Balance at year end', numeric: true },
    { label: 'Cumulative interest', numeric: true },
    ...(base ? [{ label: 'Balance without extra payments', numeric: true }] : []),
  ];
  return {
    caption: 'Each calendar year: payments, principal, interest and the balance left',
    columns,
    count: rows.length,
    row: (i) => {
      const y: LoanYearRow = rows[i]!;
      return {
        head: String(y.year),
        cells: [
          formatInteger(y.payments),
          formatUSD(y.scheduled + y.extra),
          formatUSD(y.principal),
          formatUSD(y.interest),
          ...(extraCol ? [formatUSD(y.extra)] : []),
          formatUSD(y.endBalance),
          formatUSD(y.cumulativeInterest),
          ...(base ? [formatUSD(baseByYear.get(y.year) ?? 0)] : []),
        ],
      };
    },
    csvHeader: ['year', 'payments', 'scheduled_usd', 'principal_usd', 'interest_usd', ...(extraCol ? ['extra_usd'] : []), 'end_balance_usd', 'cumulative_interest_usd', 'cumulative_principal_usd', ...(base ? ['balance_without_extra_usd'] : [])],
    csvRow: (i) => {
      const y = rows[i]!;
      return [y.year, y.payments, centsToCsv(y.scheduled), centsToCsv(y.principal), centsToCsv(y.interest), ...(extraCol ? [centsToCsv(y.extra)] : []), centsToCsv(y.endBalance), centsToCsv(y.cumulativeInterest), centsToCsv(y.cumulativePrincipal), ...(base ? [centsToCsv(baseByYear.get(y.year) ?? 0)] : [])] as CsvCell[];
    },
    pageSize: 100,
    pageLabel: () => 'All years',
    detail,
    footer: {
      head: 'Total',
      cells: [
        formatInteger(plan.schedule.months),
        formatUSD(plan.schedule.totalPaid),
        formatUSD(rows.reduce((s, y) => s + y.principal, 0)),
        formatUSD(plan.schedule.totalInterest),
        ...(extraCol ? [formatUSD(rows.reduce((s, y) => s + y.extra, 0))] : []),
        formatUSD(0),
        formatUSD(plan.schedule.totalInterest),
        ...(base ? [''] : []),
      ],
    },
  };
}

/**
 * The payments dated in calendar year `year` as their own table, for the expandable year rows
 * (ENGINE_CONVENTIONS section 14). The rows are the engine's month rows; the footer totals
 * them, so it reconciles with the year's row: regular payments add up to what was scheduled,
 * and principal, interest and extra to the year's, exactly.
 */
export function loanYearMonths(plan: LoanPlan, year: number, options: TableOptions): TableSource {
  const full = loanTable(plan, 'month', options);
  const from = plan.months.findIndex((m) => m.date.year === year);
  const months = plan.months.filter((m) => m.date.year === year);
  const last = months[months.length - 1]!;
  const sum = (pick: (m: LoanMonthRow) => number) => months.reduce((total, m) => total + pick(m), 0);
  const baseEnd = options.baseline?.years.find((y) => y.year === year)?.endBalance;
  return {
    ...full,
    caption: `${year} by payment: principal, interest and the balance left`,
    count: months.length,
    row: (i) => full.row(from + i),
    csvRow: (i) => full.csvRow(from + i),
    pageSize: Math.max(1, months.length),
    pageLabel: () => String(year),
    footer: {
      head: `${year} total`,
      cells: [
        formatUSD(sum((m) => m.payment)),
        formatUSD(sum((m) => m.principal)),
        formatUSD(sum((m) => m.interest)),
        ...(options.extra ? [formatUSD(sum((m) => m.extra))] : []),
        formatUSD(last.balance),
        formatUSD(last.cumulativeInterest),
        ...(options.baseline ? [baseEnd === undefined ? '' : formatUSD(baseEnd)] : []),
      ],
    },
  };
}

function yearLabels(dates: readonly PaymentDate[]): { index: number; label: string }[] {
  const out: { index: number; label: string }[] = [];
  dates.forEach((d, i) => {
    if (d.month === 12 || i === dates.length - 1) out.push({ index: i, label: String(d.year) });
  });
  return out;
}

/** Principal and interest paid in each month or year, stacked. */
export function loanChartSvg(plan: LoanPlan, grouping: LoanGrouping, description: string, options: { idPrefix?: string; width?: number } = {}): string {
  const common = {
    series: LOAN_SERIES,
    formatTick: formatUSDCompact,
    formatTotal: formatUSD,
    title: `Principal and interest paid each ${grouping}`,
    description,
    idPrefix: options.idPrefix ?? 'la-chart',
    ...(options.width ? { width: options.width } : {}),
  };
  if (grouping === 'year') {
    return stackedColumnsSvg({ ...common, categories: plan.years.map((y) => String(y.year)), values: plan.years.map((y) => [y.principal + y.extra, y.interest]) });
  }
  const rows = plan.months;
  return stackedAreaSvg({ ...common, count: rows.length, values: (i) => [rows[i]!.principal + rows[i]!.extra, rows[i]!.interest], xLabels: yearLabels(rows.map((r) => r.date)) });
}

export function loanTooltip(plan: LoanPlan, grouping: LoanGrouping, index: number): string[] {
  if (grouping === 'year') {
    const y = plan.years[index];
    return y ? [`${y.year}: ${formatUSD(y.scheduled + y.extra)} paid`, `Principal ${formatUSD(y.principal + y.extra)}`, `Interest ${formatUSD(y.interest)}`, `Balance at year end ${formatUSD(y.endBalance)}`] : [];
  }
  const m: LoanMonthRow | undefined = plan.months[index];
  return m ? [`${dateLabel(m.date)} (#${m.month}): ${formatUSD(m.payment + m.extra)}`, `Principal ${formatUSD(m.principal + m.extra)}`, `Interest ${formatUSD(m.interest)}`, `Balance left ${formatUSD(m.balance)}`] : [];
}

/** Remaining balance with and without the extra payments, over the longer (baseline) loan. */
export function payoffChartSvg(c: PayoffComparison, grouping: LoanGrouping, options: { idPrefix?: string; width?: number } = {}): string {
  const base = grouping === 'year' ? c.baseline.years.map((y) => ({ date: { year: y.year, month: 12 }, balance: y.endBalance })) : c.baseline.months.map((m) => ({ date: m.date, balance: m.balance }));
  const accel = grouping === 'year' ? new Map(c.accelerated.years.map((y) => [y.year, y.endBalance])) : new Map(c.accelerated.months.map((m) => [m.month, m.balance]));
  const at = (i: number) => (grouping === 'year' ? accel.get(base[i]!.date.year) ?? 0 : accel.get(i + 1) ?? 0);
  return linesSvg({
    count: base.length,
    series: PAYOFF_SERIES,
    values: (i) => [base[i]!.balance, at(i)],
    xLabels: yearLabels(base.map((b) => b.date)),
    formatTick: formatUSDCompact,
    formatTotal: formatUSD,
    endText: (s) => (s === 0 ? `Without extra payments: paid off ${dateLabel(c.baseline.payoff)}` : `With extra payments: paid off ${dateLabel(c.accelerated.payoff)}`),
    title: `Balance left at the end of each ${grouping}, with and without the extra payments`,
    description: payoffViewSummary(c),
    idPrefix: options.idPrefix ?? 'mp-chart',
    ...(options.width ? { width: options.width } : {}),
  });
}

function payoffViewSummary(c: PayoffComparison): string {
  return `Paid off ${dateLabel(c.accelerated.payoff)} with the extra payments and ${dateLabel(c.baseline.payoff)} without them.`;
}

export function payoffTooltip(c: PayoffComparison, grouping: LoanGrouping, index: number): string[] {
  if (grouping === 'year') {
    const y = c.baseline.years[index];
    if (!y) return [];
    const a = c.accelerated.years.find((x) => x.year === y.year);
    return [`End of ${y.year}`, `Without extra payments ${formatUSD(y.endBalance)}`, `With extra payments ${formatUSD(a?.endBalance ?? 0)}`];
  }
  const m = c.baseline.months[index];
  if (!m) return [];
  return [`${dateLabel(m.date)} (#${m.month})`, `Without extra payments ${formatUSD(m.balance)}`, `With extra payments ${formatUSD(c.accelerated.months[index]?.balance ?? 0)}`];
}

export function loanScheduleNotes(grouping: LoanGrouping, extra: boolean): string[] {
  const notes = ['Interest is one twelfth of the interest rate on the balance each month, rounded to the cent. Principal is the rest of the payment.'];
  if (extra) notes.push('Extra and one-time payments go entirely to principal, right after that month\'s regular payment.');
  if (grouping === 'year') {
    notes.push('Years are calendar years of the payment dates, so the first and last years usually have fewer than 12 payments.');
    notes.push(extra
      ? 'Total paid is the year\'s regular payments plus its extra payments; in a year\'s payments, Regular payment is the scheduled payment of principal and interest. In the CSV, scheduled_usd is the regular payments only and extra_usd the extra payments.'
      : 'Total paid is the year\'s regular payments of principal and interest (scheduled_usd in the CSV).');
  } else {
    notes.push(extra
      ? 'Regular payment is the scheduled payment of principal and interest; extra payments are listed apart. In the CSV, payment_usd is the regular payment and extra_usd the extra payment.'
      : 'Regular payment is the scheduled payment of principal and interest (payment_usd in the CSV).');
  }
  return notes;
}

function termInputs(input: LoanInput, first: PaymentDate): { label: string; value: string }[] {
  return [
    { label: 'Loan amount', value: formatUSD(input.principal) },
    { label: 'Interest rate (note rate)', value: formatRate(input.annualRate) },
    { label: 'Term', value: `${durationText(input.termMonths)} (${formatInteger(input.termMonths)} payments)` },
    { label: 'First payment', value: dateLabel(first) },
  ];
}

export function amortizationReport(input: LoanInput, first: PaymentDate, plan: LoanPlan, grouping: LoanGrouping, generated: Date): Report {
  const v = loanView(input, plan);
  const s = plan.schedule;
  const share = (part: number) => `${((part / s.totalPaid) * 100).toFixed(1)}%`;
  return {
    calculator: AMORTIZATION_CALCULATOR,
    generated,
    headline: { label: 'Monthly payment (principal and interest)', value: v.payment },
    summary: [...v.breakdown, { label: 'Payoff', value: v.payoff }],
    sentence: v.summary,
    inputs: termInputs(input, first),
    composition: [
      { label: 'Principal', value: formatUSD(input.principal), share: share(input.principal) },
      { label: 'Interest', value: formatUSD(s.totalInterest), share: share(s.totalInterest) },
      { label: 'Total paid (principal and interest)', value: formatUSD(s.totalPaid), share: '100.0%' },
    ],
    compositionText: { heading: 'Principal versus interest', caption: 'How the total paid is made up', shareLabel: 'Share of all payments' },
    rateChanges: null,
    tables: [],
    chart: {
      heading: `Principal and interest by ${grouping}`,
      svg: loanChartSvg(plan, grouping, v.summary, { idPrefix: 'report-chart', width: 720 }),
      legend: LOAN_SERIES.map((x) => x.label),
      summary: `${v.summary} The chart stacks the principal and the interest paid each ${grouping}; the schedule below has every figure.`,
    },
    schedule: { heading: grouping === 'year' ? 'Schedule by calendar year' : 'Schedule by payment', table: loanTable(plan, grouping, { extra: false }), notes: loanScheduleNotes(grouping, false) },
    assumptions: LOAN_ASSUMPTIONS,
    sources: LOAN_SOURCES,
  };
}

export function payoffReport(input: LoanInput, first: PaymentDate, costs: HousingCosts, c: PayoffComparison, breakdown: PaymentBreakdown, grouping: LoanGrouping, generated: Date): Report {
  const v = payoffView(c);
  const extras = [
    { label: 'Extra each month', value: formatUSD(input.extraMonthly ?? 0) },
    ...(input.oneTime ?? []).map((o, i) => ({ label: `One-time payment ${i + 1}`, value: `${formatUSD(o.amount)} with payment ${o.month} (${dateLabel(paymentDate(first, o.month))})` })),
    { label: 'Property tax (per year)', value: formatUSD(costs.propertyTaxAnnual) },
    { label: 'Homeowners insurance (per year)', value: formatUSD(costs.insuranceAnnual) },
    { label: 'Mortgage insurance (per month)', value: formatUSD(costs.mortgageInsuranceMonthly) },
    { label: 'HOA dues (per month)', value: formatUSD(costs.hoaMonthly) },
  ];
  const comparison = staticTable({
    caption: 'The loan with and without the extra payments',
    columns: [{ label: '', numeric: false }, { label: 'Without extra payments', numeric: true }, { label: 'With extra payments', numeric: true }],
    rows: v.rows.map((r) => ({ head: r.label, cells: [r.baseline, r.accelerated] })),
  });
  const lines = breakdownLines(breakdown);
  const total = lines.pop()!;
  const monthly = staticTable({
    caption: 'The first month\'s housing costs: principal and interest, the escrow items and mortgage insurance that make up the mortgage payment, then HOA dues, which are not part of it',
    columns: [{ label: 'Part', numeric: false }, { label: 'Per month', numeric: true }],
    rows: lines.map((r) => ({ head: r.reportLabel, cells: [r.value], ...(r.kind === 'item' ? {} : { strong: true }) })),
    footer: { head: total.reportLabel, cells: [total.value] },
  });
  return {
    calculator: PAYOFF_CALCULATOR,
    generated,
    headline: { label: 'Interest saved', value: v.hero },
    summary: [
      { label: 'Paid off', value: `${dateLabel(c.accelerated.payoff)} (instead of ${dateLabel(c.baseline.payoff)})` },
      { label: 'Time saved', value: durationText(c.monthsSaved) },
      { label: 'Monthly principal and interest', value: formatUSD(c.accelerated.schedule.payment) },
      { label: 'Estimated monthly mortgage payment (with escrow and mortgage insurance)', value: formatUSD(breakdown.mortgagePayment) },
      { label: 'Estimated total monthly housing cost (HOA dues included)', value: formatUSD(breakdown.total) },
    ],
    sentence: v.summary,
    inputs: [...termInputs(input, first), ...extras],
    composition: null,
    rateChanges: null,
    tables: [
      { heading: 'With and without the extra payments', table: comparison },
      { heading: 'Monthly housing costs', table: monthly },
    ],
    chart: {
      heading: `Balance left by ${grouping}`,
      svg: payoffChartSvg(c, grouping, { idPrefix: 'report-chart', width: 720 }),
      legend: PAYOFF_SERIES.map((x) => x.label),
      summary: `${v.summary} Each line is labeled with its payoff date; the schedule below has every figure.`,
    },
    schedule: { heading: grouping === 'year' ? 'Schedule by calendar year, with the extra payments' : 'Schedule by payment, with the extra payments', table: loanTable(c.accelerated, grouping, { extra: true, baseline: c.baseline }), notes: loanScheduleNotes(grouping, true) },
    assumptions: PAYOFF_ASSUMPTIONS,
    sources: LOAN_SOURCES,
  };
}

/** Term in months from the form's number and unit. */
export const termMonths = (value: number, unit: TermUnit): number => (unit === 'years' ? value * 12 : value);

const LOAN_BASE: Schema = {
  p: { kind: 'int', min: 1, max: 10_000_000_000 },
  r: { kind: 'decimal', min: 0, max: 100, decimals: 4 },
  t: { kind: 'int', min: 1, max: 600 },
  u: { kind: 'choice', values: ['years', 'months'] },
  fy: { kind: 'int', min: 1970, max: 2200 },
  fm: { kind: 'int', min: 1, max: 12 },
};

/** Share link schemas (version 1). Money fields are listed for the Rounded and No amounts modes. */
export const AMORTIZATION_SHARE_SCHEMA: Schema = { ...LOAN_BASE, a: AMOUNTS_FIELD };
export const AMORTIZATION_MONEY_KEYS = ['p'] as const;

const MONEY: Schema[string] = { kind: 'int', min: 0, max: 10_000_000_000 };
const PAYMENT_NUMBER: Schema[string] = { kind: 'int', min: 1, max: LOAN_LIMITS.termMonths.max };
export const ONE_TIME_SLOTS = [1, 2, 3] as const;

export const PAYOFF_SHARE_SCHEMA: Schema = {
  ...LOAN_BASE,
  x: MONEY,
  o1: PAYMENT_NUMBER, o1a: MONEY,
  o2: PAYMENT_NUMBER, o2a: MONEY,
  o3: PAYMENT_NUMBER, o3a: MONEY,
  tx: MONEY,
  in: MONEY,
  mi: MONEY,
  hoa: MONEY,
  a: AMOUNTS_FIELD,
};
export const PAYOFF_MONEY_KEYS = ['p', 'x', 'o1a', 'o2a', 'o3a', 'tx', 'in', 'mi', 'hoa'] as const;

export function loanShareState(input: LoanInput, term: { value: number; unit: TermUnit }, first: PaymentDate): Record<string, number | string> {
  return { p: input.principal, r: formatRate(input.annualRate).replace('%', ''), t: term.value, u: term.unit, fy: first.year, fm: first.month };
}

export function payoffShareState(input: LoanInput, term: { value: number; unit: TermUnit }, first: PaymentDate, costs: HousingCosts): Record<string, number | string> {
  const state = loanShareState(input, term, first);
  if (input.extraMonthly) state.x = input.extraMonthly;
  (input.oneTime ?? []).forEach((o, i) => {
    state[`o${i + 1}`] = o.month;
    state[`o${i + 1}a`] = o.amount;
  });
  if (costs.propertyTaxAnnual) state.tx = costs.propertyTaxAnnual;
  if (costs.insuranceAnnual) state.in = costs.insuranceAnnual;
  if (costs.mortgageInsuranceMonthly) state.mi = costs.mortgageInsuranceMonthly;
  if (costs.hoaMonthly) state.hoa = costs.hoaMonthly;
  return state;
}

/** Plain-language message for an engine issue, and the form field it belongs to. */
export function loanIssueMessage(issue: Issue): { field: string; message: string } {
  const oneTime = /^oneTime\[(\d)\]\.(month|amount)$/.exec(issue.field);
  if (oneTime) {
    const slot = Number(oneTime[1]) + 1;
    return oneTime[2] === 'month'
      ? { field: `o${slot}`, message: issue.code === 'above-maximum' ? 'This payment is after the last one of the loan.' : 'Payment numbers start at 1.' }
      : { field: `o${slot}a`, message: issue.code === 'above-maximum' ? 'This amount is above the largest this calculator accepts.' : 'Enter an amount of at least $0.01.' };
  }
  switch (issue.field) {
    case 'principal':
      return { field: 'principal', message: issue.code === 'below-minimum' ? 'Enter a loan amount of at least $0.01.' : 'The loan amount is above the largest this calculator accepts ($100,000,000).' };
    case 'annualRate':
      return {
        field: 'rate',
        message:
          issue.code === 'payment-does-not-cover-interest'
            ? 'At this rate and term the payment would not even cover the interest, so the loan would never be paid off. Use a shorter term, a lower rate or a larger amount.'
            : 'Rates from 0% to 100% only.',
      };
    case 'termMonths':
      return { field: 'term', message: 'The term must be from 1 to 600 months (50 years).' };
    case 'extraMonthly':
      return { field: 'extra', message: 'The extra payment is above the largest this calculator accepts.' };
    case 'firstPayment.year':
      return { field: 'firstYear', message: 'Enter a year from 1970 to 2200.' };
    default:
      return { field: 'principal', message: 'Check the entries.' };
  }
}

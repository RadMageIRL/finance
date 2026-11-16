// Schedule tables on the page: the compact view's key columns (TableColumn.key) for every
// calculator, how cells are marked for the compact and detailed views, and the page-only
// Total paid column of the payoff calculator, which the report and the CSV leave out.
import { describe, expect, it } from 'vitest';
import { compoundSchedule, compoundScheduleConfig, DEFAULT_INPUT } from '../../../src/lib/calc/compound-view';
import { formatUSD } from '../../../src/lib/calc/format';
import { loanTable, loanYearMonths } from '../../../src/lib/calc/loan-view';
import { DEFAULT_RATES, illustrationInput, illustrationTable } from '../../../src/lib/calc/rates-view';
import { DEFAULT_SAVINGS, savingsSchedule, savingsScheduleConfig } from '../../../src/lib/calc/savings-view';
import { cellClass, gridClass, keyCount, keyProblem } from '../../../src/lib/calc/schedule-grid';
import { scheduleTable } from '../../../src/lib/calc/schedule-view';
import { compoundInterest } from '../../../src/lib/engines/compound';
import { savingsGrowth } from '../../../src/lib/engines/hysa';
import { loanPlan, payoffComparison } from '../../../src/lib/engines/loan-report';
import { compareRates, type RateAccountInput } from '../../../src/lib/engines/rate-compare';
import { rateIllustration } from '../../../src/lib/engines/rate-illustration';
import { reportText, tableHtml, type Report } from '../../../src/lib/report/report';
import { reportColumns, tableCsv, type TableSource } from '../../../src/lib/report/table';

const keyLabels = (t: TableSource) =>
  t.columns
    .filter((c) => c.key !== undefined)
    .sort((a, b) => a.key! - b.key!)
    .map((c) => c.label);

function ok<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error('invalid');
  return r.value;
}

function compoundTables() {
  const result = ok(compoundInterest(DEFAULT_INPUT));
  const schedule = compoundSchedule(DEFAULT_INPUT, result);
  const config = compoundScheduleConfig(DEFAULT_INPUT);
  return (['day', 'month', 'year'] as const).map((g) => scheduleTable(schedule, g, config));
}

function savingsTables() {
  const result = ok(savingsGrowth(DEFAULT_SAVINGS));
  const schedule = savingsSchedule(DEFAULT_SAVINGS, result);
  const config = savingsScheduleConfig(result);
  return (['day', 'month', 'year'] as const).map((g) => scheduleTable(schedule, g, config));
}

function illustrationTables(accounts: readonly (RateAccountInput | null)[]) {
  const comparison = ok(compareRates(accounts, DEFAULT_RATES.balance));
  const input = illustrationInput(comparison, 3);
  const months = ok(rateIllustration(input, 'month'));
  return { comparison, tables: (['day', 'month', 'year'] as const).map((g) => illustrationTable(comparison, ok(rateIllustration(input, g)), g, months)) };
}

describe('compact view key columns', () => {
  it('shows deposits, interest credited and the closing balance for compound interest and savings, in months under years too', () => {
    for (const [t, deposits] of [...compoundTables().map((t) => [t, 'Contributions'] as const), ...savingsTables().map((t) => [t, 'Deposits'] as const)]) {
      expect(keyProblem(t.columns)).toBeNull();
      expect(keyLabels(t)).toEqual([deposits, 'Interest credited', 'Closing balance']);
      if (t.detail) expect(keyLabels(t.detail.table(0))).toEqual(keyLabels(t));
    }
  });

  it('shows what was paid, the interest and the balance left for both loan calculators', () => {
    const plan = ok(loanPlan({ principal: 3_000_000, annualRate: 0.07, termMonths: 60 }, { year: 2027, month: 7 }));
    expect(keyLabels(loanTable(plan, 'month', { extra: false }))).toEqual(['Regular payment', 'Interest', 'Remaining balance']);
    expect(keyLabels(loanTable(plan, 'year', { extra: false }))).toEqual(['Total paid', 'Interest', 'Balance at year end']);
    const c = ok(payoffComparison({ principal: 20_000_000, annualRate: 0.06, termMonths: 360, extraMonthly: 10_000 }, { year: 2027, month: 4 }));
    const options = { extra: true, baseline: c.baseline };
    expect(keyLabels(loanTable(c.accelerated, 'month', options))).toEqual(['Total paid', 'Interest', 'Remaining balance']);
    expect(keyLabels(loanTable(c.accelerated, 'year', options))).toEqual(['Total paid', 'Interest', 'Balance at year end']);
    expect(keyLabels(loanYearMonths(c.accelerated, 2027, options))).toEqual(['Total paid', 'Interest', 'Remaining balance']);
    for (const t of [loanTable(plan, 'month', { extra: false }), loanTable(c.accelerated, 'year', options), loanTable(c.accelerated, 'month', options)]) expect(keyProblem(t.columns)).toBeNull();
  });

  it("shows each account's balance for the APR and APY illustration, one to three accounts", () => {
    const a = DEFAULT_RATES.accounts[0]!;
    const monthly: RateAccountInput = { ...a, periodsPerYear: 12 };
    const annual: RateAccountInput = { ...a, periodsPerYear: 1 };
    const sets: (RateAccountInput | null)[][] = [[a, null, null], [a, monthly, null], [a, monthly, annual]];
    for (const accounts of sets) {
      const { comparison, tables } = illustrationTables(accounts);
      const n = comparison.accounts.length;
      for (const t of tables) {
        expect(keyProblem(t.columns)).toBeNull();
        expect(keyCount(t.columns)).toBe(n);
        expect(keyLabels(t).every((l) => l.endsWith(' balance'))).toBe(true);
        if (t.detail) expect(keyLabels(t.detail.table(0)).map((l) => l.replace(' closing balance', ' balance'))).toEqual(keyLabels(t));
      }
    }
  });
});

describe('cell marking', () => {
  it('marks the row header, key columns and the other columns for the two views', () => {
    expect(cellClass({ label: 'Year', numeric: false }, 0)).toBe('sched-period');
    expect(cellClass({ label: 'Deposits', numeric: true, key: 1 }, 2)).toBe('num sched-key sched-key--1');
    expect(cellClass({ label: 'APY', numeric: true }, 5)).toBe('num sched-x');
    expect(cellClass({ label: 'Note', numeric: false }, 3)).toBe('sched-x');
    expect(cellClass(undefined, 4)).toBe('sched-period');
    const columns = [{ label: 'Year', numeric: false }, { label: 'A', numeric: true, key: 1 }, { label: 'B', numeric: true }, { label: 'C', numeric: true, key: 2 }];
    expect(gridClass(columns)).toBe('sched-grid sched-cols-2');
    expect(keyCount(columns)).toBe(2);
  });

  it('names the problem when keys are missing, repeated, out of order or more than three', () => {
    const col = (key?: number) => ({ label: 'x', numeric: true, ...(key === undefined ? {} : { key }) });
    const head = { label: 'Year', numeric: false };
    expect(keyProblem([head, col(), col()])).toBe('no key columns');
    expect(keyProblem([head, col(2), col(1)])).toBe('keys out of order: 2, 1');
    expect(keyProblem([head, col(1), col(1)])).toBe('keys out of order: 1, 1');
    expect(keyProblem([head, col(1), col(3)])).toBe('keys out of order: 1, 3');
    expect(keyProblem([head, col(1), col(2), col(3), col(4)])).toBe('4 key columns (at most 3)');
    expect(keyProblem([head, col(1), col(), col(2)])).toBeNull();
  });
});

describe("the payoff calculator's page-only Total paid", () => {
  const c = ok(payoffComparison({ principal: 20_000_000, annualRate: 0.06, termMonths: 360, extraMonthly: 10_000, oneTime: [{ month: 13, amount: 500_000 }] }, { year: 2027, month: 4 }));
  const options = { extra: true, baseline: c.baseline };

  it('is the regular payment plus the extra payment on every row and in the total', () => {
    const t = loanTable(c.accelerated, 'month', options);
    expect(t.columns[1]).toEqual({ label: 'Total paid', numeric: true, key: 1, screen: true });
    c.accelerated.months.forEach((m, i) => expect(t.row(i).cells[0]).toBe(formatUSD(m.payment + m.extra)));
    expect(t.footer!.cells[0]).toBe(formatUSD(c.accelerated.schedule.totalPaid));
  });

  it('stays out of the report, the text summary and the CSV, which keep their columns', () => {
    const t = loanTable(c.accelerated, 'month', options);
    expect(reportColumns(t)).toEqual(t.columns.map((_c, i) => i).filter((i) => i !== 1));
    const html = tableHtml(t, 3);
    expect(html).not.toContain('Total paid');
    expect(html.match(/<th scope="col"/g)).toHaveLength(t.columns.length - 1);
    expect(html).toContain(`<td>${formatUSD(c.accelerated.months[0]!.payment)}</td>`);
    expect(tableCsv(t).split('\r\n')[0]).toBe('payment_number,year,month,payment_usd,principal_usd,interest_usd,extra_usd,balance_usd,cumulative_interest_usd,cumulative_principal_usd,balance_without_extra_usd');
    const report: Report = {
      calculator: 'Mortgage payoff calculator',
      generated: new Date(0),
      headline: { label: 'Headline', value: 'value' },
      summary: [],
      sentence: 'Sentence.',
      inputs: [],
      composition: null,
      rateChanges: null,
      tables: [{ heading: 'Payments', table: t }],
      chart: null,
      schedule: null,
      assumptions: [],
      sources: [],
    };
    const text = reportText(report);
    expect(text).not.toContain('Total paid');
    expect(text).toContain(`Regular payment ${formatUSD(c.accelerated.months[0]!.payment)}`);
  });

  it('is not added to the amortization table, which has no extra payments', () => {
    const plan = ok(loanPlan({ principal: 3_000_000, annualRate: 0.07, termMonths: 60 }, { year: 2027, month: 7 }));
    const t = loanTable(plan, 'month', { extra: false });
    expect(t.columns.some((col) => col.screen)).toBe(false);
    expect(reportColumns(t)).toHaveLength(t.columns.length);
  });
});

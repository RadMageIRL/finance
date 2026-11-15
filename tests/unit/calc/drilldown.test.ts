// Expandable year rows (ENGINE_CONVENTIONS section 14): the months under each year are the
// engine's own month rows, and each year's month table totals back to the year's row.
import { describe, expect, it } from 'vitest';
import { compoundSchedule, compoundScheduleConfig, DEFAULT_INPUT } from '../../../src/lib/calc/compound-view';
import { DEFAULT_SAVINGS, savingsSchedule, savingsScheduleConfig } from '../../../src/lib/calc/savings-view';
import { scheduleTable } from '../../../src/lib/calc/schedule-view';
import { loanTable, loanYearMonths } from '../../../src/lib/calc/loan-view';
import { DEFAULT_RATES, illustrationInput, illustrationMonthsAll, illustrationTable, illustrationYearMonths } from '../../../src/lib/calc/rates-view';
import { formatUSD, formatUSD4 } from '../../../src/lib/calc/format';
import { compoundInterest, type CompoundInput } from '../../../src/lib/engines/compound';
import { savingsGrowth } from '../../../src/lib/engines/hysa';
import { loanPlan, payoffComparison } from '../../../src/lib/engines/loan-report';
import { compareRates } from '../../../src/lib/engines/rate-compare';
import { rateIllustration } from '../../../src/lib/engines/rate-illustration';
import { reportBody, reportText, tableHtml, type Report } from '../../../src/lib/report/report';
import { tableCsv, type TableSource } from '../../../src/lib/report/table';

function compound(change: Partial<CompoundInput> = {}) {
  const input = { ...DEFAULT_INPUT, ...change };
  const result = compoundInterest(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return { input, schedule: compoundSchedule(input, result.value), config: compoundScheduleConfig(input) };
}

function savings() {
  const input = {
    ...DEFAULT_SAVINGS,
    years: 3,
    rates: [
      { fromMonth: 1, apy: 0.045 },
      { fromMonth: 8, apy: 0.0375 },
      { fromMonth: 20, apy: 0.041 },
    ],
  };
  const result = savingsGrowth(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return { schedule: savingsSchedule(input, result.value), config: savingsScheduleConfig(result.value) };
}

function illustration(accounts = DEFAULT_RATES.accounts, years = 3) {
  const comparison = compareRates(accounts, DEFAULT_RATES.balance);
  if (!comparison.ok) throw new Error('invalid');
  const input = illustrationInput(comparison.value, years);
  const rows = (g: 'day' | 'month' | 'year') => {
    const r = rateIllustration(input, g);
    if (!r.ok) throw new Error('invalid');
    return r.value;
  };
  return { comparison: comparison.value, input, years: rows('year'), months: rows('month') };
}

/** Every cell of a table, row by row, for comparing two table sources. */
const cellsOf = (t: TableSource) => Array.from({ length: t.count }, (_, i) => [t.row(i).head, ...t.row(i).cells]);

describe('months under each year: compound interest and savings', () => {
  it('offers month tables only on the year table, and lists the engine month rows of each year', () => {
    const { schedule, config } = compound({ years: 4, contributionFrequency: 'biweekly', contribution: 15_000, periodsPerYear: 4 });
    expect(scheduleTable(schedule, 'month', config).detail).toBeUndefined();
    expect(scheduleTable(schedule, 'day', config).detail).toBeUndefined();
    const years = scheduleTable(schedule, 'year', config);
    const months = scheduleTable(schedule, 'month', config);
    expect(years.detail?.noun).toBe('months');
    for (let y = 0; y < years.count; y += 1) {
      const t = years.detail!.table(y);
      expect(t.count).toBe(12);
      expect(cellsOf(t)).toEqual(cellsOf(months).slice(12 * y, 12 * y + 12));
      expect(t.footer!.head).toBe(`Year ${y + 1} total`);
    }
    expect(cellsOf(years.detail!.all())).toEqual(cellsOf(months));
  });

  it("reconciles every year: its months' deposits, accrued and credited interest add up to the year's", () => {
    for (const change of [{}, { periodsPerYear: 1 as const, years: 6 }, { periodsPerYear: 365 as const, contributionFrequency: 'weekly' as const, contribution: 2_500, timing: 'start' as const }]) {
      const { schedule, config } = compound(change);
      const years = schedule.rows('year');
      const months = schedule.rows('month');
      const table = scheduleTable(schedule, 'year', config);
      years.forEach((year, y) => {
        const ms = months.slice(12 * y, 12 * y + 12);
        expect(ms.reduce((s, m) => s + m.deposits, 0)).toBe(year.deposits);
        expect(ms.reduce((s, m) => s + m.credited, 0)).toBe(year.credited);
        // The year's accrued interest is the sum of its months' in month order (11.3): equal, not close.
        expect(ms.reduce((s, m) => s + m.accrued, 0)).toBe(year.accrued);
        expect([ms[0]!.opening, ms[11]!.closing, ms[11]!.cumulativeInterest]).toEqual([year.opening, year.closing, year.cumulativeInterest]);
        // The footer under the year shows the same figures as the year's own row.
        const yearCells = table.row(y).cells;
        const foot = table.detail!.table(y).footer!.cells;
        expect([foot[0], foot[1], foot[2], foot[3], foot[5], foot[6]]).toEqual([yearCells[0], yearCells[1], yearCells[2], yearCells[3], yearCells[5], yearCells[6]]);
        expect(foot[2]).toBe(formatUSD4(year.accrued));
      });
    }
  });

  it('shows accrued interest so the months as displayed add up to the year as displayed within the display rounding', () => {
    // Section 14: accrued is shown to a hundredth of a cent, so 12 shown values may differ from
    // the year's shown value by at most half a hundredth of a cent each; credited adds up exactly.
    const dollars = (text: string) => Number(text.replace(/[$,]/g, ''));
    for (const change of [{}, { periodsPerYear: 365 as const, contributionFrequency: 'weekly' as const, contribution: 2_500 }]) {
      const { schedule, config } = compound({ ...change, years: 8 });
      const table = scheduleTable(schedule, 'year', config);
      for (let y = 0; y < table.count; y += 1) {
        const months = table.detail!.table(y);
        const shownAccrued = Array.from({ length: months.count }, (_, i) => dollars(months.row(i).cells[2]!)).reduce((s, v) => s + v, 0);
        expect(Math.abs(shownAccrued - dollars(table.row(y).cells[2]!))).toBeLessThanOrEqual(12 * 0.00005 + 1e-9);
        const shownCredited = Array.from({ length: months.count }, (_, i) => Math.round(dollars(months.row(i).cells[3]!) * 100)).reduce((s, v) => s + v, 0);
        expect(shownCredited).toBe(Math.round(dollars(table.row(y).cells[3]!) * 100));
      }
    }
  });

  it('keeps the rate note and the APY earned of each month in the savings month tables', () => {
    const { schedule, config } = savings();
    const years = scheduleTable(schedule, 'year', config);
    const months = scheduleTable(schedule, 'month', config);
    const year1 = years.detail!.table(0);
    expect(year1.columns.map((c) => c.label)).toEqual(months.columns.map((c) => c.label));
    expect(year1.row(7).note).toBe(months.row(7).note);
    expect(year1.row(7).note).toBeTruthy();
    const foot = year1.footer!.cells;
    const yearCells = years.row(0).cells;
    expect([foot[1], foot[3], foot[5]]).toEqual([yearCells[1], yearCells[3], yearCells[5]]);
    expect(foot.at(-1)).toBe('');
  });
});

describe('months under each year: loans', () => {
  it('lists the payments dated in each calendar year, partial first and last years included', () => {
    const plan = loanPlan({ principal: 3_000_000, annualRate: 0.07, termMonths: 60 }, { year: 2027, month: 7 });
    if (!plan.ok) throw new Error('invalid');
    const years = loanTable(plan.value, 'year', { extra: false });
    const months = loanTable(plan.value, 'month', { extra: false });
    expect(years.detail?.noun).toBe('payments');
    expect(plan.value.years.map((y) => years.detail!.table(plan.value.years.indexOf(y)).count)).toEqual([6, 12, 12, 12, 12, 6]);
    let from = 0;
    plan.value.years.forEach((y, i) => {
      const t = years.detail!.table(i);
      expect(cellsOf(t)).toEqual(cellsOf(months).slice(from, from + y.payments));
      from += y.payments;
    });
    expect(cellsOf(years.detail!.all())).toEqual(cellsOf(months));
    expect(months.columns[1]!.label).toBe('Regular payment');
  });

  it("reconciles every year: payments, principal, interest and extra add up to the year's, and the balance matches", () => {
    const c = payoffComparison({ principal: 20_000_000, annualRate: 0.06, termMonths: 360, extraMonthly: 10_000, oneTime: [{ month: 13, amount: 500_000 }] }, { year: 2027, month: 4 });
    if (!c.ok) throw new Error('invalid');
    const plan = c.value.accelerated;
    const options = { extra: true, baseline: c.value.baseline };
    const table = loanTable(plan, 'year', options);
    plan.years.forEach((y, i) => {
      const ms = plan.months.filter((m) => m.date.year === y.year);
      expect(ms.reduce((s, m) => s + m.payment, 0)).toBe(y.scheduled);
      expect(ms.reduce((s, m) => s + m.principal, 0)).toBe(y.principal);
      expect(ms.reduce((s, m) => s + m.interest, 0)).toBe(y.interest);
      expect(ms.reduce((s, m) => s + m.extra, 0)).toBe(y.extra);
      const foot = loanYearMonths(plan, y.year, options).footer!;
      expect(foot.head).toBe(`${y.year} total`);
      expect(foot.cells).toEqual([
        formatUSD(y.scheduled),
        formatUSD(y.principal),
        formatUSD(y.interest),
        formatUSD(y.extra),
        formatUSD(y.endBalance),
        formatUSD(y.cumulativeInterest),
        table.row(i).cells.at(-1),
      ]);
    });
  });
});

describe('months under each year: APR and APY illustration', () => {
  it('shows opening, accrued, credited and closing for each account, and differences from the first', () => {
    const { comparison, years, months } = illustration();
    const table = illustrationTable(comparison, years, 'year', months);
    expect(table.detail?.noun).toBe('months');
    const t = table.detail!.table(1);
    expect(t.count).toBe(12);
    expect(t.columns.map((c) => c.label)).toEqual([
      'Month',
      'Account A opening balance', 'Account A interest accrued', 'Account A interest credited', 'Account A closing balance',
      'Account B opening balance', 'Account B interest accrued', 'Account B interest credited', 'Account B closing balance',
      'Account B minus Account A',
    ]);
    // Each month opens where the last closed, and opening plus credited is closing, per account.
    for (let i = 0; i < months.length; i += 1) {
      const r = months[i]!;
      r.shown.forEach((closing, a) => {
        const opening = i === 0 ? comparison.balance : months[i - 1]!.shown[a]!;
        const row = illustrationMonthsAll(comparison, months).row(i).cells;
        expect(row.slice(4 * a, 4 * a + 4)).toEqual([formatUSD(opening), formatUSD4(r.accrued[a]!), formatUSD(closing - opening), formatUSD(closing)]);
      });
    }
    expect(t.row(0).cells.at(-1)).toBe(formatUSD(months[12]!.shown[1]! - months[12]!.shown[0]!));
    // No difference columns with a single account.
    const single = illustration([DEFAULT_RATES.accounts[0]!, null, null]);
    expect(illustrationYearMonths(single.comparison, single.months, 1).columns).toHaveLength(5);
  });

  it("reconciles every year: its months' accrued and credited interest add up to the year's, per account", () => {
    for (const accounts of [DEFAULT_RATES.accounts, [{ kind: 'rate' as const, value: 0.05, periodsPerYear: 1 as const }, { kind: 'rate' as const, value: 0.05, periodsPerYear: 52 as const }, { kind: 'apy' as const, value: 0.05, periodsPerYear: 2 as const }]]) {
      const { comparison, input, years, months } = illustration(accounts, 4);
      years.forEach((year, y) => {
        const ms = months.slice(12 * y, 12 * y + 12);
        year.accrued.forEach((accrued, a) => {
          // A year's accrued interest is the sum of its months' in month order (12.5): equal, not close.
          expect(ms.reduce((s, m) => s + m.accrued[a]!, 0)).toBe(accrued);
          // Over a whole year it equals the unrounded interest credited.
          const start = y === 0 ? input.deposit : years[y - 1]!.balances[a]!;
          expect(Math.abs(accrued - (year.balances[a]! - start))).toBeLessThanOrEqual(1e-9 * year.balances[a]!);
          const openingShown = y === 0 ? comparison.balance : years[y - 1]!.shown[a]!;
          const foot = illustrationYearMonths(comparison, months, y + 1).footer!.cells;
          expect(foot.slice(4 * a, 4 * a + 4)).toEqual([formatUSD(openingShown), formatUSD4(accrued), formatUSD(year.shown[a]! - openingShown), formatUSD(year.shown[a]!)]);
        });
      });
    }
  });

  it('accrues an annual account month by month but credits it only at year end', () => {
    const { months } = illustration([{ kind: 'rate', value: 0.06, periodsPerYear: 1 }, null, null], 1);
    expect(months.slice(0, 11).every((m) => m.shown[0] === DEFAULT_RATES.balance)).toBe(true);
    expect(months[0]!.accrued[0]).toBeCloseTo((DEFAULT_RATES.balance * 0.06 * 31) / 365, 9);
    expect(months[11]!.shown[0]).toBe(DEFAULT_RATES.balance * 1.06);
  });
});

describe('months under each year in the exports', () => {
  it('puts a month table under every year in the report only when asked, and says so in the summary', () => {
    const { schedule, config } = compound({ years: 3 });
    const table = scheduleTable(schedule, 'year', config);
    expect(tableHtml(table).match(/<table>/g)).toHaveLength(1);
    const html = tableHtml(table, Number.POSITIVE_INFINITY, { detail: true });
    expect(html.match(/<tr class="rmf-report__detail"><td colspan="8"><table>/g)).toHaveLength(3);
    expect(html).toContain('<caption>Year 2 by month: balances, contributions, interest accrued and credited</caption>');
    expect(html).toContain('<tfoot><tr><th scope="row">Year 3 total</th>');
    const report: Report = {
      calculator: 'Compound interest calculator',
      generated: new Date(2026, 10, 15),
      headline: { label: 'Final balance', value: '$1.00' },
      summary: [],
      sentence: '',
      inputs: [],
      composition: null,
      rateChanges: null,
      tables: [],
      chart: null,
      schedule: { heading: 'Schedule by year', table, notes: [], months: true },
      assumptions: [],
      sources: [],
    };
    expect(reportBody(report)).toContain("<h2>Schedule by year, with each year&#39;s months</h2>");
    expect(reportText(report).replace(/\s+/g, ' ')).toContain('the CSV holds every one of the 36 months');
    const plain = reportBody({ ...report, schedule: { ...report.schedule!, months: false } });
    expect(plain).not.toContain('rmf-report__detail');
  });

  it('makes the CSV with months the full monthly schedule, whatever is expanded on the page', () => {
    const { schedule, config } = compound({ years: 5 });
    const year = scheduleTable(schedule, 'year', config);
    expect(tableCsv(year.detail!.all())).toBe(tableCsv(scheduleTable(schedule, 'month', config)));
    const plan = loanPlan({ principal: 3_000_000, annualRate: 0.07, termMonths: 60 }, { year: 2027, month: 7 });
    if (!plan.ok) throw new Error('invalid');
    expect(tableCsv(loanTable(plan.value, 'year', { extra: false }).detail!.all())).toBe(tableCsv(loanTable(plan.value, 'month', { extra: false })));
    const { comparison, months } = illustration();
    const csv = tableCsv(illustrationMonthsAll(comparison, months)).trim().split(/\r\n/);
    expect(csv[0]).toBe('month,year,month_of_year,a_opening_usd,a_interest_accrued_usd,a_interest_credited_usd,a_closing_usd,b_opening_usd,b_interest_accrued_usd,b_interest_credited_usd,b_closing_usd,b_minus_a_usd');
    expect(csv).toHaveLength(1 + 36);
  });
});

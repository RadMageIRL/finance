// The mortgage payoff calculator's Total paid in its exports (v0.1.1), checked against the
// independent Python oracle (loan_reports.json), never against the engine's own numbers.
// ENGINE_CONVENTIONS section 6 defines the total paid in a month as payment + extra; section
// 13.3's year rows carry scheduled and extra. The oracle writes those parts for every row
// (month rows for terms of at most 120 months), so each exported Total paid must equal the
// oracle's parts added in whole cents, and the rows must add up to the oracle's total_paid_cents.
// No engine, oracle or fixture changes: this is a display and export column only.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatUSD } from '../../../src/lib/calc/format';
import { loanTable, payoffReport } from '../../../src/lib/calc/loan-view';
import { paymentBreakdown, payoffComparison } from '../../../src/lib/engines/loan-report';
import { reportBody } from '../../../src/lib/report/report';
import { tableCsv } from '../../../src/lib/report/table';

const FIXTURE = 'tests/oracle/fixtures/loan_reports.json';
const fixture = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : { cases: [] };

interface Case {
  id: string;
  principal_cents: number;
  annual_rate: string;
  term_months: number;
  extra_monthly_cents: number;
  one_time: [number, number][];
  first_payment: [number, number];
  property_tax_annual_cents: number;
  insurance_annual_cents: number;
  mortgage_insurance_monthly_cents: number;
  hoa_monthly_cents: number;
  total_paid_cents: number;
  // [year, payments, scheduled, principal, interest, extra, end_balance, cumulative_interest, cumulative_principal]
  yearly: number[][];
  // [month, year, calendar_month, payment, interest, principal, extra, balance, cumulative_interest, cumulative_principal]
  monthly?: number[][];
}

const cases: Case[] = fixture.cases;
const withExtras = cases.filter((c) => c.extra_monthly_cents > 0 || c.one_time.length > 0);
const cents = (cell: string | undefined) => {
  expect(cell).toMatch(/^\d+\.\d{2}$/);
  return Number(cell!.replace('.', ''));
};

function exportsOf(c: Case) {
  const loan = {
    principal: c.principal_cents,
    annualRate: Number(c.annual_rate),
    termMonths: c.term_months,
    extraMonthly: c.extra_monthly_cents,
    oneTime: c.one_time.map(([month, amount]) => ({ month, amount })),
  };
  const first = { year: c.first_payment[0], month: c.first_payment[1] };
  const costs = {
    propertyTaxAnnual: c.property_tax_annual_cents,
    insuranceAnnual: c.insurance_annual_cents,
    mortgageInsuranceMonthly: c.mortgage_insurance_monthly_cents,
    hoaMonthly: c.hoa_monthly_cents,
  };
  const comparison = payoffComparison(loan, first);
  if (!comparison.ok) throw new Error(`${c.id}: refused`);
  const breakdown = paymentBreakdown(comparison.value.accelerated.schedule.payment, costs);
  if (!breakdown.ok) throw new Error(`${c.id}: breakdown refused`);
  const options = { extra: true, baseline: comparison.value.baseline };
  return {
    table: (g: 'month' | 'year') => loanTable(comparison.value.accelerated, g, options),
    report: (g: 'month' | 'year') => reportBody(payoffReport(loan, first, costs, comparison.value, breakdown.value, g, new Date(2026, 10, 16))),
  };
}

/**
 * The schedule table of a report body, found by its caption: each row's header and the cell
 * `skip` cells in (0 is the first cell after the row header), plus the same cell of the footer.
 */
function scheduleColumn(body: string, caption: string, headers: string, skip: number) {
  const start = body.indexOf(`<caption>${caption}</caption>`);
  expect(start, caption).toBeGreaterThan(-1);
  const table = body.slice(start, body.indexOf('</table>', start));
  expect(table, caption).toContain(headers);
  const cell = '<td>[^<]*</td>'.repeat(skip);
  const rows = [...table.matchAll(new RegExp(`<tr><th scope="row">([^<]+)</th>${cell}<td>([^<]*)</td>`, 'g'))].map((m) => [m[1]!, m[2]!] as const);
  return { body: rows.filter(([head]) => head !== 'Total'), total: rows.find(([head]) => head === 'Total')?.[1] };
}

describe('mortgage payoff Total paid in the exports, against the oracle', () => {
  it('has cases with extra payments, some with month rows', () => {
    expect(withExtras.length).toBeGreaterThanOrEqual(8);
    expect(withExtras.filter((c) => c.monthly).length).toBeGreaterThanOrEqual(8);
  });

  it('CSV by payment: total_paid_usd is the oracle payment plus extra on every row, summing to total_paid_cents', () => {
    for (const c of withExtras.filter((x) => x.monthly)) {
      const lines = tableCsv(exportsOf(c).table('month')).trim().split('\r\n');
      const header = lines[0]!.split(',');
      expect(header.at(-1), c.id).toBe('total_paid_usd');
      const at = header.indexOf('total_paid_usd');
      expect(lines.length - 1, c.id).toBe(c.monthly!.length);
      let sum = 0;
      c.monthly!.forEach((m, i) => {
        const cells = lines[i + 1]!.split(',');
        expect(Number(cells[0]), `${c.id} row ${i}`).toBe(m[0]);
        const total = cents(cells[at]);
        expect(total, `${c.id} payment ${m[0]}`).toBe(m[3]! + m[6]!);
        expect(cents(cells[header.indexOf('payment_usd')]) + cents(cells[header.indexOf('extra_usd')]), `${c.id} payment ${m[0]}`).toBe(total);
        sum += total;
      });
      expect(sum, c.id).toBe(c.total_paid_cents);
    }
  });

  it('CSV by year: total_paid_usd is the oracle scheduled plus extra, summing to total_paid_cents', () => {
    for (const c of withExtras) {
      const lines = tableCsv(exportsOf(c).table('year')).trim().split('\r\n');
      const header = lines[0]!.split(',');
      expect(header.at(-1), c.id).toBe('total_paid_usd');
      expect(lines.length - 1, c.id).toBe(c.yearly.length);
      let sum = 0;
      c.yearly.forEach((y, i) => {
        const cells = lines[i + 1]!.split(',');
        expect(Number(cells[0]), c.id).toBe(y[0]);
        const total = cents(cells[header.indexOf('total_paid_usd')]);
        expect(total, `${c.id} ${y[0]}`).toBe(y[2]! + y[5]!);
        sum += total;
      });
      expect(sum, c.id).toBe(c.total_paid_cents);
    }
  });

  it('HTML report by payment and by year: Total paid matches the oracle on every row and in the total', () => {
    for (const c of withExtras) {
      const e = exportsOf(c);
      if (c.monthly) {
        const byPayment = scheduleColumn(
          e.report('month'),
          'Each payment: principal, interest and the balance left',
          '<thead><tr><th scope="col">Payment</th><th scope="col" class="num">Total paid</th><th scope="col" class="num">Regular payment</th>',
          0,
        );
        expect(byPayment.body.length, c.id).toBe(c.monthly.length);
        c.monthly.forEach((m, i) => {
          expect(byPayment.body[i]![0], c.id).toMatch(new RegExp(`\\(#${m[0]}\\)$`));
          expect(byPayment.body[i]![1], `${c.id} payment ${m[0]}`).toBe(formatUSD(m[3]! + m[6]!));
        });
        expect(byPayment.total, c.id).toBe(formatUSD(c.total_paid_cents));
      }
      // The year table's first figure is the number of payments; Total paid is the second.
      const byYear = scheduleColumn(
        e.report('year'),
        'Each calendar year: payments, principal, interest and the balance left',
        '<thead><tr><th scope="col">Year</th><th scope="col" class="num">Payments</th><th scope="col" class="num">Total paid</th>',
        1,
      );
      expect(byYear.body.map(([head]) => Number(head)), c.id).toEqual(c.yearly.map((y) => y[0]));
      c.yearly.forEach((y, i) => expect(byYear.body[i]![1], `${c.id} ${y[0]}`).toBe(formatUSD(y[2]! + y[5]!)));
      expect(byYear.total, c.id).toBe(formatUSD(c.total_paid_cents));
    }
  });
});

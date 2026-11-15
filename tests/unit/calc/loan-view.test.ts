import { describe, expect, it } from 'vitest';
import { formatUSD } from '../../../src/lib/calc/format';
import {
  amortizationReport,
  breakdownGroups,
  breakdownLines,
  durationText,
  ESCROW_GROUP,
  HOA_GROUP,
  loanIssueMessage,
  loanTable,
  nextMonth,
  payoffReport,
  payoffShareState,
  payoffView,
  termMonths,
} from '../../../src/lib/calc/loan-view';
import { loanPlan, paymentBreakdown, payoffComparison } from '../../../src/lib/engines/loan-report';
import { reportBody } from '../../../src/lib/report/report';
import { tableCsv } from '../../../src/lib/report/table';

const FIRST = { year: 2027, month: 1 };
const WHEN = new Date(2026, 10, 15);

function mortgage() {
  const loan = { principal: 20_000_000, annualRate: 0.06, termMonths: 360, extraMonthly: 10_000, oneTime: [{ month: 13, amount: 500_000 }] };
  const c = payoffComparison(loan, FIRST);
  if (!c.ok) throw new Error('invalid');
  return { loan, c: c.value };
}

describe('loan view', () => {
  it('words durations and terms plainly', () => {
    expect(durationText(102)).toBe('8 years 6 months');
    expect(durationText(12)).toBe('1 year');
    expect(durationText(1)).toBe('1 month');
    expect(durationText(0)).toBe('0 months');
    expect(termMonths(30, 'years')).toBe(360);
    expect(termMonths(72, 'months')).toBe(72);
    expect(nextMonth(new Date(2026, 11, 3))).toEqual({ year: 2027, month: 1 });
  });

  it('puts the same figures in the table and the CSV, by payment and by year', () => {
    const { c } = mortgage();
    for (const g of ['month', 'year'] as const) {
      const t = loanTable(c.accelerated, g, { extra: true, baseline: c.baseline });
      const lines = tableCsv(t).trim().split('\r\n');
      expect(lines).toHaveLength(t.count + 1);
      const header = t.csvHeader;
      for (const i of [0, Math.floor(t.count / 2), t.count - 1]) {
        const csv = t.csvRow(i);
        const row = t.row(i);
        const money = (name: string) => formatUSD(Math.round(Number(csv[header.indexOf(name)]) * 100));
        const balanceName = g === 'month' ? 'balance_usd' : 'end_balance_usd';
        const balanceCol = t.columns.findIndex((col) => col.label === (g === 'month' ? 'Remaining balance' : 'Balance at year end')) - 1;
        expect(money(balanceName), `${g} ${i}`).toBe(row.cells[balanceCol]);
        expect(money('interest_usd'), `${g} ${i}`).toBe(row.cells[t.columns.findIndex((col) => col.label === 'Interest') - 1]);
        expect(money('extra_usd'), `${g} ${i}`).toBe(row.cells[t.columns.findIndex((col) => col.label === 'Extra') - 1]);
      }
    }
  });

  it('totals the year table to the loan: all interest, every payment, nothing left', () => {
    const { c } = mortgage();
    const t = loanTable(c.accelerated, 'year', { extra: true });
    expect(t.footer!.cells[0]).toBe(String(c.accelerated.schedule.months));
    expect(t.footer!.cells[3]).toBe(formatUSD(c.accelerated.schedule.totalInterest));
    expect(t.footer!.cells[5]).toBe('$0.00');
  });

  it('states the savings, or that there are none yet', () => {
    const { c } = mortgage();
    const v = payoffView(c);
    expect(v.hero).toBe(formatUSD(c.interestSaved));
    expect(v.summary).toMatch(/^With the extra payments the loan is paid off in [A-Z][a-z]{2} \d{4} instead of Dec 2056, /);
    const none = payoffComparison({ principal: 20_000_000, annualRate: 0.06, termMonths: 360 }, FIRST);
    if (!none.ok) throw new Error('invalid');
    expect(payoffView(none.value).heroNote).toBe('saved: no extra payments entered yet');
  });

  it('builds reports with the comparison, the payment breakdown and principal versus interest', () => {
    const { loan, c } = mortgage();
    const brk = paymentBreakdown(c.accelerated.schedule.payment, { propertyTaxAnnual: 360_000, insuranceAnnual: 150_000, mortgageInsuranceMonthly: 0, hoaMonthly: 0 });
    if (!brk.ok) throw new Error('invalid');
    const payoff = reportBody(payoffReport(loan, FIRST, { propertyTaxAnnual: 360_000, insuranceAnnual: 150_000, mortgageInsuranceMonthly: 0, hoaMonthly: 0 }, c, brk.value, 'year', WHEN));
    expect(payoff).toContain('<h2>With and without the extra payments</h2>');
    expect(payoff).toContain('<h2>Monthly housing costs</h2>');
    expect(payoff).toContain('One-time payment 1');
    const plan = loanPlan({ principal: 3_000_000, annualRate: 0.07, termMonths: 60 }, FIRST);
    if (!plan.ok) throw new Error('invalid');
    const amort = reportBody(amortizationReport({ principal: 3_000_000, annualRate: 0.07, termMonths: 60 }, FIRST, plan.value, 'month', WHEN));
    expect(amort).toContain('<h2>Principal versus interest</h2>');
    expect(amort).toContain('Share of all payments');
    expect(amort.match(/<tr><th scope="row">[A-Z][a-z]{2} \d{4} \(#\d+\)/g)).toHaveLength(60);
  });

  it('keeps HOA dues out of the mortgage payment and labels the total as a housing-cost estimate', () => {
    const { loan, c } = mortgage();
    const costs = { propertyTaxAnnual: 360_000, insuranceAnnual: 150_000, mortgageInsuranceMonthly: 0, hoaMonthly: 25_000 };
    const brk = paymentBreakdown(c.accelerated.schedule.payment, costs);
    if (!brk.ok) throw new Error('invalid');
    const report = payoffReport(loan, FIRST, costs, c, brk.value, 'year', WHEN);
    const body = reportBody(report);
    expect(body).toContain('HOA dues (not part of the mortgage payment)');
    expect(body).toContain('Estimated total monthly housing cost');
    expect(body).not.toContain('Total monthly payment');
    expect(report.summary).toContainEqual({ label: 'Estimated total monthly housing cost (HOA dues included)', value: formatUSD(brk.value.total) });
    expect(report.summary).toContainEqual({ label: 'Estimated monthly mortgage payment (with escrow and mortgage insurance)', value: formatUSD(brk.value.mortgagePayment) });
  });

  it('lists the breakdown in order with the escrow and mortgage payment subtotals, HOA dues outside', () => {
    const b = paymentBreakdown(119_910, { propertyTaxAnnual: 360_000, insuranceAnnual: 150_000, mortgageInsuranceMonthly: 9_000, hoaMonthly: 25_000 });
    if (!b.ok) throw new Error('invalid');
    const groups = breakdownGroups(b.value);
    expect(groups.map((g) => g.heading)).toEqual([null, ESCROW_GROUP, null, HOA_GROUP, null]);
    expect(breakdownLines(b.value).map((l) => [l.key, l.value, l.kind])).toEqual([
      ['pi', '$1,199.10', 'item'],
      ['tax', '$300.00', 'item'],
      ['insurance', '$125.00', 'item'],
      ['escrow', '$425.00', 'subtotal'],
      ['mi', '$90.00', 'item'],
      ['mortgage', '$1,714.10', 'total'],
      ['hoa', '$250.00', 'item'],
      ['total', '$1,964.10', 'total'],
    ]);
  });

  it('shows zero optional costs as $0.00, with the mortgage payment and the total equal to principal and interest', () => {
    const { loan, c } = mortgage();
    const costs = { propertyTaxAnnual: 0, insuranceAnnual: 0, mortgageInsuranceMonthly: 0, hoaMonthly: 0 };
    const b = paymentBreakdown(c.accelerated.schedule.payment, costs);
    if (!b.ok) throw new Error('invalid');
    const pi = formatUSD(c.accelerated.schedule.payment);
    expect(Object.fromEntries(breakdownLines(b.value).map((l) => [l.key, l.value]))).toEqual({
      pi,
      tax: '$0.00',
      insurance: '$0.00',
      escrow: '$0.00',
      mi: '$0.00',
      mortgage: pi,
      hoa: '$0.00',
      total: pi,
    });
    const body = reportBody(payoffReport(loan, FIRST, costs, c, b.value, 'year', WHEN));
    expect(body).toContain(`<tr class="rmf-report__strong"><th scope="row">Estimated mortgage payment (to the lender)</th><td>${pi}</td></tr>`);
    expect(body).toContain(`<tfoot><tr><th scope="row">Estimated total monthly housing cost</th><td>${pi}</td></tr></tfoot>`);
    expect(body).toContain('<tr><th scope="row">HOA dues (not part of the mortgage payment)</th><td>$0.00</td></tr>');
  });

  it('puts every breakdown line in the report with the same figures as the page view', () => {
    const { loan, c } = mortgage();
    const costs = { propertyTaxAnnual: 240_006, insuranceAnnual: 150_001, mortgageInsuranceMonthly: 4_321, hoaMonthly: 27_550 };
    const b = paymentBreakdown(c.accelerated.schedule.payment, costs);
    if (!b.ok) throw new Error('invalid');
    const body = reportBody(payoffReport(loan, FIRST, costs, c, b.value, 'year', WHEN));
    for (const line of breakdownLines(b.value)) expect(body, line.key).toContain(`<th scope="row">${line.reportLabel}</th><td>${line.value}</td>`);
    expect(b.value.propertyTax).toBe(20_001);
    expect(b.value.total).toBe(b.value.mortgagePayment + 27_550);
  });

  it('shares only the amounts that are set, and maps engine problems to their fields', () => {
    const { loan } = mortgage();
    const state = payoffShareState(loan, { value: 30, unit: 'years' }, FIRST, { propertyTaxAnnual: 0, insuranceAnnual: 150_000, mortgageInsuranceMonthly: 0, hoaMonthly: 0 });
    expect(state).toEqual({ p: 20_000_000, r: '6', t: 30, u: 'years', fy: 2027, fm: 1, x: 10_000, o1: 13, o1a: 500_000, in: 150_000 });
    expect(loanIssueMessage({ field: 'annualRate', code: 'payment-does-not-cover-interest' }).field).toBe('rate');
    expect(loanIssueMessage({ field: 'oneTime[2].month', code: 'above-maximum', limit: 360 })).toEqual({ field: 'o3', message: 'This payment is after the last one of the loan.' });
    expect(loanIssueMessage({ field: 'termMonths', code: 'above-maximum', limit: 600 }).field).toBe('term');
  });
});

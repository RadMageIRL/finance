// Loan schedules by month and calendar year, the payoff comparison and the payment breakdown
// (ENGINE_CONVENTIONS section 13) against the independent Python oracle (loan_reports.json),
// plus the invariants: dates roll over December, years add up, and extra payments never
// increase interest or months.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amortize } from '../../../src/lib/engines/loan';
import { loanPlan, paymentBreakdown, paymentDate, payoffComparison, type HousingCosts } from '../../../src/lib/engines/loan-report';
import { rng } from '../../support/random';

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
  payment_cents: number;
  months: number;
  total_interest_cents: number;
  total_paid_cents: number;
  payoff: [number, number];
  yearly: number[][];
  monthly?: number[][];
  baseline: { months: number; total_interest_cents: number; payoff: [number, number] };
  months_saved: number;
  interest_saved_cents: number;
  breakdown: { property_tax_cents: number; insurance_cents: number; mortgage_insurance_cents: number; hoa_cents: number; total_monthly_cents: number };
}

const inputOf = (c: Case) => ({
  principal: c.principal_cents,
  annualRate: Number(c.annual_rate),
  termMonths: c.term_months,
  extraMonthly: c.extra_monthly_cents,
  oneTime: c.one_time.map(([month, amount]) => ({ month, amount })),
});
const firstOf = (c: Case) => ({ year: c.first_payment[0], month: c.first_payment[1] });
const costsOf = (c: Case): HousingCosts => ({
  propertyTaxAnnual: c.property_tax_annual_cents,
  insuranceAnnual: c.insurance_annual_cents,
  mortgageInsuranceMonthly: c.mortgage_insurance_monthly_cents,
  hoaMonthly: c.hoa_monthly_cents,
});

describe('loan reports against the oracle', () => {
  const cases = fixture.cases as Case[];

  it('has cases with extra payments, monthly rows and housing costs', () => {
    expect(fixture.conventions).toBe('v1.5');
    expect(cases.some((c) => c.extra_monthly_cents > 0)).toBe(true);
    expect(cases.some((c) => c.one_time.length > 1)).toBe(true);
    expect(cases.some((c) => c.monthly)).toBe(true);
    expect(cases.some((c) => c.property_tax_annual_cents % 12 !== 0)).toBe(true);
  });

  for (const c of cases) {
    it(`matches every month, every year, the comparison and the breakdown: ${c.id}`, () => {
      const r = payoffComparison(inputOf(c), firstOf(c));
      if (!r.ok) throw new Error(`${c.id}: ${JSON.stringify(r.issues)}`);
      const { accelerated: a, baseline: b } = r.value;
      expect([a.schedule.payment, a.schedule.months, a.schedule.totalInterest, a.schedule.totalPaid]).toEqual([c.payment_cents, c.months, c.total_interest_cents, c.total_paid_cents]);
      expect([a.payoff.year, a.payoff.month]).toEqual(c.payoff);
      expect(a.years.map((y) => [y.year, y.payments, y.scheduled, y.principal, y.interest, y.extra, y.endBalance, y.cumulativeInterest, y.cumulativePrincipal])).toEqual(c.yearly);
      if (c.monthly) {
        expect(a.months.map((m) => [m.month, m.date.year, m.date.month, m.payment, m.interest, m.principal, m.extra, m.balance, m.cumulativeInterest, m.cumulativePrincipal])).toEqual(c.monthly);
      }
      expect([b.schedule.months, b.schedule.totalInterest, b.payoff.year, b.payoff.month]).toEqual([c.baseline.months, c.baseline.total_interest_cents, ...c.baseline.payoff]);
      expect([r.value.monthsSaved, r.value.interestSaved]).toEqual([c.months_saved, c.interest_saved_cents]);
      const brk = paymentBreakdown(a.schedule.payment, costsOf(c));
      if (!brk.ok) throw new Error('breakdown refused');
      expect([brk.value.propertyTax, brk.value.insurance, brk.value.mortgageInsurance, brk.value.hoa, brk.value.total]).toEqual([
        c.breakdown.property_tax_cents,
        c.breakdown.insurance_cents,
        c.breakdown.mortgage_insurance_cents,
        c.breakdown.hoa_cents,
        c.breakdown.total_monthly_cents,
      ]);
    });
  }
});

describe('loan report rules', () => {
  it('dates payments month by month, rolling into the next year after December', () => {
    expect(paymentDate({ year: 2026, month: 12 }, 1)).toEqual({ year: 2026, month: 12 });
    expect(paymentDate({ year: 2026, month: 12 }, 2)).toEqual({ year: 2027, month: 1 });
    expect(paymentDate({ year: 2027, month: 1 }, 360)).toEqual({ year: 2056, month: 12 });
    expect(paymentDate({ year: 2027, month: 7 }, 13)).toEqual({ year: 2028, month: 7 });
  });

  it('groups payments into calendar years whose principal adds up to the loan', () => {
    const r = loanPlan({ principal: 20_000_000, annualRate: 0.06, termMonths: 360 }, { year: 2027, month: 7 });
    if (!r.ok) throw new Error('invalid');
    const years = r.value.years;
    expect(years.map((y) => y.payments)).toEqual([6, ...Array(29).fill(12), 6]);
    expect(years.reduce((s, y) => s + y.principal + y.extra, 0)).toBe(20_000_000);
    expect(years.reduce((s, y) => s + y.interest, 0)).toBe(r.value.schedule.totalInterest);
    let before = 20_000_000;
    for (const y of years) {
      expect(before - y.principal - y.extra, String(y.year)).toBe(y.endBalance);
      before = y.endBalance;
    }
    expect(r.value.payoff).toEqual({ year: 2057, month: 6 });
  });

  it('never lets extra payments increase interest or months, over random loans', () => {
    const r0 = rng(1726);
    const random = () => r0.next();
    for (let k = 0; k < 300; k += 1) {
      const principal = 100_000 + Math.floor(random() * 99_900_000);
      const annualRate = Math.round(random() * 1500) / 10_000;
      const termMonths = 12 + Math.floor(random() * 349);
      const extraMonthly = Math.floor(random() * 200_000);
      const oneTime = random() < 0.5 ? [{ month: 1 + Math.floor(random() * termMonths), amount: 1 + Math.floor(random() * 5_000_000) }] : [];
      const r = payoffComparison({ principal, annualRate, termMonths, extraMonthly, oneTime }, { year: 2027, month: 1 });
      if (!r.ok) continue;
      expect(r.value.interestSaved, `case ${k}`).toBeGreaterThanOrEqual(0);
      expect(r.value.monthsSaved, `case ${k}`).toBeGreaterThanOrEqual(0);
      const base = amortize({ principal, annualRate, termMonths });
      expect(base.ok && base.value.totalInterest).toBe(r.value.baseline.schedule.totalInterest);
    }
  });

  it('saves nothing when there are no extra payments', () => {
    const r = payoffComparison({ principal: 20_000_000, annualRate: 0.06, termMonths: 360 }, { year: 2027, month: 1 });
    if (!r.ok) throw new Error('invalid');
    expect([r.value.monthsSaved, r.value.interestSaved]).toEqual([0, 0]);
  });

  it('rounds a twelfth of an annual cost half up, and keeps costs out of the loan', () => {
    const r = paymentBreakdown(119_910, { propertyTaxAnnual: 6, insuranceAnnual: 360_100, mortgageInsuranceMonthly: 5_000, hoaMonthly: 2_500 });
    if (!r.ok) throw new Error('invalid');
    expect(r.value).toEqual({ principalAndInterest: 119_910, propertyTax: 1, insurance: 30_008, mortgageInsurance: 5_000, hoa: 2_500, total: 119_910 + 1 + 30_008 + 5_000 + 2_500 });
  });

  it('refuses a first payment outside 1970 to 2200 or a negative cost, with the loan problems too', () => {
    const r = loanPlan({ principal: 0, annualRate: 0.06, termMonths: 12 }, { year: 1969, month: 13 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.field)).toEqual(['principal', 'firstPayment.year', 'firstPayment.month']);
    const b = paymentBreakdown(100, { propertyTaxAnnual: -1, insuranceAnnual: 0, mortgageInsuranceMonthly: 0, hoaMonthly: 0 });
    expect(b.ok).toBe(false);
  });
});

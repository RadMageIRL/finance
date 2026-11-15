// Loan schedules by month and calendar year, the payoff comparison and the monthly payment
// breakdown (ENGINE_CONVENTIONS section 13, v1.6). Pure. The amortization itself is
// section 6 (loan.ts); nothing here changes how interest or payments are figured.

import { amortize, LOAN_LIMITS, type LoanInput, type LoanRow, type LoanSchedule } from './loan';
import { MAX_CENTS, roundCents, type Cents } from './money';
import { Checker, type Result } from './validate';

export interface PaymentDate {
  year: number;
  /** 1 to 12. */
  month: number;
}

export interface HousingCosts {
  propertyTaxAnnual: Cents;
  insuranceAnnual: Cents;
  mortgageInsuranceMonthly: Cents;
  hoaMonthly: Cents;
}

export const NO_HOUSING_COSTS: HousingCosts = { propertyTaxAnnual: 0, insuranceAnnual: 0, mortgageInsuranceMonthly: 0, hoaMonthly: 0 };

export const FIRST_PAYMENT_LIMITS = { year: { min: 1970, max: 2200, integer: true }, month: { min: 1, max: 12, integer: true } } as const;
const COST_LIMIT = { min: 0, max: MAX_CENTS, integer: true } as const;

export interface LoanMonthRow extends LoanRow {
  date: PaymentDate;
  cumulativeInterest: Cents;
  /** Principal plus extra, this row and every earlier one. */
  cumulativePrincipal: Cents;
}

export interface LoanYearRow {
  year: number;
  /** First and last payment numbers (1-based) in the year. */
  firstMonth: number;
  lastMonth: number;
  payments: number;
  scheduled: Cents;
  principal: Cents;
  interest: Cents;
  extra: Cents;
  endBalance: Cents;
  cumulativeInterest: Cents;
  cumulativePrincipal: Cents;
}

export interface LoanPlan {
  schedule: LoanSchedule;
  months: LoanMonthRow[];
  years: LoanYearRow[];
  payoff: PaymentDate;
}

export interface PayoffComparison {
  baseline: LoanPlan;
  accelerated: LoanPlan;
  monthsSaved: number;
  interestSaved: Cents;
}

export interface PaymentBreakdown {
  principalAndInterest: Cents;
  propertyTax: Cents;
  insurance: Cents;
  /** Property tax plus homeowners insurance: the escrow items modeled (conventions 13.5, v1.6). */
  escrow: Cents;
  mortgageInsurance: Cents;
  /** Principal and interest plus escrow plus mortgage insurance: paid to the lender, HOA dues excluded (v1.6). */
  mortgagePayment: Cents;
  hoa: Cents;
  /** The estimated total monthly housing cost: the mortgage payment plus HOA dues. */
  total: Cents;
}

/** The date of payment k (1-based): the first payment's month plus k - 1 (conventions 13.2). */
export function paymentDate(first: PaymentDate, k: number): PaymentDate {
  const index = first.year * 12 + (first.month - 1) + (k - 1);
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Month rows with dates and running totals (conventions 13.3). */
export function loanMonths(schedule: LoanSchedule, first: PaymentDate): LoanMonthRow[] {
  let interest = 0;
  let principal = 0;
  return schedule.rows.map((row) => {
    interest += row.interest;
    principal += row.principal + row.extra;
    return { ...row, date: paymentDate(first, row.month), cumulativeInterest: interest, cumulativePrincipal: principal };
  });
}

/** Calendar-year rows: every payment dated in the year, summed (conventions 13.3). */
export function loanYears(months: readonly LoanMonthRow[]): LoanYearRow[] {
  const out: LoanYearRow[] = [];
  for (const m of months) {
    let y = out[out.length - 1];
    if (!y || y.year !== m.date.year) {
      y = { year: m.date.year, firstMonth: m.month, lastMonth: m.month, payments: 0, scheduled: 0, principal: 0, interest: 0, extra: 0, endBalance: 0, cumulativeInterest: 0, cumulativePrincipal: 0 };
      out.push(y);
    }
    y.lastMonth = m.month;
    y.payments += 1;
    y.scheduled += m.payment;
    y.principal += m.principal;
    y.interest += m.interest;
    y.extra += m.extra;
    y.endBalance = m.balance;
    y.cumulativeInterest = m.cumulativeInterest;
    y.cumulativePrincipal = m.cumulativePrincipal;
  }
  return out;
}

function checkFirstPayment(check: Checker, first: PaymentDate): void {
  check.number('firstPayment.year', first.year, FIRST_PAYMENT_LIMITS.year);
  check.number('firstPayment.month', first.month, FIRST_PAYMENT_LIMITS.month);
}

function plan(schedule: LoanSchedule, first: PaymentDate): LoanPlan {
  const months = loanMonths(schedule, first);
  return { schedule, months, years: loanYears(months), payoff: months[months.length - 1]!.date };
}

/** A loan's schedule by month and calendar year, with its payoff date. */
export function loanPlan(input: LoanInput, first: PaymentDate): Result<LoanPlan> {
  const check = new Checker();
  checkFirstPayment(check, first);
  const schedule = amortize(input);
  if (!schedule.ok) return { ok: false, issues: [...schedule.issues, ...check.issues] };
  if (!check.ok) return check.fail();
  return { ok: true, value: plan(schedule.value, first) };
}

/** The loan as entered against the same loan with no extra payments (conventions 13.4). */
export function payoffComparison(input: LoanInput, first: PaymentDate): Result<PayoffComparison> {
  const accelerated = loanPlan(input, first);
  if (!accelerated.ok) return accelerated;
  const baseline = loanPlan({ principal: input.principal, annualRate: input.annualRate, termMonths: input.termMonths }, first);
  if (!baseline.ok) return baseline;
  const a = accelerated.value;
  const b = baseline.value;
  return {
    ok: true,
    value: {
      baseline: b,
      accelerated: a,
      monthsSaved: b.schedule.months - a.schedule.months,
      interestSaved: b.schedule.totalInterest - a.schedule.totalInterest,
    },
  };
}

export function validateHousingCosts(costs: HousingCosts): Checker {
  const check = new Checker();
  check.number('propertyTaxAnnual', costs.propertyTaxAnnual, COST_LIMIT);
  check.number('insuranceAnnual', costs.insuranceAnnual, COST_LIMIT);
  check.number('mortgageInsuranceMonthly', costs.mortgageInsuranceMonthly, COST_LIMIT);
  check.number('hoaMonthly', costs.hoaMonthly, COST_LIMIT);
  return check;
}

/** Principal and interest kept apart from the other monthly housing costs, with the escrow and mortgage payment subtotals (conventions 13.5, v1.6). */
export function paymentBreakdown(payment: Cents, costs: HousingCosts): Result<PaymentBreakdown> {
  const check = validateHousingCosts(costs);
  if (!check.ok) return check.fail();
  const propertyTax = roundCents(costs.propertyTaxAnnual / 12);
  const insurance = roundCents(costs.insuranceAnnual / 12);
  const escrow = propertyTax + insurance;
  const mortgagePayment = payment + escrow + costs.mortgageInsuranceMonthly;
  return {
    ok: true,
    value: {
      principalAndInterest: payment,
      propertyTax,
      insurance,
      escrow,
      mortgageInsurance: costs.mortgageInsuranceMonthly,
      mortgagePayment,
      hoa: costs.hoaMonthly,
      total: mortgagePayment + costs.hoaMonthly,
    },
  };
}

export { LOAN_LIMITS };

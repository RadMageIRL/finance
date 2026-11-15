// Loan payment and amortization engine (ENGINE_CONVENTIONS section 6). Pure.
//
// Monthly rate = annual note rate / 12. The scheduled payment is rounded to the cent; each
// month's interest is rounded to the cent when posted; extra principal is applied after
// the scheduled payment; the final payment pays the remaining balance plus that month's
// interest, which absorbs any residual left by the rounded payment.

import { MAX_CENTS, periodicInterest, roundCents, type Cents } from './money';
import { Checker, type Result } from './validate';

export interface OneTimePayment {
  /** 1-based month number. */
  month: number;
  amount: Cents;
}

export interface LoanInput {
  principal: Cents;
  /** Note rate, as a fraction (not the Regulation Z APR). */
  annualRate: number;
  termMonths: number;
  extraMonthly?: Cents;
  oneTime?: readonly OneTimePayment[];
}

export interface LoanRow {
  month: number;
  /** The scheduled part of the payment (the final row's is balance plus interest). */
  payment: Cents;
  interest: Cents;
  /** Principal repaid by the scheduled payment. */
  principal: Cents;
  /** Extra principal actually applied this month. */
  extra: Cents;
  balance: Cents;
}

export interface LoanSchedule {
  payment: Cents;
  rows: LoanRow[];
  months: number;
  totalInterest: Cents;
  totalPaid: Cents;
}

export const LOAN_LIMITS = {
  principal: { min: 1, max: MAX_CENTS, integer: true },
  annualRate: { min: 0, max: 1 },
  termMonths: { min: 1, max: 600, integer: true },
  extraMonthly: { min: 0, max: MAX_CENTS, integer: true },
  oneTimeAmount: { min: 1, max: MAX_CENTS, integer: true },
} as const;

/** Interest for one month on a balance: balance x rate / 12, posted exactly to the cent. */
export function monthlyInterest(balance: Cents, annualRate: number): Cents {
  return periodicInterest(balance, annualRate, 12);
}

/**
 * The scheduled monthly payment, rounded to the cent: P i / (1 - (1+i)^-N), or P / N at a
 * zero rate. Expects validated input.
 */
export function scheduledPayment(principal: Cents, annualRate: number, termMonths: number): Cents {
  if (annualRate === 0) return roundCents(principal / termMonths);
  const i = annualRate / 12;
  // 1 - (1+i)^-N written with expm1/log1p for accuracy at small rates.
  const discount = -Math.expm1(-termMonths * Math.log1p(i));
  return roundCents((principal * i) / discount);
}

export function validateLoan(input: LoanInput): Checker {
  const check = new Checker();
  check.number('principal', input.principal, LOAN_LIMITS.principal);
  check.number('annualRate', input.annualRate, LOAN_LIMITS.annualRate);
  const termOk = check.number('termMonths', input.termMonths, LOAN_LIMITS.termMonths);
  check.number('extraMonthly', input.extraMonthly ?? 0, LOAN_LIMITS.extraMonthly);
  (input.oneTime ?? []).forEach((entry, index) => {
    check.number(`oneTime[${index}].month`, entry.month, {
      min: 1,
      max: termOk ? input.termMonths : LOAN_LIMITS.termMonths.max,
      integer: true,
    });
    check.number(`oneTime[${index}].amount`, entry.amount, LOAN_LIMITS.oneTimeAmount);
  });
  return check;
}

export function amortize(input: LoanInput): Result<LoanSchedule> {
  const check = validateLoan(input);
  if (!check.ok) return check.fail();

  const { principal, annualRate, termMonths } = input;
  const extraMonthly = input.extraMonthly ?? 0;
  const oneTimeByMonth = new Map<number, Cents>();
  for (const entry of input.oneTime ?? []) {
    oneTimeByMonth.set(entry.month, (oneTimeByMonth.get(entry.month) ?? 0) + entry.amount);
  }

  const payment = scheduledPayment(principal, annualRate, termMonths);
  if (annualRate > 0 && payment <= monthlyInterest(principal, annualRate)) {
    check.add({ field: 'annualRate', code: 'payment-does-not-cover-interest' });
    return check.fail();
  }

  const rows: LoanRow[] = [];
  let balance = principal;
  let totalInterest = 0;
  let totalPaid = 0;

  // Bounded by the term: the final-payment rule always ends the loan by month N.
  for (let month = 1; month <= termMonths && balance > 0; month += 1) {
    const interest = monthlyInterest(balance, annualRate);
    totalInterest += interest;

    if (month === termMonths || balance + interest <= payment) {
      const finalPayment = balance + interest;
      rows.push({ month, payment: finalPayment, interest, principal: balance, extra: 0, balance: 0 });
      totalPaid += finalPayment;
      balance = 0;
      break;
    }

    const scheduledPrincipal = payment - interest;
    balance -= scheduledPrincipal;
    const extra = Math.min(extraMonthly + (oneTimeByMonth.get(month) ?? 0), balance);
    balance -= extra;
    rows.push({ month, payment, interest, principal: scheduledPrincipal, extra, balance });
    totalPaid += payment + extra;
  }

  if (balance !== 0) throw new Error('amortize: a balance remains after the final month');
  return { ok: true, value: { payment, rows, months: rows.length, totalInterest, totalPaid } };
}

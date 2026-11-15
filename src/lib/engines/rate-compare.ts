// Deposit rate comparison for the APR/APY calculator (ENGINE_CONVENTIONS section 3). Pure.
//
// Each account is described by either its interest rate (Regulation DD: the annual rate
// that does not reflect compounding, which a bank may also call its annual percentage rate)
// or its annual percentage yield, plus how often it compounds. The other figure follows from
// the section 3 conversions. Interest on a reference balance is the interest a single
// deposit left untouched for one 365-day year earns at that APY, rounded once to the cent.

import { MAX_CENTS, roundCents, roundPercent2, type Cents } from './money';
import { apyFromNominal, COMPOUNDING_FREQUENCIES, nominalFromApy, type CompoundingFrequency } from './rates';
import { Checker, type Result } from './validate';

export type RateKind = 'rate' | 'apy';

export interface RateAccountInput {
  /** Which figure the visitor knows. */
  kind: RateKind;
  /** That figure as a fraction: 5% is 0.05. */
  value: number;
  periodsPerYear: CompoundingFrequency;
}

export interface RateAccount {
  /** The position of the account in the input (0, 1, 2). */
  index: number;
  kind: RateKind;
  periodsPerYear: CompoundingFrequency;
  /** Interest rate (nominal annual rate), unrounded fraction. */
  annualRate: number;
  /** APY, unrounded fraction. */
  apy: number;
  /** APY in percent rounded to 0.01 point (12 CFR 1030.3(f)(1)). */
  apyPercent: number;
  /** Rate for one compounding period, unrounded fraction. */
  periodicRate: number;
  /** Interest on the reference balance over one 365-day year at this APY, in cents. */
  oneYearInterest: Cents;
}

export interface RateComparison {
  balance: Cents;
  accounts: RateAccount[];
  /** Indexes of the accounts with the highest unrounded APY (more than one on a tie). */
  best: number[];
}

export const RATE_LIMITS = {
  value: { min: 0, max: 1 },
  balance: { min: 1, max: MAX_CENTS, integer: true },
} as const;

export const MAX_ACCOUNTS = 3;

/**
 * Compares up to three accounts. A null entry is an account slot left empty; at least one
 * account is required.
 */
export function compareRates(accounts: readonly (RateAccountInput | null)[], balance: Cents): Result<RateComparison> {
  const check = new Checker();
  check.number('balance', balance, RATE_LIMITS.balance);
  if (accounts.length > MAX_ACCOUNTS) check.add({ field: 'accounts', code: 'above-maximum', limit: MAX_ACCOUNTS });
  if (!accounts.some((a) => a)) check.add({ field: 'accounts', code: 'below-minimum', limit: 1 });
  accounts.forEach((a, i) => {
    if (!a) return;
    check.oneOf(`accounts[${i}].kind`, a.kind, ['rate', 'apy'] as const);
    check.number(`accounts[${i}].value`, a.value, RATE_LIMITS.value);
    check.oneOf(`accounts[${i}].periodsPerYear`, a.periodsPerYear, COMPOUNDING_FREQUENCIES);
  });
  if (!check.ok) return check.fail();

  const out: RateAccount[] = [];
  accounts.forEach((a, index) => {
    if (!a) return;
    const n = a.periodsPerYear;
    const annualRate = a.kind === 'rate' ? a.value : nominalFromApy(a.value, n);
    const apy = a.kind === 'apy' ? a.value : apyFromNominal(a.value, n);
    out.push({
      index,
      kind: a.kind,
      periodsPerYear: n,
      annualRate,
      apy,
      apyPercent: roundPercent2(apy * 100),
      periodicRate: annualRate / n,
      oneYearInterest: roundCents(balance * apy),
    });
  });
  const top = Math.max(...out.map((a) => a.apy));
  return { ok: true, value: { balance, accounts: out, best: out.filter((a) => a.apy === top).map((a) => a.index) } };
}

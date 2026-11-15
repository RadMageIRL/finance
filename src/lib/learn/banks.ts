// How Banks Create Money: the opening balance sheets and the guided steps. The ledger engine
// does every posting and enforces the accounting rules; the loan payment comes from the
// amortization engine. Amounts are illustrative, in integer cents.

import { bankLends, payInterest, payment, repayPrincipal, writeOff } from '../engines/ledger/catalog';
import { claimAmount, createState, type ClaimAmount, type EntityId, type LedgerState } from '../engines/ledger/model';
import { amortize } from '../engines/loan';
import { formatUSD } from '../calc/format';
import type { Counters, GuidedStep } from './sim';

/** The balance sheets the lesson shows, in order. */
export const BANK_LESSON_ENTITIES: readonly EntityId[] = ['H1', 'Business', 'BankA', 'BankB', 'Fed'];

/**
 * A small, balanced opening position: two banks holding reserves and Treasury securities,
 * funded by deposits, each with equity of a fifth of its assets. Bank B holds more of its
 * assets as reserves, so it can lend reserves to Bank A when Bank A runs short. The Fed holds Treasury
 * securities against the reserves and the Treasury's account.
 */
export const BANK_LESSON_OPENING: readonly ClaimAmount[] = [
  { instrument: 'security', holder: 'Fed', issuer: 'Treasury', amount: 1_000_000 },
  { instrument: 'reserves', holder: 'BankA', issuer: 'Fed', amount: 200_000 },
  { instrument: 'reserves', holder: 'BankB', issuer: 'Fed', amount: 600_000 },
  { instrument: 'tga', holder: 'Treasury', issuer: 'Fed', amount: 200_000 },
  { instrument: 'security', holder: 'BankA', issuer: 'Treasury', amount: 800_000 },
  { instrument: 'security', holder: 'BankB', issuer: 'Treasury', amount: 400_000 },
  { instrument: 'deposit', holder: 'H1', issuer: 'BankA', amount: 50_000 },
  { instrument: 'deposit', holder: 'Investor', issuer: 'BankA', amount: 750_000 },
  { instrument: 'deposit', holder: 'Business', issuer: 'BankB', amount: 750_000 },
  { instrument: 'deposit', holder: 'H2', issuer: 'BankB', amount: 50_000 },
];

export const bankLessonOpening = (): LedgerState => createState(BANK_LESSON_OPENING);

/** The lesson's loan: $1,000 at 12 percent a year, repaid monthly over 12 months. */
export const LESSON_LOAN = { principal: 100_000, annualRate: 0.12, termMonths: 12 } as const;

/** The first monthly payment of the lesson's loan, from the amortization engine. */
export function firstLoanPayment(): { interest: number; principal: number; payment: number } {
  const schedule = amortize(LESSON_LOAN);
  if (!schedule.ok) throw new Error('lesson loan is invalid');
  const row = schedule.value.rows[0]!;
  return { interest: row.interest, principal: row.principal, payment: row.payment };
}

/** A simplified capital rule for the lesson: equity at least this share of assets. */
export const LESSON_CAPITAL_RATIO = 0.05;

const pay = firstLoanPayment();

export const BANK_STEPS: readonly GuidedStep[] = [
  {
    id: 'lend',
    title: 'Bank A makes a loan',
    text: 'Bank A lends Household 1 $1,000 by crediting its account. A loan (an asset of Bank A) and a deposit (a liability of Bank A) appear together. No reserves moved and nobody else\'s deposit fell: the new deposit is new money.',
    make: () => [bankLends('H1', LESSON_LOAN.principal)],
  },
  {
    id: 'spend',
    title: 'The borrower spends the money',
    text: 'Household 1 pays $1,000 to a business that banks at Bank B. The deposit moves to Bank B, and Bank A settles with Bank B by moving $1,000 of reserves at the Federal Reserve. The amount of money does not change; Bank A now has fewer reserves.',
    make: () => [payment('H1', 'Business', LESSON_LOAN.principal)],
  },
  {
    id: 'repay',
    title: 'The first monthly payment, with interest',
    text: `The loan is repaid monthly over a year at 12 percent. The first payment of $${(pay.payment / 100).toFixed(2)} is $${(pay.interest / 100).toFixed(2)} of interest and $${(pay.principal / 100).toFixed(2)} of principal, from the amortization calculator's engine. Repaying principal removes the deposit and the loan together, so money shrinks; the interest becomes Bank A's income, adding to its equity.`,
    make: () => [payInterest('H1', pay.interest), repayPrincipal('H1', pay.principal)],
  },
  {
    id: 'default',
    title: 'The borrower defaults',
    text: 'Household 1 loses its income and cannot pay the rest. Bank A writes off the remaining loan: the asset disappears and the loss comes out of Bank A\'s equity. Deposits are untouched, so the money supply does not change, but the bank is weaker. This is credit risk.',
    make: (s) => [writeOff('H1', claimAmount(s, { instrument: 'loan', holder: 'BankA', issuer: 'H1' }))],
  },
  {
    id: 'shortfall',
    title: 'A bigger loan meets a reserve shortfall',
    text: 'Bank A lends Household 1 $5,000, which it spends at the business. The payment must be settled in reserves, and Bank A no longer has enough. The simulation stops: choose how Bank A gets the reserves. This is liquidity risk.',
    make: () => [bankLends('H1', 500_000), payment('H1', 'Business', 500_000)],
  },
  {
    id: 'capital',
    title: 'A capital rule stops a loan',
    text: 'Now suppose banks must keep equity of at least 5 percent of their assets (a simplified rule; the real ones are described below). Bank A, its equity reduced by the default, tries to lend another $10,000. A loan adds to assets but not to equity, and this one would take Bank A below the rule, so it is refused. This is the capital constraint.',
    make: () => [bankLends('H1', 1_000_000)],
    options: { minCapitalRatio: LESSON_CAPITAL_RATIO },
    refused: true,
  },
];

/** The counters the lesson shows. */
export function bankCounterRows(c: Counters): { label: string; value: string }[] {
  return [
    { label: 'Money in the model', value: formatUSD(c.money) },
    { label: 'Total reserves', value: formatUSD(c.reserves) },
    { label: 'Bank A equity', value: `${formatUSD(c.equity.BankA)} (${c.capitalRatio.BankA.toFixed(1)}% of assets)` },
    { label: 'Bank B equity', value: `${formatUSD(c.equity.BankB)} (${c.capitalRatio.BankB.toFixed(1)}% of assets)` },
  ];
}

export const BANK_OPENING_TEXT = "Two banks hold reserves at the Federal Reserve and Treasury securities, funded by their customers' deposits; each bank's equity is a fifth of its assets. Household 1 banks at Bank A and the business at Bank B. Press Next to make a loan.";

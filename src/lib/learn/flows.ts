// How Money Flows: the opening balance sheets, the guided steps, the free-mode catalog and
// the flow view's layout. The ledger engine does every posting and enforces the accounting
// rules. Amounts are illustrative, in integer cents.

import {
  bankBuysSecurity,
  bankLends,
  bankPays,
  discountWindowLoan,
  fedBuysFromBank,
  fedBuysFromNonbank,
  interbankLoan,
  interestOnReserves,
  mmfReverseRepo,
  payInterest,
  payment,
  payTaxes,
  repayPrincipal,
  treasurySells,
  treasurySpends,
  withdrawCurrency,
  writeOff,
} from '../engines/ledger/catalog';
import type { Transaction } from '../engines/ledger/ledger';
import { createState, ENTITIES, type Bank, type EntityId, type LedgerState, type Nonbank } from '../engines/ledger/model';
import { OPENING_CLAIMS } from '../engines/ledger/scenario';
import { formatUSD } from '../calc/format';
import { WRITE_OFF_NOTE, type Counters, type GuidedStep } from './sim';

/** The engine's opening scenario, read as dollars: 250 becomes $250.00. */
export const flowsOpening = (): LedgerState => createState(OPENING_CLAIMS.map((c) => ({ ...c, amount: c.amount * 100 })));

export const FLOW_ENTITIES: readonly EntityId[] = ENTITIES;

const $ = (dollars: number) => dollars * 100;

export const FLOW_STEPS: readonly GuidedStep[] = [
  {
    id: 'wages',
    title: 'Wages',
    text: 'The business pays Household 2 $50 in wages. Both bank at Bank B, so Bank B simply moves the deposit from one account to the other: no reserves move, and the amount of money is unchanged.',
    make: () => [payment('Business', 'H2', $(50), 'wages')],
  },
  {
    id: 'spending',
    title: 'Spending',
    text: 'Household 1 buys $40 of goods from the business. Household 1 banks at Bank A and the business at Bank B, so the deposit moves between banks and Bank A pays Bank B $40 in reserves at the Federal Reserve.',
    make: () => [payment('H1', 'Business', $(40))],
  },
  {
    id: 'saving',
    title: 'Saving',
    text: 'Household 2 keeps its wages in its account instead of spending them. Saving moves nothing: the deposit is the saving. Money is saved by holding it, and spent by moving it.',
    make: () => [],
  },
  {
    id: 'lending',
    title: 'Lending',
    text: 'Bank B lends the business $100 by crediting its account. A loan and a deposit appear together: new money, created by the bank (see How Banks Create Money).',
    make: () => [bankLends('Business', $(100))],
  },
  {
    id: 'repayment',
    title: 'Loan repayment',
    text: 'The business repays $30 of the loan. The loan and the deposit shrink together, so money is destroyed.',
    make: () => [repayPrincipal('Business', $(30))],
  },
  {
    id: 'interbank-payment',
    title: 'A payment between banks',
    text: 'The business pays Household 1 $60. The deposit moves from Bank B to Bank A, and Bank B settles by moving $60 of reserves to Bank A at the Federal Reserve.',
    make: () => [payment('Business', 'H1', $(60))],
  },
  {
    id: 'taxes',
    title: 'Taxes',
    text: 'Household 1 pays $20 in taxes. Its deposit at Bank A falls, Bank A pays the Treasury in reserves, and the Treasury\'s account at the Federal Reserve (the Treasury General Account) rises. Money held by the public and bank reserves both fall.',
    make: () => [payTaxes('H1', $(20))],
  },
  {
    id: 'spending-gov',
    title: 'Government spending',
    text: 'The Treasury pays Household 2 $50 from its account at the Federal Reserve. The Treasury General Account falls, Bank B\'s reserves rise, and Household 2\'s deposit rises: money and reserves both increase.',
    make: () => [treasurySpends('H2', $(50))],
  },
  {
    id: 'treasury-sale',
    title: 'The Treasury sells a security',
    text: 'The Treasury sells a new $40 security to the investor. The investor pays from its deposit at Bank A, Bank A\'s reserves move to the Treasury General Account, and the investor now holds a Treasury security instead of a deposit.',
    make: () => [treasurySells('Investor', $(40))],
  },
  {
    id: 'fed-purchase',
    title: 'The Federal Reserve buys a security',
    text: 'The Federal Reserve buys a $50 Treasury security from the investor and pays by crediting reserves to the investor\'s bank, which credits the investor\'s deposit. Reserves and money both rise: this is how the central bank adds reserves.',
    make: () => [fedBuysFromNonbank('Investor', $(50))],
  },
];

const NONBANK_IDS: readonly Nonbank[] = ['H1', 'H2', 'Business', 'Investor', 'MMF'];
const BANK_IDS: readonly Bank[] = ['BankA', 'BankB'];

export interface CatalogAction {
  id: string;
  label: string;
  parties: readonly EntityId[];
  counterparties?: readonly EntityId[];
  make: (party: EntityId, counterparty: EntityId | null, cents: number) => Transaction;
  /** A sentence added to the log when the action runs (what the simulation simplifies). */
  note?: string;
}


/** Every transaction the free mode offers: the 16 of the catalog plus payments and wages. */
export const FLOW_CATALOG: readonly CatalogAction[] = [
  { id: 'payment', label: 'Pay someone', parties: NONBANK_IDS, counterparties: NONBANK_IDS, make: (p, c, a) => payment(p as Nonbank, c as Nonbank, a) },
  { id: 'lend', label: 'A bank lends to its customer', parties: NONBANK_IDS, make: (p, _c, a) => bankLends(p as Nonbank, a) },
  { id: 'repay', label: 'Repay loan principal', parties: NONBANK_IDS, make: (p, _c, a) => repayPrincipal(p as Nonbank, a) },
  { id: 'interest', label: 'Pay loan interest', parties: NONBANK_IDS, make: (p, _c, a) => payInterest(p as Nonbank, a) },
  { id: 'write-off', label: 'A bank writes off and forgives a loan', parties: NONBANK_IDS, make: (p, _c, a) => writeOff(p as Nonbank, a), note: WRITE_OFF_NOTE },
  { id: 'bank-pays', label: 'A bank pays wages', parties: BANK_IDS, counterparties: NONBANK_IDS, make: (p, c, a) => bankPays(p as Bank, c as Nonbank, a) },
  { id: 'bank-buys', label: 'A bank buys a Treasury security from a customer', parties: BANK_IDS, counterparties: NONBANK_IDS, make: (p, c, a) => bankBuysSecurity(p as Bank, c as Nonbank, a) },
  { id: 'fed-buys-nonbank', label: 'The Fed buys a Treasury security from a nonbank', parties: NONBANK_IDS, make: (p, _c, a) => fedBuysFromNonbank(p as Nonbank, a) },
  { id: 'fed-buys-bank', label: 'The Fed buys a Treasury security from a bank', parties: BANK_IDS, make: (p, _c, a) => fedBuysFromBank(p as Bank, a) },
  { id: 'discount', label: 'A bank borrows from the discount window', parties: BANK_IDS, make: (p, _c, a) => discountWindowLoan(p as Bank, a) },
  { id: 'iorb', label: 'The Fed pays interest on reserves', parties: BANK_IDS, make: (p, _c, a) => interestOnReserves(p as Bank, a), note: 'The Fed\'s equity falls here; the real Federal Reserve Banks record a deferred asset instead (see What the simulation leaves out).' },
  { id: 'treasury-spends', label: 'The Treasury spends', parties: NONBANK_IDS, make: (p, _c, a) => treasurySpends(p as Nonbank, a) },
  { id: 'taxes', label: 'Pay taxes', parties: NONBANK_IDS, make: (p, _c, a) => payTaxes(p as Nonbank, a) },
  { id: 'treasury-sells', label: 'The Treasury sells a new security', parties: NONBANK_IDS, make: (p, _c, a) => treasurySells(p as Nonbank, a) },
  { id: 'currency', label: 'Withdraw cash', parties: NONBANK_IDS, make: (p, _c, a) => withdrawCurrency(p as Nonbank, a) },
  { id: 'reverse-repo', label: 'The money market fund lends to the Fed overnight (reverse repo)', parties: ['MMF'], make: (_p, _c, a) => mmfReverseRepo(a) },
  { id: 'interbank', label: 'A bank lends reserves to the other bank', parties: BANK_IDS, make: (p, _c, a) => interbankLoan(p as Bank, p === 'BankA' ? 'BankB' : 'BankA', a) },
];

/** Where each sector sits in the flow view (a 3 by 3 grid of columns and rows). */
export const FLOW_LAYOUT: Readonly<Record<EntityId, { col: number; row: number; group: string }>> = {
  H1: { col: 0, row: 0, group: 'Households' },
  H2: { col: 0, row: 1, group: 'Households' },
  Business: { col: 0, row: 2, group: 'Businesses' },
  BankA: { col: 1, row: 0, group: 'Banks' },
  BankB: { col: 1, row: 1, group: 'Banks' },
  Fed: { col: 1, row: 2, group: 'Central bank' },
  Investor: { col: 2, row: 0, group: 'Financial markets' },
  MMF: { col: 2, row: 1, group: 'Financial markets' },
  Treasury: { col: 2, row: 2, group: 'Government' },
};

/** The counters the lesson shows. */
export function flowCounterRows(c: Counters): { label: string; value: string }[] {
  return [
    { label: 'Money in the model', value: formatUSD(c.money) },
    { label: 'Bank deposits', value: formatUSD(c.deposits) },
    { label: 'Bank reserves', value: formatUSD(c.reserves) },
    { label: 'Treasury General Account', value: formatUSD(c.tga) },
  ];
}

export const FLOW_OPENING_TEXT = 'Households, a business, two banks, the Treasury, the Federal Reserve, an investor and a money market fund, each with a balance sheet that balances. Press Next to follow a payment.';

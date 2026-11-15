import { describe, expect, it } from 'vitest';
import * as catalog from '../../../src/lib/engines/ledger/catalog';
import { applyTransaction, invariantViolations, type Transaction } from '../../../src/lib/engines/ledger/ledger';
import {
  BANK_OF,
  ENTITIES,
  balanceSheet,
  createState,
  moneyMeasure,
  totalDeposits,
  totalReserves,
  type EntityId,
  type LedgerState,
  type Nonbank,
} from '../../../src/lib/engines/ledger/model';
import { OPENING_CLAIMS, openingState } from '../../../src/lib/engines/ledger/scenario';
import { rng } from '../../support/random';

/** Line-by-line change per entity: `A:instrument:counterparty`, `L:...`, and `E` for equity. */
function postings(before: LedgerState, after: LedgerState): Partial<Record<EntityId, Record<string, number>>> {
  const out: Partial<Record<EntityId, Record<string, number>>> = {};
  for (const entity of ENTITIES) {
    const lines = (s: LedgerState) => {
      const sheet = balanceSheet(s, entity);
      const m: Record<string, number> = { E: sheet.equity };
      for (const l of sheet.assets) m[`A:${l.instrument}:${l.counterparty}`] = l.amount;
      for (const l of sheet.liabilities) m[`L:${l.instrument}:${l.counterparty}`] = l.amount;
      return m;
    };
    const b = lines(before);
    const a = lines(after);
    const diff: Record<string, number> = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const change = (a[key] ?? 0) - (b[key] ?? 0);
      if (change !== 0) diff[key] = change;
    }
    if (Object.keys(diff).length) out[entity] = diff;
  }
  return out;
}

function apply(state: LedgerState, tx: Transaction): LedgerState {
  const result = applyTransaction(state, tx);
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.issues)}`);
  return result.state;
}

// FINANCIAL_MODEL_REQUIREMENTS.md 7.2, transcribed by hand. Row 2 adds the equity changes
// the table omits: without them Household 1 and Household 2 would not balance.
interface Row {
  n: number;
  setup?: (s: LedgerState) => LedgerState;
  tx: Transaction;
  reserves: number;
  deposits: number;
  postings: Partial<Record<EntityId, Record<string, number>>>;
}

const withLoan = (s: LedgerState) => apply(s, catalog.bankLends('H1', 100));

const ROWS: Row[] = [
  { n: 1, tx: catalog.bankLends('H1', 100), reserves: 0, deposits: 100, postings: {
    BankA: { 'A:loan:H1': 100, 'L:deposit:H1': 100 }, H1: { 'A:deposit:BankA': 100, 'L:loan:BankA': 100 } } },
  { n: 2, tx: catalog.payment('H1', 'H2', 100), reserves: 0, deposits: 0, postings: {
    H1: { 'A:deposit:BankA': -100, E: -100 }, H2: { 'A:deposit:BankB': 100, E: 100 },
    BankA: { 'L:deposit:H1': -100, 'A:reserves:Fed': -100 }, BankB: { 'L:deposit:H2': 100, 'A:reserves:Fed': 100 },
    Fed: { 'L:reserves:BankA': -100, 'L:reserves:BankB': 100 } } },
  { n: 3, setup: withLoan, tx: catalog.repayPrincipal('H1', 40), reserves: 0, deposits: -40, postings: {
    H1: { 'A:deposit:BankA': -40, 'L:loan:BankA': -40 }, BankA: { 'A:loan:H1': -40, 'L:deposit:H1': -40 } } },
  { n: 4, tx: catalog.payInterest('H1', 5), reserves: 0, deposits: -5, postings: {
    H1: { 'A:deposit:BankA': -5, E: -5 }, BankA: { 'L:deposit:H1': -5, E: 5 } } },
  { n: 5, setup: withLoan, tx: catalog.writeOff('H1', 60), reserves: 0, deposits: 0, postings: {
    BankA: { 'A:loan:H1': -60, E: -60 }, H1: { 'L:loan:BankA': -60, E: 60 } } },
  { n: 6, tx: catalog.bankPays('BankA', 'H1', 3), reserves: 0, deposits: 3, postings: {
    BankA: { E: -3, 'L:deposit:H1': 3 }, H1: { 'A:deposit:BankA': 3, E: 3 } } },
  { n: 7, tx: catalog.bankBuysSecurity('BankA', 'Investor', 50), reserves: 0, deposits: 50, postings: {
    BankA: { 'A:security:Treasury': 50, 'L:deposit:Investor': 50 },
    Investor: { 'A:security:Treasury': -50, 'A:deposit:BankA': 50 },
    Treasury: { 'L:security:BankA': 50, 'L:security:Investor': -50 } } },
  { n: 8, tx: catalog.fedBuysFromNonbank('Investor', 50), reserves: 50, deposits: 50, postings: {
    Fed: { 'A:security:Treasury': 50, 'L:reserves:BankA': 50 }, BankA: { 'A:reserves:Fed': 50, 'L:deposit:Investor': 50 },
    Investor: { 'A:security:Treasury': -50, 'A:deposit:BankA': 50 }, Treasury: { 'L:security:Fed': 50, 'L:security:Investor': -50 } } },
  { n: 9, tx: catalog.fedBuysFromBank('BankA', 50), reserves: 50, deposits: 0, postings: {
    Fed: { 'A:security:Treasury': 50, 'L:reserves:BankA': 50 }, BankA: { 'A:reserves:Fed': 50, 'A:security:Treasury': -50 },
    Treasury: { 'L:security:Fed': 50, 'L:security:BankA': -50 } } },
  { n: 10, tx: catalog.discountWindowLoan('BankA', 20), reserves: 20, deposits: 0, postings: {
    Fed: { 'A:discount-loan:BankA': 20, 'L:reserves:BankA': 20 }, BankA: { 'A:reserves:Fed': 20, 'L:discount-loan:Fed': 20 } } },
  { n: 11, tx: catalog.interestOnReserves('BankA', 1), reserves: 1, deposits: 0, postings: {
    Fed: { 'L:reserves:BankA': 1, E: -1 }, BankA: { 'A:reserves:Fed': 1, E: 1 } } },
  { n: 12, tx: catalog.treasurySpends('H2', 30), reserves: 30, deposits: 30, postings: {
    Treasury: { 'A:tga:Fed': -30, E: -30 }, Fed: { 'L:tga:Treasury': -30, 'L:reserves:BankB': 30 },
    BankB: { 'A:reserves:Fed': 30, 'L:deposit:H2': 30 }, H2: { 'A:deposit:BankB': 30, E: 30 } } },
  { n: 13, tx: catalog.payTaxes('H1', 10), reserves: -10, deposits: -10, postings: {
    H1: { 'A:deposit:BankA': -10, E: -10 }, BankA: { 'L:deposit:H1': -10, 'A:reserves:Fed': -10 },
    Fed: { 'L:reserves:BankA': -10, 'L:tga:Treasury': 10 }, Treasury: { 'A:tga:Fed': 10, E: 10 } } },
  { n: 14, tx: catalog.treasurySells('Investor', 25), reserves: -25, deposits: -25, postings: {
    Investor: { 'A:deposit:BankA': -25, 'A:security:Treasury': 25 }, BankA: { 'L:deposit:Investor': -25, 'A:reserves:Fed': -25 },
    Fed: { 'L:reserves:BankA': -25, 'L:tga:Treasury': 25 }, Treasury: { 'A:tga:Fed': 25, 'L:security:Investor': 25 } } },
  { n: 15, tx: catalog.withdrawCurrency('H1', 5), reserves: -5, deposits: -5, postings: {
    H1: { 'A:deposit:BankA': -5, 'A:currency:Fed': 5 }, BankA: { 'L:deposit:H1': -5, 'A:reserves:Fed': -5 },
    Fed: { 'L:reserves:BankA': -5, 'L:currency:H1': 5 } } },
  { n: 16, tx: catalog.mmfReverseRepo(15), reserves: -15, deposits: -15, postings: {
    MMF: { 'A:deposit:BankA': -15, 'A:reverse-repo:Fed': 15 }, BankA: { 'L:deposit:MMF': -15, 'A:reserves:Fed': -15 },
    Fed: { 'L:reserves:BankA': -15, 'L:reverse-repo:MMF': 15 } } },
];

describe('transaction catalog: postings match FINANCIAL_MODEL_REQUIREMENTS 7.2', () => {
  for (const row of ROWS) {
    it(`#${row.n} ${row.tx.kind}: postings, reserve total and deposit total match the table`, () => {
      const before = row.setup ? row.setup(openingState()) : openingState();
      const after = apply(before, row.tx);
      expect(postings(before, after)).toEqual(row.postings);
      expect(totalReserves(after) - totalReserves(before)).toBe(row.reserves);
      expect(totalDeposits(after) - totalDeposits(before)).toBe(row.deposits);
      expect(invariantViolations(before, after)).toEqual([]);
    });
  }
});

describe('ledger: refusals', () => {
  it('refuses a payment that would overdraw a deposit, and leaves the state unchanged', () => {
    const state = openingState();
    const result = applyTransaction(state, catalog.payment('H1', 'H2', 101));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual([expect.objectContaining({ code: 'insufficient-funds', entity: 'H1', amount: 1 })]);
    expect(balanceSheet(state, 'H1').assets.find((l) => l.instrument === 'deposit')?.amount).toBe(100);
  });

  it('refuses a payment that would take a bank below zero reserves, naming the bank and the shortfall', () => {
    let state = openingState();
    state = apply(state, catalog.bankLends('H1', 400)); // H1 now has 500 in deposits at Bank A
    const result = applyTransaction(state, catalog.payment('H1', 'H2', 300)); // Bank A holds 250 in reserves
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual([expect.objectContaining({ code: 'reserve-shortfall', entity: 'BankA', amount: 50 })]);
  });

  it('accepts the same payment once the bank borrows reserves (interbank or discount window)', () => {
    let state = apply(openingState(), catalog.bankLends('H1', 400));
    for (const fix of [catalog.interbankLoan('BankB', 'BankA', 50), catalog.discountWindowLoan('BankA', 50)]) {
      const fixed = apply(state, fix);
      expect(applyTransaction(fixed, catalog.payment('H1', 'H2', 300)).ok).toBe(true);
    }
    state = apply(state, catalog.discountWindowLoan('BankA', 50));
    expect(totalReserves(state)).toBe(550);
  });

  it('refuses repaying more principal than is owed', () => {
    const state = apply(openingState(), catalog.bankLends('H1', 30));
    const result = applyTransaction(state, catalog.repayPrincipal('H1', 40));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toEqual(expect.objectContaining({ code: 'exceeds-balance', entity: 'H1', amount: 10 }));
  });

  it('refuses lending that breaches an optional minimum capital ratio, and allows it without one', () => {
    // Bank A: equity 75 on assets 375 (20%). Lending 500 makes equity 75 on 875 (8.6%).
    const tx = catalog.bankLends('H1', 500);
    expect(applyTransaction(openingState(), tx).ok).toBe(true);
    const result = applyTransaction(openingState(), tx, { minCapitalRatio: 0.1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toEqual(expect.objectContaining({ code: 'capital-constraint', entity: 'BankA' }));
    expect(applyTransaction(openingState(), catalog.bankLends('H1', 300), { minCapitalRatio: 0.1 }).ok).toBe(true);
  });

  it('refuses a transaction that would unbalance a balance sheet', () => {
    const broken: Transaction = { kind: 'broken', description: 'deposit with no other side', claims: [{ instrument: 'deposit', holder: 'H1', issuer: 'BankA', change: 10 }], equity: [] };
    const result = applyTransaction(openingState(), broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.every((i) => i.code === 'invariant-violation')).toBe(true);
  });
});

describe('ledger: state and measures', () => {
  it('never changes the input state (states are immutable for stepping back and forward)', () => {
    const state = openingState();
    const snapshot = JSON.stringify(state);
    apply(state, catalog.bankLends('H1', 100));
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(Object.isFrozen(state.claims)).toBe(true);
  });

  it('opens balanced, with total equity of zero', () => {
    const state = openingState();
    for (const entity of ENTITIES) {
      const s = balanceSheet(state, entity);
      expect(s.totalAssets).toBe(s.totalLiabilities + s.equity);
    }
    expect(ENTITIES.reduce((sum, e) => sum + state.equity[e], 0)).toBe(0);
  });

  it('leaves deposits held by banks out of the money measure (a correspondent balance is not money)', () => {
    const withCorrespondent = createState([...OPENING_CLAIMS, { instrument: 'deposit', holder: 'BankA', issuer: 'BankB', amount: 40 }]);
    expect(totalDeposits(withCorrespondent)).toBe(totalDeposits(openingState()) + 40);
    expect(moneyMeasure(withCorrespondent)).toBe(moneyMeasure(openingState()));
  });

  it('measures money as deposits plus currency held by nonbanks', () => {
    // Opening: deposits 100 x 5 nonbanks + currency 25 x 2 households.
    expect(moneyMeasure(openingState())).toBe(550);
    expect(moneyMeasure(apply(openingState(), catalog.bankLends('H1', 100)))).toBe(650);
    expect(moneyMeasure(apply(openingState(), catalog.withdrawCurrency('H1', 5)))).toBe(550);
  });
});

describe('ledger: seeded random sequences keep every invariant', () => {
  const nonbanks: Nonbank[] = ['H1', 'H2', 'Business', 'Investor', 'MMF'];
  const banks = ['BankA', 'BankB'] as const;

  function randomTx(r: ReturnType<typeof rng>): Transaction {
    const amount = r.int(1, 120);
    const who = r.pick(nonbanks);
    const other = r.pick(nonbanks.filter((n) => n !== who));
    const bank = r.pick(banks);
    switch (r.int(0, 16)) {
      case 0: return catalog.bankLends(who, amount);
      case 1: return catalog.payment(who, other, amount);
      case 2: return catalog.repayPrincipal(who, amount);
      case 3: return catalog.payInterest(who, amount);
      case 4: return catalog.writeOff(who, amount);
      case 5: return catalog.bankPays(bank, who, amount);
      case 6: return catalog.bankBuysSecurity(BANK_OF[who], who, amount);
      case 7: return catalog.fedBuysFromNonbank(who, amount);
      case 8: return catalog.fedBuysFromBank(bank, amount);
      case 9: return catalog.discountWindowLoan(bank, amount);
      case 10: return catalog.interestOnReserves(bank, Math.max(1, Math.floor(amount / 10)));
      case 11: return catalog.treasurySpends(who, amount);
      case 12: return catalog.payTaxes(who, amount);
      case 13: return catalog.treasurySells(who, amount);
      case 14: return catalog.withdrawCurrency(who, amount);
      case 15: return catalog.mmfReverseRepo(amount);
      default: return catalog.interbankLoan(bank, bank === 'BankA' ? 'BankB' : 'BankA', amount);
    }
  }

  it('1,000 sequences of 40 random transactions: every accepted step keeps the invariants, refusals are explained', () => {
    const allowedRefusals = new Set(['insufficient-funds', 'reserve-shortfall', 'exceeds-balance']);
    let accepted = 0;
    let refused = 0;
    for (let seed = 1; seed <= 1000; seed += 1) {
      const r = rng(seed);
      let state = openingState();
      for (let step = 0; step < 40; step += 1) {
        const tx = randomTx(r);
        const result = applyTransaction(state, tx);
        if (result.ok) {
          expect(invariantViolations(state, result.state)).toEqual([]);
          expect(moneyMeasure(result.state)).toBe(
            Object.entries(result.state.claims)
              .filter(([k]) => /^(deposit|currency)\|(H1|H2|Business|Investor|MMF)\|/.test(k))
              .reduce((s, [, v]) => s + v, 0),
          );
          state = result.state;
          accepted += 1;
        } else {
          for (const issue of result.issues) expect(allowedRefusals.has(issue.code)).toBe(true);
          refused += 1;
        }
      }
    }
    // Both paths must actually be exercised for the test to mean anything.
    expect(accepted).toBeGreaterThan(20000);
    expect(refused).toBeGreaterThan(1000);
  });
});

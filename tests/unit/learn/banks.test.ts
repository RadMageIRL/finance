// How Banks Create Money: the guided steps do what the lesson says they do, every state
// balances, a reserve shortfall stops the payment and every labeled choice resolves it, and
// the capital rule refuses the last loan.
import { describe, expect, it } from 'vitest';
import { BANK_LESSON_ENTITIES, BANK_STEPS, bankLessonOpening, firstLoanPayment, LESSON_CAPITAL_RATIO } from '../../../src/lib/learn/banks';
import { counters, fundingChoices, movements, runTransactions, sheetView, taccountHtml } from '../../../src/lib/learn/sim';
import { ENTITIES, balanceSheet, type LedgerState } from '../../../src/lib/engines/ledger/model';

function balanced(state: LedgerState): boolean {
  return ENTITIES.every((e) => {
    const s = balanceSheet(state, e);
    return s.totalAssets === s.totalLiabilities + s.equity;
  });
}

/** Runs the guided steps, resolving the shortfall with the given choice. */
function walk(choice: 'interbank' | 'discount-window' | 'cancel') {
  let state = bankLessonOpening();
  const money: number[] = [counters(state).money];
  const refusals: { step: string; code: string }[] = [];
  for (const step of BANK_STEPS) {
    const out = runTransactions(state, step.make(state), step.options ?? {});
    if (out.stopped?.shortfall) {
      expect(out.stopped.shortfall).toEqual({ bank: 'BankA', amount: 400_000 });
      const pick = fundingChoices(out.stopped.shortfall).find((c) => c.id === choice)!;
      const funding = pick.make();
      const resolved = funding ? runTransactions(out.state, [funding, out.stopped.tx, ...out.stopped.remaining]) : { state: out.state, applied: [] };
      expect('stopped' in resolved && resolved.stopped, `${choice} resolves the shortfall`).toBeFalsy();
      state = resolved.state;
    } else if (out.stopped) {
      for (const issue of out.stopped.issues) refusals.push({ step: step.id, code: issue.code });
      state = out.state;
    } else state = out.state;
    expect(balanced(state), step.id).toBe(true);
    money.push(counters(state).money);
  }
  return { state, money, refusals };
}

describe('How Banks Create Money', () => {
  it('starts from balanced balance sheets with each bank holding a fifth of its assets as equity', () => {
    const s = bankLessonOpening();
    expect(balanced(s)).toBe(true);
    const c = counters(s);
    expect(c.capitalRatio.BankA).toBeCloseTo(20, 10);
    expect(c.capitalRatio.BankB).toBeCloseTo(20, 10);
  });

  it('uses the amortization engine for the first payment: interest and principal of the lesson loan', () => {
    expect(firstLoanPayment()).toEqual({ interest: 1_000, principal: 7_885, payment: 8_885 });
  });

  it('creates money with the loan, moves it with the payment, and destroys it with repayment', () => {
    const { money } = walk('discount-window');
    expect(money[1]! - money[0]!).toBe(100_000);
    expect(money[2]! - money[1]!).toBe(0);
    expect(money[3]! - money[2]!).toBe(-8_885);
    expect(money[4]! - money[3]!).toBe(0);
  });

  it('moves reserves only when the payment crosses banks, and never changes the total', () => {
    let state = bankLessonOpening();
    const total = counters(state).reserves;
    const lend = runTransactions(state, BANK_STEPS[0]!.make(state));
    expect(counters(lend.state).reserves).toBe(total);
    state = lend.state;
    const spend = runTransactions(state, BANK_STEPS[1]!.make(state));
    expect(sheetView(spend.state, 'BankA', state).assets.find((l) => l.label === 'Reserves')!.amount).toBe(100_000);
    expect(counters(spend.state).reserves).toBe(total);
  });

  it('charges the default to Bank A\'s equity and leaves deposits alone', () => {
    let state = bankLessonOpening();
    for (const step of BANK_STEPS.slice(0, 3)) state = runTransactions(state, step.make(state)).state;
    const before = counters(state);
    const after = counters(runTransactions(state, BANK_STEPS[3]!.make(state)).state);
    expect(before.equity.BankA - after.equity.BankA).toBe(92_115);
    expect(after.deposits).toBe(before.deposits);
  });

  for (const choice of ['interbank', 'discount-window', 'cancel'] as const) {
    it(`resolves the reserve shortfall by the labeled choice, then the capital rule refuses the last loan: ${choice}`, () => {
      const { refusals, state } = walk(choice);
      expect(refusals).toEqual([{ step: 'capital', code: 'capital-constraint' }]);
      expect(counters(state).capitalRatio.BankA).toBeGreaterThan(LESSON_CAPITAL_RATIO * 100);
    });
  }

  it('offers three labeled choices for a shortfall, naming each risk answer', () => {
    const choices = fundingChoices({ bank: 'BankA', amount: 400_000 });
    expect(choices.map((c) => c.id)).toEqual(['interbank', 'discount-window', 'cancel']);
    expect(choices[0]!.label).toBe('Bank A borrows $4,000.00 of reserves overnight from Bank B');
    expect(choices[2]!.make()).toBeNull();
  });

  it('describes each step in words and marks changed lines in the balance sheets', () => {
    const s = bankLessonOpening();
    const tx = BANK_STEPS[0]!.make(s)[0]!;
    expect(movements(tx)).toEqual(['Loans held by Bank A, owed by Household 1: $1,000.00 created.', 'Deposit held by Household 1, owed by Bank A: $1,000.00 created.']);
    const after = runTransactions(s, [tx]).state;
    const html = taccountHtml(sheetView(after, 'BankA', s));
    expect(html.match(/class="is-changed"/g)).toHaveLength(2);
    expect(html).toContain('<span class="taccount__mark">changed</span>');
    expect(html).toContain('Balanced: assets equal liabilities plus equity.');
    for (const e of BANK_LESSON_ENTITIES) expect(taccountHtml(sheetView(after, e, s))).not.toContain('Not balanced');
  });
});

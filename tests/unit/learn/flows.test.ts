// How Money Flows: each guided step changes money, reserves and the Treasury's account the
// way its text says, every state balances, the flow view draws who paid whom, and every
// catalog action either posts or is refused for a stated reason, never throws.
import { describe, expect, it } from 'vitest';
import { FLOW_CATALOG, FLOW_STEPS, flowsOpening } from '../../../src/lib/learn/flows';
import { flowSvg, flowView } from '../../../src/lib/learn/flow-view';
import { counters, runTransactions } from '../../../src/lib/learn/sim';
import { ENTITIES, ENTITY_INFO, balanceSheet, type EntityId, type LedgerState } from '../../../src/lib/engines/ledger/model';
import { writeOff } from '../../../src/lib/engines/ledger/catalog';

const names = Object.fromEntries(ENTITIES.map((e) => [e, ENTITY_INFO[e].name])) as Record<EntityId, string>;

function balanced(state: LedgerState): boolean {
  return ENTITIES.every((e) => {
    const s = balanceSheet(state, e);
    return s.totalAssets === s.totalLiabilities + s.equity;
  });
}

function walk() {
  let state = flowsOpening();
  const deltas: Record<string, { money: number; reserves: number; tga: number }> = {};
  for (const step of FLOW_STEPS) {
    const before = counters(state);
    const out = runTransactions(state, step.make(state));
    expect(out.stopped, step.id).toBeUndefined();
    state = out.state;
    expect(balanced(state), step.id).toBe(true);
    const after = counters(state);
    deltas[step.id] = { money: after.money - before.money, reserves: after.reserves - before.reserves, tga: after.tga - before.tga };
  }
  return deltas;
}

describe('How Money Flows', () => {
  it('runs every guided step without a refusal, balanced throughout', () => {
    expect(Object.keys(walk())).toEqual(FLOW_STEPS.map((s) => s.id));
  });

  it('moves money and reserves exactly as each step says', () => {
    const d = walk();
    expect(d.wages).toEqual({ money: 0, reserves: 0, tga: 0 });
    expect(d.spending).toEqual({ money: 0, reserves: 0, tga: 0 });
    expect(d.saving).toEqual({ money: 0, reserves: 0, tga: 0 });
    expect(d.lending).toEqual({ money: 10_000, reserves: 0, tga: 0 });
    expect(d.repayment).toEqual({ money: -3_000, reserves: 0, tga: 0 });
    expect(d.taxes).toEqual({ money: -2_000, reserves: -2_000, tga: 2_000 });
    expect(d['spending-gov']).toEqual({ money: 5_000, reserves: 5_000, tga: -5_000 });
    expect(d['treasury-sale']).toEqual({ money: -4_000, reserves: -4_000, tga: 4_000 });
    expect(d['fed-purchase']).toEqual({ money: 5_000, reserves: 5_000, tga: 0 });
  });

  it('draws who paid whom', () => {
    const s = flowsOpening();
    const spend = flowView(FLOW_STEPS[1]!.make(s)[0]!);
    expect(spend.arrows).toEqual([
      { from: 'H1', to: 'Business', label: 'pays $40.00' },
      { from: 'BankA', to: 'BankB', label: 'reserves $40.00' },
    ]);
    const taxes = flowView(FLOW_STEPS.find((x) => x.id === 'taxes')!.make(s)[0]!);
    expect(taxes.arrows).toContainEqual({ from: 'H1', to: 'Treasury', label: 'pays $20.00' });
    const lend = flowView(FLOW_STEPS.find((x) => x.id === 'lending')!.make(s)[0]!);
    expect(lend.arrows).toContainEqual({ from: 'BankB', to: 'Business', label: 'lends $100.00' });
    const purchase = flowView(FLOW_STEPS.find((x) => x.id === 'fed-purchase')!.make(s)[0]!);
    expect(purchase.arrows).toContainEqual({ from: 'Investor', to: 'Fed', label: 'security $50.00' });
    expect(purchase.arrows).toContainEqual({ from: 'Fed', to: 'BankA', label: 'new reserves $50.00' });
    expect(flowView(null).arrows).toEqual([]);
  });

  it('renders the flow view with a title that says the same as the arrows', () => {
    const s = flowsOpening();
    const svg = flowSvg(flowView(FLOW_STEPS[1]!.make(s)[0]!), names, 'test');
    expect(svg).toContain('<title id="test-title">Flows: Household 1 to Business, pays $40.00; Bank A to Bank B, reserves $40.00</title>');
    // Household 1, the business, both banks, and the Fed, whose reserve liabilities move from Bank A to Bank B.
    expect(svg.match(/class="flow__node is-changed"/g)).toHaveLength(5);
    expect(svg.match(/<line class="flow__arrow"/g)).toHaveLength(2);
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('labels a write-off as the bank writing off the loan, never as a repayment', () => {
    const view = flowView(writeOff('H1', 2_500));
    expect(view.arrows).toEqual([{ from: 'BankA', to: 'H1', label: 'writes off $25.00' }]);
    const svg = flowSvg(view, names, 'wo');
    expect(svg).toContain('<title id="wo-title">Flows: Bank A to Household 1, writes off $25.00</title>');
    expect(svg).not.toContain('repays');
  });

  it('offers the whole catalog, and every action posts or is refused for a stated reason', () => {
    expect(FLOW_CATALOG.length).toBe(17);
    const s = flowsOpening();
    const known = new Set(['insufficient-funds', 'reserve-shortfall', 'exceeds-balance', 'capital-constraint']);
    for (const a of FLOW_CATALOG) {
      for (const party of a.parties) {
        const counterparty = a.counterparties?.find((c) => c !== party) ?? null;
        const out = runTransactions(s, [a.make(party, counterparty, 1_000)]);
        if (out.stopped) for (const issue of out.stopped.issues) expect(known.has(issue.code), `${a.id} ${party}: ${issue.code}`).toBe(true);
        else expect(balanced(out.state), `${a.id} ${party}`).toBe(true);
      }
    }
  });
});

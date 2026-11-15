// Applying transactions and enforcing the invariants (FINANCIAL_MODEL_REQUIREMENTS 7.3).
// A transaction is accepted only if every invariant holds afterwards; otherwise the old
// state stands and the reasons are reported. Pure and immutable.

import {
  BANKS,
  ENTITIES,
  balanceSheet,
  claimKey,
  parseClaimKey,
  totalReserves,
  type Claim,
  type EntityId,
  type LedgerState,
} from './model';

export interface ClaimChange extends Claim {
  /** Signed change in the claim's outstanding amount. */
  change: number;
}

export interface EquityChange {
  entity: EntityId;
  change: number;
}

export interface Transaction {
  /** Catalog id, for example `bank-lends`. */
  kind: string;
  /** Plain-language description of this step. */
  description: string;
  claims: readonly ClaimChange[];
  equity: readonly EquityChange[];
}

export type LedgerIssueCode =
  | 'invalid-amount'
  | 'insufficient-funds'
  | 'reserve-shortfall'
  | 'exceeds-balance'
  | 'capital-constraint'
  | 'invariant-violation';

export interface LedgerIssue {
  code: LedgerIssueCode;
  entity?: EntityId;
  /** For a shortfall: how much more the entity would need. */
  amount?: number;
  detail?: string;
}

export type LedgerResult = { ok: true; state: LedgerState } | { ok: false; issues: LedgerIssue[] };

export interface LedgerOptions {
  /** Optional minimum equity / assets ratio for banks (simplified: not risk weighted). */
  minCapitalRatio?: number;
}

/** Checks invariants 1 to 3 between two states for one transaction. Empty means all hold. */
export function invariantViolations(before: LedgerState, after: LedgerState): string[] {
  const problems: string[] = [];

  // 1. Every balance sheet balances: assets = liabilities + equity, exactly.
  for (const entity of ENTITIES) {
    const sheet = balanceSheet(after, entity);
    if (sheet.totalAssets !== sheet.totalLiabilities + sheet.equity) {
      problems.push(`${entity} does not balance: assets ${sheet.totalAssets}, liabilities ${sheet.totalLiabilities}, equity ${sheet.equity}`);
    }
  }

  // 2. Symmetry is structural (claims), but no claim may be held against its own issuer
  // and every stored amount must be a positive whole number.
  for (const [key, amount] of Object.entries(after.claims)) {
    const c = parseClaimKey(key);
    if (c.holder === c.issuer) problems.push(`${key} is held by its own issuer`);
    if (!Number.isInteger(amount) || amount <= 0) problems.push(`${key} has amount ${amount}`);
  }

  // Aggregate consequence: total equity is zero, since every asset is someone's liability.
  const equityTotal = ENTITIES.reduce((s, e) => s + after.equity[e], 0);
  if (equityTotal !== 0) problems.push(`total equity is ${equityTotal}, not 0`);

  // 3. Total reserves change only when the Fed's balance sheet changes other than by
  // reserves moving between banks.
  const reserveChange = totalReserves(after) - totalReserves(before);
  if (reserveChange !== 0) {
    const fedOther = (s: LedgerState) => {
      const sheet = balanceSheet(s, 'Fed');
      const nonReserveLiabilities = sheet.liabilities.filter((l) => l.instrument !== 'reserves').reduce((t, l) => t + l.amount, 0);
      return `${sheet.totalAssets}|${nonReserveLiabilities}|${sheet.equity}`;
    };
    if (fedOther(before) === fedOther(after)) problems.push(`total reserves changed by ${reserveChange} without a Fed transaction`);
  }
  return problems;
}

const NEGATIVE_CODE: Partial<Record<Claim['instrument'], LedgerIssueCode>> = {
  deposit: 'insufficient-funds',
  currency: 'insufficient-funds',
  reserves: 'reserve-shortfall',
  'vault-cash': 'reserve-shortfall',
};

/** Applies a transaction. On success returns the new state; the input state is never changed. */
export function applyTransaction(state: LedgerState, tx: Transaction, options: LedgerOptions = {}): LedgerResult {
  const issues: LedgerIssue[] = [];

  for (const c of tx.claims) {
    if (!Number.isInteger(c.change) || c.change === 0) issues.push({ code: 'invalid-amount', detail: claimKey(c) });
  }
  for (const e of tx.equity) {
    if (!Number.isInteger(e.change)) issues.push({ code: 'invalid-amount', entity: e.entity });
  }
  if (issues.length) return { ok: false, issues };

  const claims: Record<string, number> = { ...state.claims };
  for (const c of tx.claims) {
    const key = claimKey(c);
    claims[key] = (claims[key] ?? 0) + c.change;
  }
  for (const [key, amount] of Object.entries(claims)) {
    if (amount < 0) {
      const c = parseClaimKey(key);
      const code = NEGATIVE_CODE[c.instrument] ?? 'exceeds-balance';
      const entity = code === 'exceeds-balance' ? c.issuer : c.holder;
      issues.push({ code, entity, amount: -amount, detail: key });
    }
    if (amount === 0) delete claims[key];
  }
  if (issues.length) return { ok: false, issues };

  const equity = { ...state.equity };
  for (const e of tx.equity) equity[e.entity] += e.change;
  const next: LedgerState = Object.freeze({ claims: Object.freeze(claims), equity: Object.freeze(equity) });

  if (options.minCapitalRatio !== undefined) {
    for (const bank of BANKS) {
      const before = balanceSheet(state, bank);
      const after = balanceSheet(next, bank);
      if (after.totalAssets > before.totalAssets && after.equity < options.minCapitalRatio * after.totalAssets) {
        issues.push({ code: 'capital-constraint', entity: bank, detail: `equity ${after.equity} on assets ${after.totalAssets}` });
      }
    }
    if (issues.length) return { ok: false, issues };
  }

  const violations = invariantViolations(state, next);
  if (violations.length) return { ok: false, issues: violations.map((detail) => ({ code: 'invariant-violation', detail })) };

  return { ok: true, state: next };
}

/** Applies transactions in order, stopping at the first refusal. Keeps every state for stepping. */
export function runSequence(
  start: LedgerState,
  txs: readonly Transaction[],
  options: LedgerOptions = {},
): { states: LedgerState[]; refused?: { index: number; issues: LedgerIssue[] } } {
  const states = [start];
  for (let index = 0; index < txs.length; index += 1) {
    const result = applyTransaction(states[states.length - 1]!, txs[index]!, options);
    if (!result.ok) return { states, refused: { index, issues: result.issues } };
    states.push(result.state);
  }
  return { states };
}

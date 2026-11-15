// Shared logic for the balance-sheet lessons (How Banks Create Money, How Money Flows):
// balance sheets as display rows, the counters, what changed between two states, and a
// plain-language list of what moved. Pure: the ledger engine does the accounting
// (src/lib/engines/ledger); this file only describes its states. Amounts are integer cents.

import { discountWindowLoan, interbankLoan } from '../engines/ledger/catalog';
import { applyTransaction, type LedgerIssue, type LedgerOptions, type Transaction } from '../engines/ledger/ledger';
import {
  BANKS,
  ENTITY_INFO,
  INSTRUMENT_LABEL,
  balanceSheet,
  claimAmount,
  moneyMeasure,
  parseClaimKey,
  totalDeposits,
  totalReserves,
  type Bank,
  type EntityId,
  type Instrument,
  type LedgerState,
} from '../engines/ledger/model';
import { formatUSD } from '../calc/format';

export interface GuidedStep {
  id: string;
  title: string;
  /** What happens and why, shown with the step. */
  text: string;
  /** The transactions, built from the state before the step. */
  make: (state: LedgerState) => Transaction[];
  options?: LedgerOptions;
  /** A step that shows a rule refusing a transaction: the state stays as it was. */
  refused?: boolean;
}

export interface SheetLine {
  key: string;
  label: string;
  /** Who is on the other side of the claim. */
  with: string;
  amount: number;
  changed: boolean;
}

export interface SheetView {
  entity: EntityId;
  name: string;
  assets: SheetLine[];
  liabilities: SheetLine[];
  equity: number;
  equityChanged: boolean;
  totalAssets: number;
  balanced: boolean;
}

/** Claim keys whose amount differs between two states. */
export function changedClaims(before: LedgerState | null, after: LedgerState): Set<string> {
  const out = new Set<string>();
  if (!before) return out;
  for (const key of new Set([...Object.keys(before.claims), ...Object.keys(after.claims)])) {
    if ((before.claims[key] ?? 0) !== (after.claims[key] ?? 0)) out.add(key);
  }
  return out;
}

export function sheetView(state: LedgerState, entity: EntityId, before: LedgerState | null = null): SheetView {
  const sheet = balanceSheet(state, entity);
  const changed = changedClaims(before, state);
  // Lines that went to zero in this step still show, at zero, so the change is visible.
  const gone = before ? [...changed].filter((k) => !(k in state.claims)) : [];
  const line = (key: string, label: string, other: EntityId, amount: number): SheetLine => ({ key, label, with: ENTITY_INFO[other].name, amount, changed: changed.has(key) });
  const assets = sheet.assets.map((l) => line(`${l.instrument}|${entity}|${l.counterparty}`, l.label, l.counterparty, l.amount));
  const liabilities = sheet.liabilities.map((l) => line(`${l.instrument}|${l.counterparty}|${entity}`, l.label, l.counterparty, l.amount));
  for (const key of gone) {
    const c = parseClaimKey(key);
    if (c.holder === entity) assets.push(line(key, labelFor(c.instrument, 'asset'), c.issuer, 0));
    if (c.issuer === entity) liabilities.push(line(key, labelFor(c.instrument, 'liability'), c.holder, 0));
  }
  return {
    entity,
    name: ENTITY_INFO[entity].name,
    assets,
    liabilities,
    equity: sheet.equity,
    equityChanged: before !== null && before.equity[entity] !== state.equity[entity],
    totalAssets: sheet.totalAssets,
    balanced: sheet.totalAssets === sheet.totalLiabilities + sheet.equity,
  };
}

const labelFor = (i: Instrument, side: 'asset' | 'liability') => INSTRUMENT_LABEL[i][side];

export interface Counters {
  money: number;
  deposits: number;
  reserves: number;
  tga: number;
  equity: Record<Bank, number>;
  /** Equity over assets, a simplified capital ratio, in percent. */
  capitalRatio: Record<Bank, number>;
}

export function counters(state: LedgerState): Counters {
  const equity = {} as Record<Bank, number>;
  const capitalRatio = {} as Record<Bank, number>;
  for (const bank of BANKS) {
    const sheet = balanceSheet(state, bank);
    equity[bank] = sheet.equity;
    capitalRatio[bank] = sheet.totalAssets > 0 ? (sheet.equity / sheet.totalAssets) * 100 : 0;
  }
  return { money: moneyMeasure(state), deposits: totalDeposits(state), reserves: totalReserves(state), tga: claimAmount(state, { instrument: 'tga', holder: 'Treasury', issuer: 'Fed' }), equity, capitalRatio };
}

/** What moved in a transaction, in plain words: one line per instrument. */
export function movements(tx: Transaction): string[] {
  const byInstrument = new Map<Instrument, { holder: EntityId; issuer: EntityId; change: number }[]>();
  for (const c of tx.claims) byInstrument.set(c.instrument, [...(byInstrument.get(c.instrument) ?? []), c]);
  const out: string[] = [];
  for (const [instrument, changes] of byInstrument) {
    const name = INSTRUMENT_LABEL[instrument].asset;
    const down = changes.filter((c) => c.change < 0);
    const up = changes.filter((c) => c.change > 0);
    const total = (list: typeof changes) => list.reduce((s, c) => s + Math.abs(c.change), 0);
    if (down.length && up.length && total(down) === total(up) && (instrument === 'deposit' || instrument === 'reserves' || instrument === 'security' || instrument === 'currency')) {
      const from = down.map((c) => ENTITY_INFO[c.holder].name).join(' and ');
      const to = up.map((c) => ENTITY_INFO[c.holder].name).join(' and ');
      out.push(`${name}: ${formatUSD(total(up))} from ${from} to ${to}.`);
      continue;
    }
    for (const c of changes) {
      const verb = c.change > 0 ? 'created' : 'removed';
      out.push(`${name} held by ${ENTITY_INFO[c.holder].name}, owed by ${ENTITY_INFO[c.issuer].name}: ${formatUSD(Math.abs(c.change))} ${verb}.`);
    }
  }
  for (const e of tx.equity) {
    out.push(`Equity of ${ENTITY_INFO[e.entity].name}: ${e.change > 0 ? 'up' : 'down'} ${formatUSD(Math.abs(e.change))}.`);
  }
  return out;
}


/** A refused transaction, in plain words. */
export function issueText(issue: LedgerIssue): string {
  const who = issue.entity ? ENTITY_INFO[issue.entity].name : 'An account';
  switch (issue.code) {
    case 'reserve-shortfall':
      return `${who} does not have enough reserves to settle this payment: it is ${formatUSD(issue.amount ?? 0)} short.`;
    case 'insufficient-funds':
      return `${who} does not have enough in its account: it is ${formatUSD(issue.amount ?? 0)} short.`;
    case 'exceeds-balance':
      return `That is more than ${who} owes.`;
    case 'capital-constraint':
      return `${who} would fall below the capital rule: its equity would be too small a share of its assets.`;
    case 'invalid-amount':
      return 'Enter an amount of at least one cent.';
    default:
      return 'The ledger refused this step because the accounts would not balance.';
  }
}

/** A transaction refused for lack of reserves, with what the bank is short. */
export interface Shortfall {
  bank: Bank;
  amount: number;
}

export interface StepOutcome {
  state: LedgerState;
  /** Transactions applied, in order. */
  applied: Transaction[];
  /** Set when a transaction was refused: it and the ones after it were not applied. */
  stopped?: { tx: Transaction; remaining: Transaction[]; issues: LedgerIssue[]; shortfall?: Shortfall };
}

/** Applies transactions in order until one is refused. */
export function runTransactions(start: LedgerState, txs: readonly Transaction[], options: LedgerOptions = {}): StepOutcome {
  let state = start;
  const applied: Transaction[] = [];
  for (let i = 0; i < txs.length; i += 1) {
    const tx = txs[i]!;
    const result = applyTransaction(state, tx, options);
    if (!result.ok) {
      const short = result.issues.find((x) => x.code === 'reserve-shortfall' && x.entity && (BANKS as readonly string[]).includes(x.entity));
      return {
        state,
        applied,
        stopped: { tx, remaining: txs.slice(i + 1), issues: result.issues, ...(short ? { shortfall: { bank: short.entity as Bank, amount: short.amount ?? 0 } } : {}) },
      };
    }
    state = result.state;
    applied.push(tx);
  }
  return { state, applied };
}

export interface FundingChoice {
  id: 'interbank' | 'discount-window' | 'cancel';
  label: string;
  /** What the choice means, named for the risk it answers. */
  note: string;
  /** The funding transaction, or null to cancel the payment. */
  make: () => Transaction | null;
}

/** The labeled choices offered when a bank cannot settle a payment in reserves. */
export function fundingChoices(short: Shortfall): FundingChoice[] {
  const other: Bank = short.bank === 'BankA' ? 'BankB' : 'BankA';
  const name = ENTITY_INFO[short.bank].name;
  return [
    { id: 'interbank', label: `${name} borrows ${formatUSD(short.amount)} of reserves overnight from ${ENTITY_INFO[other].name}`, note: 'Borrowing reserves from another bank, as banks do in the federal funds market.', make: () => interbankLoan(other, short.bank, short.amount) },
    { id: 'discount-window', label: `${name} borrows ${formatUSD(short.amount)} from the Federal Reserve's discount window`, note: 'A loan from the central bank, secured by collateral.', make: () => discountWindowLoan(short.bank, short.amount) },
    { id: 'cancel', label: 'Cancel the payment', note: 'The payment does not happen; the deposit stays where it was.', make: () => null },
  ];
}

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function linesHtml(lines: readonly SheetLine[]): string {
  if (!lines.length) return '<tr><td colspan="2" class="taccount__empty">None</td></tr>';
  return lines
    .map((l) => `<tr${l.changed ? ' class="is-changed"' : ''}><th scope="row">${esc(l.label)} <span class="taccount__with">${esc(l.with)}</span>${l.changed ? ' <span class="taccount__mark">changed</span>' : ''}</th><td class="num">${esc(formatUSD(l.amount))}</td></tr>`)
    .join('');
}

/**
 * One balance sheet as HTML: assets on one side, liabilities and equity on the other, the
 * lines changed by the last step marked in words (not by color alone), and the balance
 * check. Every string is escaped; the same markup is rendered at build time and in the
 * browser.
 */
export function taccountHtml(v: SheetView): string {
  const totalLiabilities = v.liabilities.reduce((s, l) => s + l.amount, 0);
  const equityRow = `<tr class="taccount__equity${v.equityChanged ? ' is-changed' : ''}"><th scope="row">Equity${v.equityChanged ? ' <span class="taccount__mark">changed</span>' : ''}</th><td class="num">${esc(formatUSD(v.equity))}</td></tr>`;
  return (
    `<article class="taccount" data-entity="${esc(v.entity)}" aria-label="${esc(v.name)} balance sheet">` +
    `<h4 class="taccount__name">${esc(v.name)}</h4>` +
    '<div class="taccount__cols">' +
    `<table><caption class="vh">${esc(v.name)}: assets</caption><thead><tr><th scope="col">Assets</th><th scope="col" class="num">Amount</th></tr></thead><tbody>${linesHtml(v.assets)}</tbody>` +
    `<tfoot><tr><th scope="row">Total</th><td class="num">${esc(formatUSD(v.totalAssets))}</td></tr></tfoot></table>` +
    `<table><caption class="vh">${esc(v.name)}: liabilities and equity</caption><thead><tr><th scope="col">Liabilities and equity</th><th scope="col" class="num">Amount</th></tr></thead><tbody>${linesHtml(v.liabilities)}${equityRow}</tbody>` +
    `<tfoot><tr><th scope="row">Total</th><td class="num">${esc(formatUSD(totalLiabilities + v.equity))}</td></tr></tfoot></table>` +
    '</div>' +
    `<p class="taccount__check">${v.balanced ? 'Balanced: assets equal liabilities plus equity.' : 'Not balanced.'}</p>` +
    '</article>'
  );
}

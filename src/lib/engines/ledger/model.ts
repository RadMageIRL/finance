// Balance-sheet ledger: entities, instruments and state (FINANCIAL_MODEL_REQUIREMENTS
// section 7, ENGINE_CONVENTIONS section 8). Pure and immutable.
//
// Every financial instrument is stored once, as a claim with a holder and an issuer, so it
// is always the holder's asset and the issuer's liability in the same amount: symmetry
// (invariant 2) holds by construction. Equity is recorded explicitly per entity and must
// keep every balance sheet balanced (invariant 1). Amounts are illustrative whole dollars.

export const ENTITIES = ['H1', 'H2', 'Business', 'Investor', 'MMF', 'BankA', 'BankB', 'Fed', 'Treasury'] as const;
export type EntityId = (typeof ENTITIES)[number];

export type EntityKind = 'household' | 'business' | 'investor' | 'fund' | 'bank' | 'central-bank' | 'treasury';

export const ENTITY_INFO: Record<EntityId, { name: string; kind: EntityKind }> = {
  H1: { name: 'Household 1', kind: 'household' },
  H2: { name: 'Household 2', kind: 'household' },
  Business: { name: 'Business', kind: 'business' },
  Investor: { name: 'Nonbank investor', kind: 'investor' },
  MMF: { name: 'Money market fund', kind: 'fund' },
  BankA: { name: 'Bank A', kind: 'bank' },
  BankB: { name: 'Bank B', kind: 'bank' },
  Fed: { name: 'Federal Reserve', kind: 'central-bank' },
  Treasury: { name: 'Treasury', kind: 'treasury' },
};

export type Nonbank = 'H1' | 'H2' | 'Business' | 'Investor' | 'MMF';
export type Bank = 'BankA' | 'BankB';

export const NONBANKS: readonly Nonbank[] = ['H1', 'H2', 'Business', 'Investor', 'MMF'];
export const BANKS: readonly Bank[] = ['BankA', 'BankB'];

/** Where each nonbank keeps its deposit. */
export const BANK_OF: Record<Nonbank, Bank> = {
  H1: 'BankA',
  H2: 'BankB',
  Business: 'BankB',
  Investor: 'BankA',
  MMF: 'BankA',
};

export type Instrument =
  | 'deposit' // nonbank's claim on its bank
  | 'loan' // bank's claim on a nonbank borrower
  | 'reserves' // bank's claim on the Fed
  | 'tga' // Treasury General Account: the Treasury's claim on the Fed
  | 'security' // Treasury security: holder's claim on the Treasury
  | 'currency' // Federal Reserve notes held by a nonbank
  | 'vault-cash' // Federal Reserve notes held by a bank
  | 'discount-loan' // Fed's claim on a bank (discount window)
  | 'interbank-loan' // lending bank's claim on borrowing bank
  | 'reverse-repo'; // money market fund's claim on the Fed (overnight reverse repo)

export const INSTRUMENT_LABEL: Record<Instrument, { asset: string; liability: string }> = {
  deposit: { asset: 'Deposit', liability: 'Deposits' },
  loan: { asset: 'Loans', liability: 'Loan owed' },
  reserves: { asset: 'Reserves', liability: 'Reserves owed to banks' },
  tga: { asset: 'Treasury General Account', liability: 'Treasury General Account' },
  security: { asset: 'Treasury securities', liability: 'Treasury debt' },
  currency: { asset: 'Currency', liability: 'Notes outstanding' },
  'vault-cash': { asset: 'Vault cash', liability: 'Notes outstanding' },
  'discount-loan': { asset: 'Loans to banks', liability: 'Borrowings from the Fed' },
  'interbank-loan': { asset: 'Loans to other banks', liability: 'Borrowings from other banks' },
  'reverse-repo': { asset: 'Reverse repo with the Fed', liability: 'Reverse repo liability' },
};

export interface Claim {
  instrument: Instrument;
  holder: EntityId;
  issuer: EntityId;
}

/** Stable key for a claim: `instrument|holder|issuer`. */
export function claimKey(c: Claim): string {
  return `${c.instrument}|${c.holder}|${c.issuer}`;
}

export function parseClaimKey(key: string): Claim {
  const [instrument, holder, issuer] = key.split('|') as [Instrument, EntityId, EntityId];
  return { instrument, holder, issuer };
}

export interface LedgerState {
  /** Outstanding amount of each claim, by claim key. Zero balances are dropped. */
  readonly claims: Readonly<Record<string, number>>;
  readonly equity: Readonly<Record<EntityId, number>>;
}

export interface ClaimAmount extends Claim {
  amount: number;
}

/**
 * Creates a state from opening claims. Each entity's opening equity is its assets minus its
 * liabilities, so an opening state is balanced by definition.
 */
export function createState(opening: readonly ClaimAmount[]): LedgerState {
  const claims: Record<string, number> = {};
  for (const c of opening) {
    if (!Number.isInteger(c.amount) || c.amount < 0) throw new RangeError(`opening claim ${claimKey(c)} must be a whole amount of 0 or more`);
    if (c.holder === c.issuer) throw new RangeError(`opening claim ${claimKey(c)} has the same holder and issuer`);
    const key = claimKey(c);
    claims[key] = (claims[key] ?? 0) + c.amount;
    if (claims[key] === 0) delete claims[key];
  }
  const equity = Object.fromEntries(ENTITIES.map((e) => [e, 0])) as Record<EntityId, number>;
  for (const [key, amount] of Object.entries(claims)) {
    const { holder, issuer } = parseClaimKey(key);
    equity[holder] += amount;
    equity[issuer] -= amount;
  }
  return Object.freeze({ claims: Object.freeze(claims), equity: Object.freeze(equity) });
}

export function claimAmount(state: LedgerState, claim: Claim): number {
  return state.claims[claimKey(claim)] ?? 0;
}

export interface BalanceSheetLine {
  instrument: Instrument;
  counterparty: EntityId;
  label: string;
  amount: number;
}

export interface BalanceSheet {
  entity: EntityId;
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  equity: number;
  totalAssets: number;
  totalLiabilities: number;
}

export function balanceSheet(state: LedgerState, entity: EntityId): BalanceSheet {
  const assets: BalanceSheetLine[] = [];
  const liabilities: BalanceSheetLine[] = [];
  for (const [key, amount] of Object.entries(state.claims)) {
    const c = parseClaimKey(key);
    if (c.holder === entity) assets.push({ instrument: c.instrument, counterparty: c.issuer, label: INSTRUMENT_LABEL[c.instrument].asset, amount });
    if (c.issuer === entity) liabilities.push({ instrument: c.instrument, counterparty: c.holder, label: INSTRUMENT_LABEL[c.instrument].liability, amount });
  }
  const byOrder = (a: BalanceSheetLine, b: BalanceSheetLine) =>
    a.instrument.localeCompare(b.instrument) || a.counterparty.localeCompare(b.counterparty);
  assets.sort(byOrder);
  liabilities.sort(byOrder);
  return {
    entity,
    assets,
    liabilities,
    equity: state.equity[entity],
    totalAssets: assets.reduce((s, l) => s + l.amount, 0),
    totalLiabilities: liabilities.reduce((s, l) => s + l.amount, 0),
  };
}

function sumWhere(state: LedgerState, test: (c: Claim) => boolean): number {
  let total = 0;
  for (const [key, amount] of Object.entries(state.claims)) if (test(parseClaimKey(key))) total += amount;
  return total;
}

export const totalReserves = (state: LedgerState): number => sumWhere(state, (c) => c.instrument === 'reserves');
export const totalDeposits = (state: LedgerState): number => sumWhere(state, (c) => c.instrument === 'deposit');

const isNonbank = (e: EntityId): boolean => (NONBANKS as readonly EntityId[]).includes(e);

/**
 * The simulator's money measure: deposits plus currency held by nonbanks. A simplified
 * measure for teaching; never called M1 or M2.
 */
export const moneyMeasure = (state: LedgerState): number =>
  sumWhere(state, (c) => (c.instrument === 'deposit' || c.instrument === 'currency') && isNonbank(c.holder));

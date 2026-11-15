// The transaction catalog (FINANCIAL_MODEL_REQUIREMENTS 7.2, numbered as there), plus the
// payments, wages and interbank loan the modules need. Each builder returns the postings;
// applyTransaction decides whether they are allowed.
//
// Simplifications the pages must state: no dealers or clearing banks; no intraday credit;
// no taxes on income; wages, interest and purchases are equity changes without an income
// statement; a write-off is posted straight against equity (no loan loss allowance).

import type { ClaimChange, EquityChange, Transaction } from './ledger';
import { BANK_OF, type Bank, type EntityId, type Instrument, type Nonbank } from './model';

function positive(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) throw new RangeError(`amount ${amount} must be a positive whole number`);
}

const claim = (instrument: Instrument, holder: EntityId, issuer: EntityId, change: number): ClaimChange => ({
  instrument,
  holder,
  issuer,
  change,
});
const eq = (entity: EntityId, change: number): EquityChange => ({ entity, change });

/** Moves reserves from one bank to another when a payment crosses banks. */
function settle(fromBank: Bank, toBank: Bank, amount: number): ClaimChange[] {
  if (fromBank === toBank) return [];
  return [claim('reserves', fromBank, 'Fed', -amount), claim('reserves', toBank, 'Fed', amount)];
}

/** 1. A bank lends to its own customer: a loan asset and a new deposit of the same amount. */
export function bankLends(borrower: Nonbank, amount: number): Transaction {
  positive(amount);
  const bank = BANK_OF[borrower];
  return {
    kind: 'bank-lends',
    description: `${bank} lends ${amount} to ${borrower}, crediting ${borrower}'s deposit.`,
    claims: [claim('loan', bank, borrower, amount), claim('deposit', borrower, bank, amount)],
    equity: [],
  };
}

/**
 * 2. A nonbank pays another for goods, services or wages. The payer's equity falls and the
 * payee's rises (no goods are modeled). Different banks settle in reserves.
 */
export function payment(from: Nonbank, to: Nonbank, amount: number, kind = 'payment'): Transaction {
  positive(amount);
  if (from === to) throw new RangeError('payer and payee must differ');
  const fromBank = BANK_OF[from];
  const toBank = BANK_OF[to];
  return {
    kind,
    description: `${from} pays ${amount} to ${to}${fromBank === toBank ? '' : `; ${fromBank} settles with ${toBank} in reserves`}.`,
    claims: [claim('deposit', from, fromBank, -amount), claim('deposit', to, toBank, amount), ...settle(fromBank, toBank, amount)],
    equity: [eq(from, -amount), eq(to, amount)],
  };
}

/** 3. The borrower repays principal: the loan and a deposit shrink together. */
export function repayPrincipal(borrower: Nonbank, amount: number): Transaction {
  positive(amount);
  const bank = BANK_OF[borrower];
  return {
    kind: 'repay-principal',
    description: `${borrower} repays ${amount} of principal to ${bank}.`,
    claims: [claim('loan', bank, borrower, -amount), claim('deposit', borrower, bank, -amount)],
    equity: [],
  };
}

/** 4. The borrower pays interest: its deposit and equity fall; the bank's equity rises. */
export function payInterest(borrower: Nonbank, amount: number): Transaction {
  positive(amount);
  const bank = BANK_OF[borrower];
  return {
    kind: 'pay-interest',
    description: `${borrower} pays ${amount} of interest to ${bank}.`,
    claims: [claim('deposit', borrower, bank, -amount)],
    equity: [eq(borrower, -amount), eq(bank, amount)],
  };
}

/** 5. The bank writes off part of a defaulted loan, straight against its equity. */
export function writeOff(borrower: Nonbank, amount: number): Transaction {
  positive(amount);
  const bank = BANK_OF[borrower];
  return {
    kind: 'write-off',
    description: `${bank} writes off ${amount} of ${borrower}'s defaulted loan.`,
    claims: [claim('loan', bank, borrower, -amount)],
    equity: [eq(bank, -amount), eq(borrower, amount)],
  };
}

/** 6. A bank pays wages (or any expense) to a nonbank. */
export function bankPays(bank: Bank, recipient: Nonbank, amount: number): Transaction {
  positive(amount);
  const recipientBank = BANK_OF[recipient];
  return {
    kind: 'bank-pays',
    description: `${bank} pays ${amount} in wages to ${recipient}.`,
    claims: [claim('deposit', recipient, recipientBank, amount), ...settle(bank, recipientBank, amount)],
    equity: [eq(bank, -amount), eq(recipient, amount)],
  };
}

/** 7. A bank buys a Treasury security from a nonbank, paying by crediting a deposit. */
export function bankBuysSecurity(bank: Bank, seller: Nonbank, amount: number): Transaction {
  positive(amount);
  const sellerBank = BANK_OF[seller];
  return {
    kind: 'bank-buys-security',
    description: `${bank} buys a ${amount} Treasury security from ${seller}.`,
    claims: [
      claim('security', bank, 'Treasury', amount),
      claim('security', seller, 'Treasury', -amount),
      claim('deposit', seller, sellerBank, amount),
      ...settle(bank, sellerBank, amount),
    ],
    equity: [],
  };
}

/** 8. The Fed buys a Treasury security from a nonbank (simplified: no dealer shown). */
export function fedBuysFromNonbank(seller: Nonbank, amount: number): Transaction {
  positive(amount);
  const bank = BANK_OF[seller];
  return {
    kind: 'fed-buys-from-nonbank',
    description: `The Fed buys a ${amount} Treasury security from ${seller}; ${bank} credits the deposit and receives reserves.`,
    claims: [
      claim('security', 'Fed', 'Treasury', amount),
      claim('security', seller, 'Treasury', -amount),
      claim('reserves', bank, 'Fed', amount),
      claim('deposit', seller, bank, amount),
    ],
    equity: [],
  };
}

/** 9. The Fed buys a Treasury security from a bank, paying in reserves. */
export function fedBuysFromBank(bank: Bank, amount: number): Transaction {
  positive(amount);
  return {
    kind: 'fed-buys-from-bank',
    description: `The Fed buys a ${amount} Treasury security from ${bank}, paying in reserves.`,
    claims: [
      claim('security', 'Fed', 'Treasury', amount),
      claim('security', bank, 'Treasury', -amount),
      claim('reserves', bank, 'Fed', amount),
    ],
    equity: [],
  };
}

/** 10. The Fed lends reserves to a bank through the discount window. */
export function discountWindowLoan(bank: Bank, amount: number): Transaction {
  positive(amount);
  return {
    kind: 'discount-window-loan',
    description: `The Fed lends ${amount} to ${bank} through the discount window.`,
    claims: [claim('discount-loan', 'Fed', bank, amount), claim('reserves', bank, 'Fed', amount)],
    equity: [],
  };
}

/** 11. The Fed pays interest on a bank's reserve balance. */
export function interestOnReserves(bank: Bank, amount: number): Transaction {
  positive(amount);
  return {
    kind: 'interest-on-reserves',
    description: `The Fed pays ${amount} of interest on ${bank}'s reserves.`,
    claims: [claim('reserves', bank, 'Fed', amount)],
    equity: [eq('Fed', -amount), eq(bank, amount)],
  };
}

/** 12. The Treasury spends: it pays a nonbank from its account at the Fed. */
export function treasurySpends(recipient: Nonbank, amount: number): Transaction {
  positive(amount);
  const bank = BANK_OF[recipient];
  return {
    kind: 'treasury-spends',
    description: `The Treasury pays ${amount} to ${recipient} from its account at the Fed.`,
    claims: [claim('tga', 'Treasury', 'Fed', -amount), claim('reserves', bank, 'Fed', amount), claim('deposit', recipient, bank, amount)],
    equity: [eq('Treasury', -amount), eq(recipient, amount)],
  };
}

/** 13. A nonbank pays taxes: its deposit falls and the Treasury's account at the Fed rises. */
export function payTaxes(payer: Nonbank, amount: number): Transaction {
  positive(amount);
  const bank = BANK_OF[payer];
  return {
    kind: 'pay-taxes',
    description: `${payer} pays ${amount} in taxes; ${bank} pays the Treasury in reserves.`,
    claims: [claim('deposit', payer, bank, -amount), claim('reserves', bank, 'Fed', -amount), claim('tga', 'Treasury', 'Fed', amount)],
    equity: [eq(payer, -amount), eq('Treasury', amount)],
  };
}

/** 14. The Treasury sells a new security to a nonbank. */
export function treasurySells(buyer: Nonbank, amount: number): Transaction {
  positive(amount);
  const bank = BANK_OF[buyer];
  return {
    kind: 'treasury-sells',
    description: `The Treasury sells a ${amount} security to ${buyer}.`,
    claims: [
      claim('deposit', buyer, bank, -amount),
      claim('security', buyer, 'Treasury', amount),
      claim('reserves', bank, 'Fed', -amount),
      claim('tga', 'Treasury', 'Fed', amount),
    ],
    equity: [],
  };
}

/**
 * 15. A nonbank withdraws currency; its bank pays out vault cash and restocks it from the
 * Fed with reserves. Net effect: the deposit becomes currency and the bank's reserves fall.
 */
export function withdrawCurrency(holder: Nonbank, amount: number): Transaction {
  positive(amount);
  const bank = BANK_OF[holder];
  return {
    kind: 'withdraw-currency',
    description: `${holder} withdraws ${amount} in currency; ${bank} restocks its vault cash from the Fed.`,
    claims: [claim('deposit', holder, bank, -amount), claim('currency', holder, 'Fed', amount), claim('reserves', bank, 'Fed', -amount)],
    equity: [],
  };
}

/** 16. The money market fund places cash in the Fed's overnight reverse repo facility. */
export function mmfReverseRepo(amount: number): Transaction {
  positive(amount);
  const bank = BANK_OF.MMF;
  return {
    kind: 'mmf-reverse-repo',
    description: `The money market fund places ${amount} in the Fed's overnight reverse repo facility.`,
    claims: [claim('deposit', 'MMF', bank, -amount), claim('reverse-repo', 'MMF', 'Fed', amount), claim('reserves', bank, 'Fed', -amount)],
    equity: [],
  };
}

/** A bank borrows reserves from the other bank (one answer to a reserve shortfall). */
export function interbankLoan(lender: Bank, borrower: Bank, amount: number): Transaction {
  positive(amount);
  if (lender === borrower) throw new RangeError('lender and borrower must differ');
  return {
    kind: 'interbank-loan',
    description: `${lender} lends ${amount} of reserves to ${borrower}.`,
    claims: [claim('reserves', lender, 'Fed', -amount), claim('reserves', borrower, 'Fed', amount), claim('interbank-loan', lender, borrower, amount)],
    equity: [],
  };
}

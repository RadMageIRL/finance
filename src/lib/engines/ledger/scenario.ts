// A small, balanced opening position for the simulations. Illustrative whole dollars.
// Opening equity is derived (assets minus liabilities), so this is balanced by definition.

import { createState, type ClaimAmount, type LedgerState } from './model';

export const OPENING_CLAIMS: readonly ClaimAmount[] = [
  // The Fed holds Treasury securities; its liabilities are reserves, the TGA and notes.
  { instrument: 'security', holder: 'Fed', issuer: 'Treasury', amount: 800 },
  { instrument: 'reserves', holder: 'BankA', issuer: 'Fed', amount: 250 },
  { instrument: 'reserves', holder: 'BankB', issuer: 'Fed', amount: 250 },
  { instrument: 'tga', holder: 'Treasury', issuer: 'Fed', amount: 200 },
  { instrument: 'vault-cash', holder: 'BankA', issuer: 'Fed', amount: 25 },
  { instrument: 'vault-cash', holder: 'BankB', issuer: 'Fed', amount: 25 },
  { instrument: 'currency', holder: 'H1', issuer: 'Fed', amount: 25 },
  { instrument: 'currency', holder: 'H2', issuer: 'Fed', amount: 25 },
  // Other holders of Treasury securities.
  { instrument: 'security', holder: 'BankA', issuer: 'Treasury', amount: 100 },
  { instrument: 'security', holder: 'Investor', issuer: 'Treasury', amount: 150 },
  // Deposits.
  { instrument: 'deposit', holder: 'H1', issuer: 'BankA', amount: 100 },
  { instrument: 'deposit', holder: 'Investor', issuer: 'BankA', amount: 100 },
  { instrument: 'deposit', holder: 'MMF', issuer: 'BankA', amount: 100 },
  { instrument: 'deposit', holder: 'H2', issuer: 'BankB', amount: 100 },
  { instrument: 'deposit', holder: 'Business', issuer: 'BankB', amount: 100 },
];

export function openingState(): LedgerState {
  return createState(OPENING_CLAIMS);
}

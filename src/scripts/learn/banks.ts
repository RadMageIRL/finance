// How Banks Create Money: the simulator, configured for the lesson.

import { bankLends, payInterest, payment, repayPrincipal, writeOff } from '../../lib/engines/ledger/catalog';
import type { Nonbank } from '../../lib/engines/ledger/model';
import { BANK_LESSON_ENTITIES, BANK_OPENING_TEXT, BANK_STEPS, bankCounterRows, bankLessonOpening, LESSON_CAPITAL_RATIO } from '../../lib/learn/banks';
import { wireSimulator } from './simulator';

const root = document.querySelector<HTMLElement>('[data-sim-lesson="banks"]');
const CUSTOMERS: readonly Nonbank[] = ['H1', 'Business'];

if (root) {
  wireSimulator(root, {
    entities: BANK_LESSON_ENTITIES,
    opening: bankLessonOpening,
    openingText: BANK_OPENING_TEXT,
    steps: BANK_STEPS,
    counters: bankCounterRows,
    free: [
      { id: 'lend', label: 'A bank lends to its customer', parties: CUSTOMERS, make: (p, _c, a) => bankLends(p as Nonbank, a) },
      { id: 'pay', label: 'A customer pays the other', parties: CUSTOMERS, counterparties: CUSTOMERS, make: (p, c, a) => payment(p as Nonbank, c as Nonbank, a) },
      { id: 'repay', label: 'Repay loan principal', parties: CUSTOMERS, make: (p, _c, a) => repayPrincipal(p as Nonbank, a) },
      { id: 'interest', label: 'Pay loan interest', parties: CUSTOMERS, make: (p, _c, a) => payInterest(p as Nonbank, a) },
      { id: 'write-off', label: 'The bank writes off and forgives a loan', parties: CUSTOMERS, make: (p, _c, a) => writeOff(p as Nonbank, a) },
    ],
    capitalRatio: LESSON_CAPITAL_RATIO,
  });
}

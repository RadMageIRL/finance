// The balance-sheet simulator shared by the lessons: guided steps with Back, Next and Reset,
// a free mode for any transaction the lesson offers, and the labeled choices when a bank is
// short of reserves. The ledger engine does all the accounting; this file shows its states.
// Markup comes from src/lib/learn/sim.ts (escaped); everything else is set as text.

import { formatUSD } from '../../lib/calc/format';
import { parseMoney } from '../../lib/calc/parse';
import type { LedgerOptions, Transaction } from '../../lib/engines/ledger/ledger';
import { ENTITY_INFO, type EntityId, type LedgerState } from '../../lib/engines/ledger/model';
import type { FlowView } from '../../lib/learn/flow-view';
import { counters, fundingChoices, issueText, movements, runTransactions, sheetView, taccountHtml, type Counters, type FundingChoice, type GuidedStep } from '../../lib/learn/sim';

export interface FreeAction {
  id: string;
  label: string;
  parties: readonly EntityId[];
  /** For actions between two parties (a payment). */
  counterparties?: readonly EntityId[];
  make: (party: EntityId, counterparty: EntityId | null, cents: number) => Transaction;
}

export interface SimConfig {
  entities: readonly EntityId[];
  opening: () => LedgerState;
  openingText: string;
  steps: readonly GuidedStep[];
  counters: (c: Counters) => readonly { label: string; value: string }[];
  free: readonly FreeAction[];
  /** The simplified capital rule the free mode can switch on, as a fraction. */
  capitalRatio: number;
  /** A flow view drawn from each frame's transactions (How Money Flows). */
  flow?: { view: (tx: Transaction) => FlowView; svg: (view: FlowView) => string };
}

interface Frame {
  state: LedgerState;
  title: string;
  text: string;
  moves: string[];
  /** The transactions applied in this frame, for the flow view. */
  txs: Transaction[];
  message: string;
  /** Guided steps completed up to and including this frame. */
  guided: number;
}

interface Pending {
  choices: FundingChoice[];
  retry: Transaction[];
  options: LedgerOptions;
  guided: number;
  title: string;
  text: string;
}

export function wireSimulator(root: HTMLElement, cfg: SimConfig): void {
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const sheets = q('[data-sim="sheets"]');
  const flow = root.querySelector<HTMLElement>('[data-sim="flow"]');
  const countersEl = q('[data-sim="counters"]');
  const title = q('[data-sim="title"]');
  const text = q('[data-sim="text"]');
  const count = q('[data-sim="count"]');
  const moves = q('[data-sim="moves"]');
  const message = q('[data-sim="message"]');
  const choicesEl = q('[data-sim="choices"]');
  const status = q('[data-sim="status"]');
  const back = q<HTMLButtonElement>('[data-sim="back"]');
  const next = q<HTMLButtonElement>('[data-sim="next"]');
  const reset = q<HTMLButtonElement>('[data-sim="reset"]');
  const form = root.querySelector<HTMLFormElement>('[data-sim="free"]');

  let frames: Frame[] = [];
  let index = 0;
  let pending: Pending | null = null;

  function start(): void {
    frames = [{ state: cfg.opening(), title: 'The starting balance sheets', text: cfg.openingText, moves: [], txs: [], message: '', guided: 0 }];
    index = 0;
    pending = null;
  }

  function push(frame: Frame): void {
    frames = frames.slice(0, index + 1);
    frames.push(frame);
    index = frames.length - 1;
  }

  function render(announce: boolean): void {
    const frame = frames[index]!;
    const before = index > 0 ? frames[index - 1]!.state : null;
    sheets.innerHTML = cfg.entities.map((e) => taccountHtml(sheetView(frame.state, e, before))).join('');
    if (flow && cfg.flow) {
      // Markup from src/lib/learn/flow-view.ts: fixed labels and numbers, escaped.
      const views = frame.txs.map((tx) => cfg.flow!.view(tx));
      flow.innerHTML = cfg.flow.svg({ changed: new Set(views.flatMap((v) => [...v.changed])), arrows: views.flatMap((v) => v.arrows) });
    }
    countersEl.replaceChildren(
      ...cfg.counters(counters(frame.state)).map((c) => {
        const div = document.createElement('div');
        const dt = document.createElement('dt');
        dt.textContent = c.label;
        const dd = document.createElement('dd');
        dd.textContent = c.value;
        div.append(dt, dd);
        return div;
      }),
    );
    title.textContent = frame.title;
    text.textContent = frame.text;
    count.textContent = `Step ${frame.guided} of ${cfg.steps.length}${index > 0 && frames[index]!.guided === frames[index - 1]!.guided ? ' (your own transaction)' : ''}`;
    moves.replaceChildren(
      ...frame.moves.map((m) => {
        const li = document.createElement('li');
        li.textContent = m;
        return li;
      }),
    );
    moves.hidden = frame.moves.length === 0;
    message.textContent = frame.message;
    message.hidden = frame.message === '';
    const showChoices = pending !== null && index === frames.length - 1;
    choicesEl.hidden = !showChoices;
    choicesEl.replaceChildren(
      ...(showChoices
        ? pending!.choices.map((c) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'button button--secondary sim-choice';
            const strong = document.createElement('strong');
            strong.textContent = c.label;
            const note = document.createElement('span');
            note.textContent = c.note;
            button.append(strong, note);
            button.addEventListener('click', () => choose(c));
            return button;
          })
        : []),
    );
    back.disabled = index === 0;
    next.disabled = showChoices || (index === frames.length - 1 && frame.guided >= cfg.steps.length);
    if (announce) {
      const money = counters(frame.state).money;
      status.textContent = `${count.textContent}: ${frame.title}. ${frame.message || ''} Money in the model ${formatUSD(money)}.`;
    }
  }

  function apply(txs: Transaction[], options: LedgerOptions, info: { title: string; text: string; guided: number; refused?: boolean }): void {
    const from = frames[index]!.state;
    const outcome = runTransactions(from, txs, options);
    const done = outcome.applied.flatMap(movements);
    const applied = outcome.applied;
    if (outcome.stopped && info.refused) {
      push({ state: outcome.state, title: info.title, text: info.text, moves: done, txs: applied, message: `Refused: ${outcome.stopped.issues.map(issueText).join(' ')}`, guided: info.guided });
      pending = null;
      return;
    }
    if (outcome.stopped?.shortfall) {
      pending = { choices: fundingChoices(outcome.stopped.shortfall), retry: [outcome.stopped.tx, ...outcome.stopped.remaining], options, guided: info.guided, title: info.title, text: info.text };
      push({ state: outcome.state, title: info.title, text: info.text, moves: done, txs: applied, message: `Stopped: ${issueText(outcome.stopped.issues.find((i) => i.code === 'reserve-shortfall')!)} Choose what happens next.`, guided: info.guided });
      return;
    }
    pending = null;
    push({ state: outcome.state, title: info.title, text: info.text, moves: done, txs: applied, message: outcome.stopped ? `Refused: ${outcome.stopped.issues.map(issueText).join(' ')}` : '', guided: info.guided });
  }

  function choose(choice: FundingChoice): void {
    const p = pending!;
    const funding = choice.make();
    if (!funding) {
      pending = null;
      push({ state: frames[index]!.state, title: p.title, text: p.text, moves: [], txs: [], message: 'The payment was canceled; nothing moved.', guided: p.guided });
      render(true);
      return;
    }
    // A choice the other side cannot meet (a bank short of reserves to lend) leaves the
    // choices open, with the reason.
    const trial = runTransactions(frames[index]!.state, [funding], p.options);
    if (trial.stopped) {
      message.textContent = `That is not possible: ${trial.stopped.issues.map(issueText).join(' ')} Choose another way.`;
      message.hidden = false;
      status.textContent = message.textContent;
      return;
    }
    pending = null;
    apply([funding, ...p.retry], p.options, { title: p.title, text: `${choice.label}. ${choice.note}`, guided: p.guided });
    render(true);
  }

  next.addEventListener('click', () => {
    if (index < frames.length - 1) {
      index += 1;
      render(true);
      return;
    }
    const done = frames[index]!.guided;
    const step = cfg.steps[done];
    if (!step) return;
    apply(step.make(frames[index]!.state), step.options ?? {}, { title: step.title, text: step.text, guided: done + 1, ...(step.refused ? { refused: true } : {}) });
    render(true);
  });
  back.addEventListener('click', () => {
    if (index > 0) index -= 1;
    render(true);
  });
  reset.addEventListener('click', () => {
    start();
    render(true);
  });

  if (form) {
    const action = form.querySelector<HTMLSelectElement>('[name="action"]')!;
    const party = form.querySelector<HTMLSelectElement>('[name="party"]')!;
    const counterparty = form.querySelector<HTMLSelectElement>('[name="counterparty"]')!;
    const counterpartyField = form.querySelector<HTMLElement>('[data-sim="counterparty-field"]')!;
    const amount = form.querySelector<HTMLInputElement>('[name="amount"]')!;
    const capital = form.querySelector<HTMLInputElement>('[name="capital"]');
    const error = form.querySelector<HTMLElement>('[data-sim="amount-error"]')!;
    const options = (select: HTMLSelectElement, ids: readonly EntityId[]) =>
      select.replaceChildren(...ids.map((id) => Object.assign(document.createElement('option'), { value: id, textContent: ENTITY_INFO[id].name })));
    const sync = () => {
      const a = cfg.free.find((f) => f.id === action.value)!;
      options(party, a.parties);
      counterpartyField.hidden = !a.counterparties;
      if (a.counterparties) options(counterparty, a.counterparties.filter((c) => c !== party.value));
    };
    action.addEventListener('change', sync);
    party.addEventListener('change', () => {
      const a = cfg.free.find((f) => f.id === action.value)!;
      if (a.counterparties) options(counterparty, a.counterparties.filter((c) => c !== party.value));
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const parsed = parseMoney(amount.value);
      if (!parsed.ok || parsed.value <= 0) {
        error.textContent = 'Enter an amount of at least $0.01, with at most two decimal places.';
        error.hidden = false;
        amount.setAttribute('aria-invalid', 'true');
        return;
      }
      error.hidden = true;
      amount.removeAttribute('aria-invalid');
      const a = cfg.free.find((f) => f.id === action.value)!;
      const p = party.value as EntityId;
      const c = a.counterparties ? (counterparty.value as EntityId) : null;
      const ruleOn = capital?.checked ?? false;
      apply([a.make(p, c, parsed.value)], ruleOn ? { minCapitalRatio: cfg.capitalRatio } : {}, {
        title: `Your transaction: ${a.label}`,
        text: `${ENTITY_INFO[p].name}${c ? ` and ${ENTITY_INFO[c].name}` : ''}, ${formatUSD(parsed.value)}${ruleOn ? `, with the hypothetical ${Math.round(cfg.capitalRatio * 100)} percent capital rule on` : ''}.`,
        guided: frames[index]!.guided,
      });
      render(true);
    });
    sync();
  }

  start();
  render(false);
}

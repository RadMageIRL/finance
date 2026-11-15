// What Is Money?: the comparison panel. Visitors compare up to three instruments side by
// side, or read every instrument's answer to one question. All text comes from the lesson's
// data module (src/lib/learn/money.ts) and is set as text; the full comparison is also in the
// page itself, so nothing here is needed to read the lesson.

import { ANSWER_KEYS, INSTRUMENTS, QUESTIONS, sourceNumber, type Answer, type Instrument } from '../../lib/learn/money';

const root = document.querySelector<HTMLElement>('[data-money-compare]');
const MAX = 3;

function citations(answer: Answer): HTMLElement {
  const span = document.createElement('span');
  span.className = 'cites';
  for (const id of answer.sources) {
    const a = document.createElement('a');
    a.href = `#src-${id}`;
    a.className = 'cite-ref';
    a.textContent = `[${sourceNumber(id)}]`;
    a.setAttribute('aria-label', `Source ${sourceNumber(id)}`);
    span.append(' ', a);
  }
  return span;
}

function cell(tag: 'td' | 'th', answer: Answer | null, text?: string): HTMLTableCellElement {
  const el = document.createElement(tag);
  if (tag === 'th') el.scope = 'row';
  if (answer) {
    el.append(answer.text, citations(answer));
  } else el.textContent = text ?? '';
  return el;
}

if (root) {
  const output = root.querySelector<HTMLElement>('[data-out="compare"]')!;
  const status = root.querySelector<HTMLElement>('[data-out="compare-status"]')!;
  const hint = root.querySelector<HTMLElement>('[data-out="compare-hint"]')!;
  const boxes = [...root.querySelectorAll<HTMLInputElement>('input[name="mc-item"]')];
  const mode = () => root.querySelector<HTMLInputElement>('input[name="mc-mode"]:checked')?.value ?? 'side';
  const question = () => root.querySelector<HTMLInputElement>('input[name="mc-question"]:checked')?.value ?? QUESTIONS[0]!.key;

  function selected(): Instrument[] {
    const ids = boxes.filter((b) => b.checked).map((b) => b.value);
    return INSTRUMENTS.filter((i) => ids.includes(i.id));
  }

  function renderSide(): void {
    const items = selected();
    const full = items.length >= MAX;
    for (const b of boxes) b.disabled = !b.checked && full;
    hint.textContent = full ? `Up to ${MAX} at a time. Clear one to choose another.` : `Choose up to ${MAX}.`;
    if (items.length === 0) {
      output.replaceChildren(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Choose at least one kind of money to compare.' }));
      status.textContent = 'Nothing chosen to compare.';
      return;
    }
    const table = document.createElement('table');
    table.className = 'money-table';
    const caption = document.createElement('caption');
    caption.textContent = `Comparing ${items.map((i) => i.name.toLowerCase()).join(', ')}`;
    const head = document.createElement('tr');
    head.append(Object.assign(document.createElement('th'), { scope: 'col', textContent: 'Question' }));
    for (const i of items) head.append(Object.assign(document.createElement('th'), { scope: 'col', textContent: i.name }));
    const thead = document.createElement('thead');
    thead.append(head);
    const tbody = document.createElement('tbody');
    for (const q of QUESTIONS) {
      const tr = document.createElement('tr');
      tr.append(cell('th', null, q.label));
      for (const i of items) tr.append(cell('td', i.answers[q.key]));
      tbody.append(tr);
    }
    table.append(caption, thead, tbody);
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.setAttribute('role', 'region');
    wrap.tabIndex = 0;
    wrap.setAttribute('aria-label', caption.textContent);
    wrap.append(table);
    output.replaceChildren(wrap);
    status.textContent = `${caption.textContent}.`;
  }

  function renderQuestion(): void {
    const q = QUESTIONS.find((x) => x.key === question()) ?? QUESTIONS[0]!;
    const list = document.createElement('dl');
    list.className = 'money-answers';
    for (const i of INSTRUMENTS) {
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = i.name;
      const dd = document.createElement('dd');
      const answer = i.answers[q.key];
      dd.append(answer.text, citations(answer));
      div.append(dt, dd);
      list.append(div);
    }
    const heading = document.createElement('p');
    heading.className = 'money-answers__question';
    heading.textContent = q.label;
    output.replaceChildren(heading, list);
    status.textContent = `Showing every answer to: ${q.label}`;
  }

  function render(): void {
    root!.dataset.mode = mode();
    if (mode() === 'side') renderSide();
    else renderQuestion();
  }

  root.addEventListener('change', render);
  // The keys every instrument must answer; checked once so a gap fails loudly in testing.
  for (const i of INSTRUMENTS) for (const key of ANSWER_KEYS) if (!i.answers[key]) throw new Error(`money: ${i.id} has no answer for ${key}`);
  render();
}

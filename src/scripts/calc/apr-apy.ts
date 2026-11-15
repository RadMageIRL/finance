// APR/APY calculator: reads up to three accounts, runs the comparison engine, renders it.

import { formatUSD } from '../../lib/calc/format';
import { parseMoney, parsePercent } from '../../lib/calc/parse';
import { RATES_MONEY_KEYS, RATES_SHARE_SCHEMA, ratesCsv, ratesIssueMessage, ratesShareState, ratesView, type RatesInput } from '../../lib/calc/rates-view';
import { decodeShare, encodeShare, shareAmounts } from '../../lib/calc/share';
import { compareRates, type RateAccountInput, type RateComparison, type RateKind } from '../../lib/engines/rate-compare';
import type { CompoundingFrequency } from '../../lib/engines/rates';
import { $, debounce, downloadText, wireCalculator, wireChartTooltip, wireShare, wireSticky, type Evaluation } from './kit';

const root = document.querySelector<HTMLElement>('[data-calc="rates"]');

if (root) {
  const page = document.body;
  const form = $(root, 'form') as HTMLFormElement;
  const SLOTS = [0, 1, 2] as const;
  const fields: Record<string, HTMLInputElement> = { balance: $(root, '#ra-balance') as HTMLInputElement };
  for (const i of SLOTS) fields[`value${i}`] = $(root, `#ra-value-${i}`) as HTMLInputElement;
  const frequency = (i: number) => $(root, `#ra-n-${i}`) as HTMLSelectElement;
  const kind = (i: number) => (form.querySelector<HTMLInputElement>(`input[name="ra-kind-${i}"]:checked`)?.value ?? 'rate') as RateKind;
  const out = (name: string) => $(page, `[data-out="${name}"]`);
  const sharedNote = out('shared-note');
  let tooltips: string[][] = [];

  /** Keeps each account's hint in step with what its rate means. */
  function syncHints(): void {
    for (const i of SLOTS) {
      const hint = $(root!, `#ra-value-${i}-hint`);
      const blank = fields[`value${i}`]!.value.trim() === '';
      hint.textContent =
        blank && i > 0
          ? 'Leave blank to compare fewer accounts.'
          : kind(i) === 'apy'
            ? 'The annual percentage yield, which already includes compounding.'
            : 'The rate before compounding, for example 4.5.';
    }
  }

  function readInput(): { input: RatesInput | null; errors: Map<string, string> } {
    syncHints();
    const errors = new Map<string, string>();
    const balance = parseMoney(fields.balance!.value);
    if (!balance.ok) errors.set('balance', balance.reason === 'empty' ? 'Enter a balance.' : balance.reason === 'too-many-decimals' ? 'Use at most two decimal places (cents).' : 'Enter the balance as a number.');
    const accounts: (RateAccountInput | null)[] = SLOTS.map((i) => {
      const parsed = parsePercent(fields[`value${i}`]!.value);
      if (!parsed.ok) {
        // A blank account is simply left out of the comparison.
        if (parsed.reason !== 'empty') errors.set(`value${i}`, parsed.reason === 'too-many-decimals' ? 'Use at most four decimal places.' : 'Enter the rate as a number, for example 4.5.');
        return null;
      }
      return { kind: kind(i), value: parsed.value, periodsPerYear: Number(frequency(i).value) as CompoundingFrequency };
    });
    if (errors.size || !balance.ok) return { input: null, errors };
    return { input: { balance: balance.value, accounts }, errors };
  }

  function evaluate(): Evaluation<RatesInput, RateComparison> {
    const { input, errors } = readInput();
    if (!input) return { input: null, result: null, errors };
    const computed = compareRates(input.accounts, input.balance);
    if (!computed.ok) {
      for (const issue of computed.issues) {
        const { field, message } = ratesIssueMessage(issue);
        errors.set(field, message);
      }
      return { input: null, result: null, errors };
    }
    return { input, result: computed.value, errors };
  }

  const chartBox = $(page, '[data-chart]');
  const chartWidth = () => Math.round(chartBox.clientWidth) || undefined;

  const cell = (text: string, className?: string) => {
    const td = document.createElement('td');
    if (className) td.className = className;
    td.textContent = text;
    return td;
  };
  const rowHead = (text: string) => {
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = text;
    return th;
  };

  function render(_input: RatesInput, result: RateComparison): void {
    const view = ratesView(result, chartWidth());
    out('hero').textContent = view.hero;
    out('hero-note').textContent = view.heroNote;
    out('hero-sticky').textContent = view.hero;
    out('summary').textContent = view.summary;
    out('compare-rows').replaceChildren(
      ...view.rows.map((r) => {
        const tr = document.createElement('tr');
        tr.classList.toggle('is-best', r.best);
        const th = rowHead(r.name);
        if (r.best) {
          const badge = document.createElement('span');
          badge.className = 'compare-best';
          badge.textContent = ' Highest';
          th.append(badge);
        }
        const rate = cell(r.rate, 'num col-rate');
        const sub = document.createElement('span');
        sub.className = 'compare-sub';
        sub.textContent = r.compounding;
        rate.append(sub);
        tr.append(th, cell(r.apy, 'num'), rate, cell(r.interest, 'num'));
        return tr;
      }),
    );
    out('rows').replaceChildren(
      ...view.rows.map((r) => {
        const tr = document.createElement('tr');
        tr.append(rowHead(r.name), cell(r.entered), cell(r.compounding), cell(r.rate, 'num'), cell(r.periodic, 'num'), cell(r.apy, 'num'), cell(r.interest, 'num'), cell(r.after, 'num'));
        return tr;
      }),
    );
    out('by-frequency-rate').textContent = view.byFrequencyRate;
    out('by-frequency').replaceChildren(
      ...view.byFrequency.map((r) => {
        const tr = document.createElement('tr');
        tr.classList.toggle('is-current', r.current);
        tr.append(rowHead(r.label), cell(r.apy, 'num'));
        return tr;
      }),
    );
    // The SVG string is built from numbers and fixed labels only (src/lib/calc/chart.ts).
    out('chart').innerHTML = view.chartSvg;
    tooltips = view.tooltips;
  }

  const calc = wireCalculator({
    root,
    form,
    fields,
    evaluate,
    render,
    status: out('status'),
    announce: (_input, result) => `${ratesView(result).hero}. ${ratesView(result).heroNote}.`,
    changed: (current) => {
      if (!current) tooltips = [];
      share.refresh();
    },
  });

  const share = wireShare(root, 'ra', (mode) => {
    const current = calc.current();
    if (!current) return null;
    const state = shareAmounts(ratesShareState(current.input), RATES_MONEY_KEYS, mode);
    const fragment = encodeShare(RATES_SHARE_SCHEMA, state);
    if (mode === 'none') return { fragment, preview: 'The link opens with the rates and compounding filled in and the balance left blank.' };
    const shared = compareRates(current.input.accounts, state.b as number);
    if (!shared.ok) return { fragment, preview: '' };
    const view = ratesView(shared.value);
    return {
      fragment,
      preview: mode === 'rounded'
        ? `The link opens with a balance of ${formatUSD(shared.value.balance)} and ${view.hero} at the top (${view.heroNote}).`
        : `The link opens with ${view.hero} at the top (${view.heroNote}).`,
    };
  });

  function applyShared(): void {
    const state = decodeShare(RATES_SHARE_SCHEMA, location.hash);
    if (!Object.keys(state).length) return;
    const leftOut: string[] = [];
    if (typeof state.b === 'number') fields.balance!.value = (state.b / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    else if (state.a === 'none') {
      fields.balance!.value = '';
      leftOut.push('balance');
    }
    // A shared link describes all three slots: an account it leaves out is blank.
    const anyAccount = SLOTS.some((i) => typeof state[`v${i}`] === 'number');
    for (const i of SLOTS) {
      const value = state[`v${i}`];
      if (typeof value === 'number') fields[`value${i}`]!.value = String(value);
      else if (anyAccount) fields[`value${i}`]!.value = '';
      const k = state[`k${i}`];
      if (typeof k === 'string') {
        const radio = form.querySelector<HTMLInputElement>(`input[name="ra-kind-${i}"][value="${k}"]`);
        if (radio) radio.checked = true;
      }
      const n = state[`n${i}`];
      if (typeof n === 'string') frequency(i).value = n;
    }
    calc.leaveBlank(leftOut);
    sharedNote.textContent =
      state.a === 'none'
        ? 'This shared link leaves out the balance. Enter your own to see the comparison.'
        : state.a === 'rounded'
          ? 'The balance in this shared link was rounded, so the interest amounts may differ a little from the ones that were shared.'
          : '';
    sharedNote.hidden = sharedNote.textContent === '';
  }

  $(root, '[data-action="csv"]').addEventListener('click', () => {
    const current = calc.current();
    if (current) downloadText('apr-apy-comparison.csv', ratesCsv(current.result));
  });

  wireChartTooltip(chartBox, () => tooltips);
  if ('ResizeObserver' in window) {
    let width = chartWidth();
    new ResizeObserver(
      debounce(() => {
        const next = chartWidth();
        const current = calc.current();
        if (next !== width && current) {
          width = next;
          out('chart').innerHTML = ratesView(current.result, next).chartSvg;
        }
      }, 100),
    ).observe(chartBox);
  }
  wireSticky($(root, '.calc__results'), $(page, '[data-sticky]'));

  window.addEventListener('hashchange', () => {
    applyShared();
    calc.refresh(true);
  });

  applyShared();
  calc.refresh(false);
}

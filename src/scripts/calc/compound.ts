// Compound interest calculator: reads the inputs, runs the engine, renders the results.

import { compoundCsv, compoundView, frequencyInfo, issueMessage, SHARE_SCHEMA } from '../../lib/calc/compound-view';
import { formatRate } from '../../lib/calc/format';
import { parseMoney, parsePercent, parseWhole, type Parsed } from '../../lib/calc/parse';
import { decodeShare, encodeShare } from '../../lib/calc/share';
import { compoundInterest, type CompoundFrequency, type CompoundInput, type CompoundResult, type ContributionTiming } from '../../lib/engines/compound';
import { $, debounce, downloadText, setFieldError, wireChartTooltip, wireShare, wireSticky } from './kit';

const root = document.querySelector<HTMLElement>('[data-calc="compound"]');

if (root) {
  const page = document.body;
  const form = $(root, 'form') as HTMLFormElement;
  const fields = {
    principal: $(root, '#ci-principal') as HTMLInputElement,
    annualRate: $(root, '#ci-rate') as HTMLInputElement,
    years: $(root, '#ci-years') as HTMLInputElement,
    contribution: $(root, '#ci-contribution') as HTMLInputElement,
  };
  const labels: Record<string, string> = {
    principal: 'Starting balance',
    annualRate: 'Annual interest rate',
    years: 'Years',
    contribution: 'Contribution',
    periodsPerYear: 'Compounding',
  };
  const frequency = $(root, '#ci-frequency') as HTMLSelectElement;
  const timing = () => (form.querySelector<HTMLInputElement>('input[name="ci-timing"]:checked')?.value ?? 'end') as ContributionTiming;
  const out = (name: string) => $(page, `[data-out="${name}"]`);
  const contributionHint = $(root, '#ci-contribution-hint');

  let lastInput: CompoundInput | null = null;
  let lastResult: CompoundResult | null = null;
  let tooltips: string[][] = [];

  const parseMessages: Record<string, (label: string) => string> = {
    empty: (label) => `Enter ${label.toLowerCase()}.`,
    'not-a-number': (label) => `Enter ${label.toLowerCase()} as a number.`,
    'too-many-decimals': (label) => (label === 'Years' ? 'Years must be a whole number.' : label.includes('rate') ? 'Use at most four decimal places.' : 'Use at most two decimal places (cents).'),
  };

  function read(): { input: CompoundInput | null; errors: Map<string, string> } {
    const errors = new Map<string, string>();
    const take = <T>(key: keyof typeof fields, parsed: Parsed<T>): T | undefined => {
      if (parsed.ok) return parsed.value;
      errors.set(key, parseMessages[parsed.reason]!(labels[key]!));
      return undefined;
    };
    const principal = take('principal', parseMoney(fields.principal.value));
    const ratePercent = take('annualRate', parsePercent(fields.annualRate.value));
    const years = take('years', parseWhole(fields.years.value));
    const contribution = take('contribution', parseMoney(fields.contribution.value));
    if (errors.size) return { input: null, errors };
    return {
      input: {
        principal: principal!,
        annualRate: ratePercent!,
        periodsPerYear: Number(frequency.value) as CompoundFrequency,
        years: years!,
        contribution: contribution!,
        timing: timing(),
      },
      errors,
    };
  }

  const chartBox = $(page, '[data-chart]');
  const chartWidth = () => Math.round(chartBox.clientWidth) || undefined;

  function render(input: CompoundInput, result: CompoundResult) {
    const view = compoundView(input, result, chartWidth());
    out('final').textContent = view.final;
    out('final-again').textContent = view.final;
    out('final-sticky').textContent = view.final;
    out('principal').textContent = view.breakdown[0]!.value;
    out('contributions').textContent = view.breakdown[1]!.value;
    out('interest').textContent = view.breakdown[2]!.value;
    out('summary').textContent = view.summary;
    out('total-contributions').textContent = view.totals.contributions;
    out('total-interest').textContent = view.totals.interest;
    out('total-end').textContent = view.totals.end;
    // The SVG string is built from numbers and fixed labels only (src/lib/calc/chart.ts).
    out('chart').innerHTML = view.chartSvg;
    const body = out('rows');
    body.replaceChildren(
      ...view.rows.map((r) => {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = String(r.year);
        tr.append(th);
        for (const value of [r.start, r.contributions, r.interest, r.end]) {
          const td = document.createElement('td');
          td.className = 'num';
          td.textContent = value;
          tr.append(td);
        }
        return tr;
      }),
    );
    tooltips = view.tooltips;
  }

  function update(announce: boolean) {
    const { input, errors } = read();
    let result: CompoundResult | null = null;
    if (input) {
      const computed = compoundInterest(input);
      if (computed.ok) result = computed.value;
      else for (const issue of computed.issues) errors.set(issue.field, issueMessage(issue, labels[issue.field] ?? issue.field));
    }
    for (const [key, el] of Object.entries(fields)) setFieldError(el, errors.get(key) ?? null);
    contributionHint.textContent = `Added once a ${frequencyInfo(Number(frequency.value) as CompoundFrequency).period}, at its ${timing()}. Enter 0 for none.`;

    if (!input || !result) {
      root!.dataset.state = 'invalid';
      lastInput = null;
      lastResult = null;
      tooltips = [];
      if (announce) out('status').textContent = 'Results hidden until the highlighted entries are fixed.';
      return;
    }
    root!.dataset.state = 'ok';
    lastInput = input;
    lastResult = result;
    render(input, result);
    share.refresh();
    if (announce) out('status').textContent = `Projected balance ${out('final').textContent}.`;
  }

  // Share links: whole cents, the rate as a percent, and the two choices.
  const share = wireShare(root, 'ci', (round) => {
    if (!lastInput) return '';
    const principal = round ? Math.round(lastInput.principal / 100_000) * 100_000 : lastInput.principal;
    return encodeShare(SHARE_SCHEMA, {
      p: principal,
      r: formatRate(lastInput.annualRate).replace('%', ''),
      n: String(lastInput.periodsPerYear),
      y: lastInput.years,
      c: lastInput.contribution,
      t: lastInput.timing,
    });
  });

  function applyShared(): void {
    const state = decodeShare(SHARE_SCHEMA, location.hash);
    const money = (cents: number) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (typeof state.p === 'number') fields.principal.value = money(state.p);
    if (typeof state.r === 'number') fields.annualRate.value = String(state.r);
    if (typeof state.n === 'string') frequency.value = state.n;
    if (typeof state.y === 'number') fields.years.value = String(state.y);
    if (typeof state.c === 'number') fields.contribution.value = money(state.c);
    if (typeof state.t === 'string') {
      const radio = form.querySelector<HTMLInputElement>(`input[name="ci-timing"][value="${state.t}"]`);
      if (radio) radio.checked = true;
    }
  }

  $(root, '[data-action="csv"]').addEventListener('click', () => {
    if (lastResult) downloadText('compound-interest.csv', compoundCsv(lastResult));
  });

  const later = debounce(() => update(true), 250);
  form.addEventListener('input', (event) => (event.target instanceof HTMLSelectElement || (event.target as HTMLInputElement).type === 'radio' ? update(true) : later()));
  form.addEventListener('change', () => update(true));
  form.addEventListener('submit', (event) => event.preventDefault());

  wireChartTooltip(chartBox, () => tooltips);

  // Redraw the chart at its real width so its text stays readable on any screen.
  if ('ResizeObserver' in window) {
    let width = chartWidth();
    new ResizeObserver(
      debounce(() => {
        const next = chartWidth();
        if (next !== width && lastInput && lastResult) {
          width = next;
          out('chart').innerHTML = compoundView(lastInput, lastResult, next).chartSvg;
        }
      }, 100),
    ).observe(chartBox);
  }
  wireSticky($(root, '.calc__results'), $(page, '[data-sticky]'));

  // A different share link pasted into this tab changes only the fragment: apply it too.
  window.addEventListener('hashchange', () => {
    applyShared();
    update(true);
  });

  applyShared();
  update(false);
}

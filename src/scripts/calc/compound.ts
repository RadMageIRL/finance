// Compound interest calculator: reads the inputs, runs the engine, renders the results,
// the schedule, and the exports.

import {
  compoundChartSvg,
  compoundReport,
  compoundSchedule,
  compoundScheduleConfig,
  compoundScheduleNotes,
  compoundShareState,
  compoundView,
  contributionPhrase,
  issueMessage,
  SHARE_MONEY_KEYS,
  SHARE_SCHEMA,
} from '../../lib/calc/compound-view';
import { formatUSD } from '../../lib/calc/format';
import { contributionHint, contributionOption } from '../../lib/calc/frequency';
import { parseMoney, parsePercent, parseWhole, type Parsed } from '../../lib/calc/parse';
import { groupingOption, scheduleTable, scheduleTooltip } from '../../lib/calc/schedule-view';
import { decodeShare, encodeShare, shareAmounts } from '../../lib/calc/share';
import { compoundInterest, type CompoundFrequency, type CompoundInput, type CompoundResult, type ContributionFrequency, type ContributionTiming } from '../../lib/engines/compound';
import type { Grouping, Schedule } from '../../lib/engines/schedule';
import { wireExports } from './exports';
import { $, wireCalculator, wireShare, wireSticky, type Evaluation } from './kit';
import { wireSchedule } from './schedule';

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
    contribution: 'Contribution amount',
    periodsPerYear: 'Compounding',
    contributionFrequency: 'Contribution frequency',
  };
  const compounding = $(root, '#ci-frequency') as HTMLSelectElement;
  const contributionFrequency = $(root, '#ci-contribution-frequency') as HTMLSelectElement;
  const timing = () => (form.querySelector<HTMLInputElement>('input[name="ci-timing"]:checked')?.value ?? 'end') as ContributionTiming;
  const out = (name: string) => $(page, `[data-out="${name}"]`);
  const contributionFields = root.querySelectorAll<HTMLElement>('[data-contribution]');
  const contributionHintEl = $(root, '#ci-contribution-hint');
  const sharedNote = out('shared-note');

  /** The schedule of the result on screen, built once per result. */
  let shown: { input: CompoundInput; result: CompoundResult; schedule: Schedule } | null = null;

  const parseMessages: Record<string, (label: string) => string> = {
    empty: (label) => `Enter ${label.toLowerCase()}.`,
    'not-a-number': (label) => `Enter ${label.toLowerCase()} as a number.`,
    'too-many-decimals': (label) => (label === 'Years' ? 'Years must be a whole number.' : label.includes('rate') ? 'Use at most four decimal places.' : 'Use at most two decimal places (cents).'),
  };

  /** Shows or hides the amount and timing fields, which mean nothing without contributions. */
  function syncContributionFields(): void {
    const frequency = contributionFrequency.value as ContributionFrequency;
    for (const el of contributionFields) el.hidden = frequency === 'none';
    contributionHintEl.textContent = contributionHint(frequency, timing());
    const interval = contributionOption(frequency).interval;
    if (interval) {
      $(root!, '[data-choice-label="end"]').textContent = `End of each ${interval}`;
      $(root!, '[data-choice-label="start"]').textContent = `Start of each ${interval}`;
    }
  }

  function evaluate(): Evaluation<CompoundInput, CompoundResult> {
    syncContributionFields();
    const errors = new Map<string, string>();
    const take = <T>(key: keyof typeof fields, parsed: Parsed<T>): T | undefined => {
      if (parsed.ok) return parsed.value;
      errors.set(key, parseMessages[parsed.reason]!(labels[key]!));
      return undefined;
    };
    const frequency = contributionFrequency.value as ContributionFrequency;
    const principal = take('principal', parseMoney(fields.principal.value));
    const annualRate = take('annualRate', parsePercent(fields.annualRate.value));
    const years = take('years', parseWhole(fields.years.value));
    // Without contributions the amount field is hidden and ignored, whatever it holds.
    const contribution = frequency === 'none' ? 0 : take('contribution', parseMoney(fields.contribution.value));
    if (errors.size) return { input: null, result: null, errors };
    const input: CompoundInput = {
      principal: principal!,
      annualRate: annualRate!,
      periodsPerYear: Number(compounding.value) as CompoundFrequency,
      years: years!,
      contributionFrequency: frequency,
      contribution: contribution!,
      timing: timing(),
    };
    const computed = compoundInterest(input);
    if (!computed.ok) {
      for (const issue of computed.issues) errors.set(issue.field, issueMessage(issue, labels[issue.field] ?? issue.field));
      return { input: null, result: null, errors };
    }
    return { input, result: computed.value, errors };
  }

  const schedule = wireSchedule($(page, '#ci-schedule'), (g) => {
    out('export-grouping').textContent = groupingOption(g).noun;
  });

  function render(input: CompoundInput, result: CompoundResult) {
    const view = compoundView(input, result);
    out('final').textContent = view.final;
    out('final-again').textContent = view.final;
    out('final-sticky').textContent = view.final;
    out('principal').textContent = view.breakdown[0]!.value;
    out('contributions').textContent = view.breakdown[1]!.value;
    out('interest').textContent = view.breakdown[2]!.value;
    out('summary').textContent = view.summary;
    const rows = compoundSchedule(input, result);
    shown = { input, result, schedule: rows };
    const config = compoundScheduleConfig(input);
    schedule.update({
      table: (g: Grouping) => scheduleTable(rows, g, config),
      chart: (g: Grouping, width?: number) => compoundChartSvg(input, rows, g, view.summary, width ? { width } : {}),
      tooltip: (g: Grouping, i: number) => scheduleTooltip(rows, g, input.principal, 'Contributions', i),
      notes: (g: Grouping) => compoundScheduleNotes(input, g),
    });
  }

  const calc = wireCalculator({
    root,
    form,
    fields,
    evaluate,
    render,
    status: out('status'),
    announce: (_input, result) => `Projected balance ${formatUSD(result.finalBalance)}.`,
    changed: (current) => {
      if (!current) shown = null;
      share.refresh();
    },
  });

  // Share links: the scenario in the fragment, with the amounts exact, rounded or left out.
  // A rounded link's results are recalculated from its rounded amounts, as the person
  // opening it will see them.
  const share = wireShare(root, 'ci', (mode) => {
    const current = calc.current();
    if (!current) return null;
    const state = shareAmounts(compoundShareState(current.input), SHARE_MONEY_KEYS, mode);
    const fragment = encodeShare(SHARE_SCHEMA, state);
    if (mode === 'none') return { fragment, preview: 'The link opens with the dollar amounts left blank.' };
    const shared: CompoundInput = { ...current.input, principal: state.p as number, contribution: typeof state.c === 'number' ? state.c : 0 };
    const recomputed = compoundInterest(shared);
    if (!recomputed.ok) return { fragment, preview: '' };
    const what = mode === 'rounded'
      ? `The link opens with a starting balance of ${formatUSD(shared.principal)}, ${contributionPhrase(shared, recomputed.value)}, and a projected balance of ${formatUSD(recomputed.value.finalBalance)}.`
      : `The link opens with a projected balance of ${formatUSD(recomputed.value.finalBalance)}.`;
    return { fragment, preview: what };
  });

  function applyShared(): void {
    const state = decodeShare(SHARE_SCHEMA, location.hash);
    if (!Object.keys(state).length) return;
    const money = (cents: number) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const leftOut: string[] = [];
    const amount = (key: 'principal' | 'contribution', value: unknown) => {
      if (typeof value === 'number') fields[key].value = money(value);
      else if (state.a === 'none') {
        fields[key].value = '';
        leftOut.push(key);
      }
    };
    amount('principal', state.p);
    if (typeof state.r === 'number') fields.annualRate.value = String(state.r);
    if (typeof state.n === 'string') compounding.value = state.n;
    if (typeof state.y === 'number') fields.years.value = String(state.y);
    if (typeof state.f === 'string') contributionFrequency.value = state.f;
    amount('contribution', state.c);
    if (typeof state.t === 'string') {
      const radio = form.querySelector<HTMLInputElement>(`input[name="ci-timing"][value="${state.t}"]`);
      if (radio) radio.checked = true;
    }
    calc.leaveBlank(leftOut);
    sharedNote.textContent =
      state.a === 'none'
        ? 'This shared link leaves out the dollar amounts. Enter your own to see results.'
        : state.a === 'rounded'
          ? 'The amounts in this shared link were rounded, so these results may differ a little from the ones that were shared.'
          : '';
    sharedNote.hidden = sharedNote.textContent === '';
  }

  wireExports(
    root,
    {
      name: 'compound-interest',
      report: (generated) => {
        calc.current();
        return shown ? compoundReport(shown.input, shown.result, shown.schedule, schedule.grouping(), generated) : null;
      },
      csv: () => {
        calc.current();
        if (!shown) return null;
        const g = schedule.grouping();
        return { table: scheduleTable(shown.schedule, g, compoundScheduleConfig(shown.input)), what: groupingOption(g).heading };
      },
    },
    () => calc.settle(),
  );

  wireSticky($(root, '.calc__results'), $(page, '[data-sticky]'));

  // A different share link pasted into this tab changes only the fragment: apply it too.
  window.addEventListener('hashchange', () => {
    applyShared();
    calc.refresh(true);
  });

  applyShared();
  calc.refresh(false);
}

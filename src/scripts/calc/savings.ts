// High-yield savings calculator: reads the inputs, runs the savings engine, renders results,
// the schedule, and the exports.

import { formatUSD } from '../../lib/calc/format';
import { contributionHint, contributionOption } from '../../lib/calc/frequency';
import { parseMoney, parsePercent, parseWhole, type Parsed } from '../../lib/calc/parse';
import {
  CHANGE_SLOTS,
  SAVINGS_MONEY_KEYS,
  SAVINGS_SHARE_SCHEMA,
  savingsChartSvg,
  savingsIssueMessage,
  savingsReport,
  savingsSchedule,
  savingsScheduleConfig,
  savingsScheduleNotes,
  savingsShareState,
  savingsView,
} from '../../lib/calc/savings-view';
import { groupingOption, scheduleTable, scheduleTooltip } from '../../lib/calc/schedule-view';
import { decodeShare, encodeShare, shareAmounts } from '../../lib/calc/share';
import type { ContributionFrequency, ContributionTiming } from '../../lib/engines/calendar';
import { savingsGrowth, type HysaCompounding, type HysaInput, type HysaResult, type RateStep } from '../../lib/engines/hysa';
import type { Grouping, Schedule } from '../../lib/engines/schedule';
import { wireExports } from './exports';
import { $, wireCalculator, wireShare, wireSticky, type Evaluation } from './kit';
import { wireSchedule } from './schedule';

const root = document.querySelector<HTMLElement>('[data-calc="savings"]');

if (root) {
  const page = document.body;
  const form = $(root, 'form') as HTMLFormElement;
  const input = (id: string) => $(root, `#${id}`) as HTMLInputElement;
  const fields: Record<string, HTMLInputElement> = {
    principal: input('sg-principal'),
    r0: input('sg-apy'),
    years: input('sg-years'),
    contribution: input('sg-contribution'),
  };
  for (const slot of CHANGE_SLOTS) {
    fields[`m${slot}`] = input(`sg-m${slot}`);
    fields[`r${slot}`] = input(`sg-r${slot}`);
  }
  const compounding = $(root, '#sg-compounding') as HTMLSelectElement;
  const frequency = $(root, '#sg-contribution-frequency') as HTMLSelectElement;
  const timing = () => (form.querySelector<HTMLInputElement>('input[name="sg-timing"]:checked')?.value ?? 'end') as ContributionTiming;
  const out = (name: string) => $(page, `[data-out="${name}"]`);
  const sharedNote = out('shared-note');
  const contributionFields = root.querySelectorAll<HTMLElement>('[data-contribution]');
  /** For each engine rate step after the first, the change row it came from. */
  let slots: number[] = [];
  /** The schedule of the result on screen, built once per result. */
  let shown: { input: HysaInput; result: HysaResult; schedule: Schedule } | null = null;

  const reasonText = (reason: string, kind: 'money' | 'percent' | 'whole') =>
    reason === 'empty'
      ? 'Enter a value.'
      : reason === 'too-many-decimals'
        ? kind === 'whole'
          ? 'Use a whole number.'
          : kind === 'percent'
            ? 'Use at most four decimal places.'
            : 'Use at most two decimal places (cents).'
        : 'Enter a number.';

  function syncContributionFields(): void {
    const f = frequency.value as ContributionFrequency;
    for (const el of contributionFields) el.hidden = f === 'none';
    $(root!, '#sg-contribution-hint').textContent = contributionHint(f, timing());
    const interval = contributionOption(f).interval;
    if (interval) {
      $(root!, '[data-choice-label="end"]').textContent = `End of each ${interval}`;
      $(root!, '[data-choice-label="start"]').textContent = `Start of each ${interval}`;
    }
  }

  function evaluate(): Evaluation<HysaInput, HysaResult> {
    syncContributionFields();
    const errors = new Map<string, string>();
    const take = <T>(key: string, parsed: Parsed<T>, kind: 'money' | 'percent' | 'whole'): T | undefined => {
      if (parsed.ok) return parsed.value;
      errors.set(key, reasonText(parsed.reason, kind));
      return undefined;
    };
    const f = frequency.value as ContributionFrequency;
    const principal = take('principal', parseMoney(fields.principal!.value), 'money');
    const apy = take('r0', parsePercent(fields.r0!.value), 'percent');
    const years = take('years', parseWhole(fields.years!.value), 'whole');
    const contribution = f === 'none' ? 0 : take('contribution', parseMoney(fields.contribution!.value), 'money');
    const rates: RateStep[] = [];
    slots = [];
    for (const slot of CHANGE_SLOTS) {
      const monthText = fields[`m${slot}`]!.value.trim();
      const apyText = fields[`r${slot}`]!.value.trim();
      if (monthText === '' && apyText === '') continue;
      if (monthText === '' || apyText === '') {
        errors.set(monthText === '' ? `m${slot}` : `r${slot}`, 'Enter both the month and the APY, or leave both blank.');
        continue;
      }
      const month = take(`m${slot}`, parseWhole(monthText), 'whole');
      const changeApy = take(`r${slot}`, parsePercent(apyText), 'percent');
      if (month !== undefined && changeApy !== undefined) {
        rates.push({ fromMonth: month, apy: changeApy });
        slots.push(slot);
      }
    }
    if (errors.size) return { input: null, result: null, errors };
    const scenario: HysaInput = {
      principal: principal!,
      years: years!,
      compounding: compounding.value as HysaCompounding,
      rates: [{ fromMonth: 1, apy: apy! }, ...rates],
      contributionFrequency: f,
      contribution: contribution!,
      timing: timing(),
    };
    const computed = savingsGrowth(scenario);
    if (!computed.ok) {
      for (const issue of computed.issues) {
        const { field, message } = savingsIssueMessage(issue, slots);
        errors.set(field, message);
      }
      return { input: null, result: null, errors };
    }
    return { input: scenario, result: computed.value, errors };
  }

  const schedule = wireSchedule($(page, '#sg-schedule'), (g) => {
    out('export-grouping').textContent = groupingOption(g).noun;
  });

  function render(scenario: HysaInput, result: HysaResult): void {
    const view = savingsView(scenario, result);
    out('final').textContent = view.final;
    out('final-again').textContent = view.final;
    out('final-sticky').textContent = view.final;
    out('principal').textContent = view.breakdown[0]!.value;
    out('contributions').textContent = view.breakdown[1]!.value;
    out('interest').textContent = view.breakdown[2]!.value;
    out('summary').textContent = view.summary;
    out('rates').replaceChildren(
      ...view.rates.map((r) => {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = r.months;
        tr.append(th);
        for (const [text, cls] of [[r.apy, 'num'], [r.rate, 'num col-rate'], [r.earned, 'num']] as const) {
          const td = document.createElement('td');
          td.className = cls;
          td.textContent = text;
          tr.append(td);
        }
        return tr;
      }),
    );
    const rows = savingsSchedule(scenario, result);
    shown = { input: scenario, result, schedule: rows };
    const config = savingsScheduleConfig(result);
    schedule.update({
      table: (g: Grouping) => scheduleTable(rows, g, config),
      chart: (g: Grouping, width?: number) => savingsChartSvg(scenario, rows, g, view.summary, width ? { width } : {}),
      tooltip: (g: Grouping, i: number) => scheduleTooltip(rows, g, scenario.principal, 'Deposits', i),
      notes: (g: Grouping) => savingsScheduleNotes(scenario, g),
    });
  }

  const calc = wireCalculator({
    root,
    form,
    fields,
    evaluate,
    render,
    status: out('status'),
    announce: (_scenario, result) => `Projected balance ${formatUSD(result.finalBalance)}.`,
    changed: (current) => {
      if (!current) shown = null;
      share.refresh();
    },
  });

  const share = wireShare(root, 'sg', (mode) => {
    const current = calc.current();
    if (!current) return null;
    const state = shareAmounts(savingsShareState(current.input), SAVINGS_MONEY_KEYS, mode);
    const fragment = encodeShare(SAVINGS_SHARE_SCHEMA, state);
    if (mode === 'none') return { fragment, preview: 'The link opens with the rates and schedule filled in and the dollar amounts left blank.' };
    const shared: HysaInput = { ...current.input, principal: state.p as number, contribution: typeof state.c === 'number' ? state.c : 0 };
    const recomputed = savingsGrowth(shared);
    if (!recomputed.ok) return { fragment, preview: '' };
    return {
      fragment,
      preview:
        mode === 'rounded'
          ? `The link opens with a starting balance of ${formatUSD(shared.principal)}${shared.contributionFrequency === 'none' ? '' : ` and deposits of ${formatUSD(shared.contribution)}`}, and a projected balance of ${formatUSD(recomputed.value.finalBalance)}.`
          : `The link opens with a projected balance of ${formatUSD(recomputed.value.finalBalance)}.`,
    };
  });

  wireExports(
    root,
    {
      name: 'savings',
      report: (generated) => {
        calc.current();
        return shown ? savingsReport(shown.input, shown.result, shown.schedule, schedule.grouping(), generated) : null;
      },
      csv: () => {
        calc.current();
        if (!shown) return null;
        const g = schedule.grouping();
        return { table: scheduleTable(shown.schedule, g, savingsScheduleConfig(shown.result)), what: groupingOption(g).heading };
      },
    },
    () => calc.settle(),
  );

  function applyShared(): void {
    const state = decodeShare(SAVINGS_SHARE_SCHEMA, location.hash);
    if (!Object.keys(state).length) return;
    const money = (cents: number) => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const leftOut: string[] = [];
    const amount = (key: 'principal' | 'contribution', value: unknown) => {
      if (typeof value === 'number') fields[key]!.value = money(value);
      else if (state.a === 'none') {
        fields[key]!.value = '';
        leftOut.push(key);
      }
    };
    amount('principal', state.p);
    if (typeof state.r0 === 'number') fields.r0!.value = String(state.r0);
    if (typeof state.cmp === 'string') compounding.value = state.cmp;
    if (typeof state.y === 'number') fields.years!.value = String(state.y);
    // A shared link describes every change row: one it leaves out is blank.
    for (const slot of CHANGE_SLOTS) {
      const m = state[`m${slot}`];
      const r = state[`r${slot}`];
      fields[`m${slot}`]!.value = typeof m === 'number' ? String(m) : '';
      fields[`r${slot}`]!.value = typeof r === 'number' ? String(r) : '';
    }
    if (typeof state.f === 'string') frequency.value = state.f;
    amount('contribution', state.c);
    if (typeof state.t === 'string') {
      const radio = form.querySelector<HTMLInputElement>(`input[name="sg-timing"][value="${state.t}"]`);
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

  wireSticky($(root, '.calc__results'), $(page, '[data-sticky]'));

  window.addEventListener('hashchange', () => {
    applyShared();
    calc.refresh(true);
  });

  applyShared();
  calc.refresh(false);
}

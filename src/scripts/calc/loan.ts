// Loan amortization calculator: reads the inputs, runs the loan engine, renders the results,
// the schedule, and the exports.

import { formatUSD } from '../../lib/calc/format';
import {
  AMORTIZATION_MONEY_KEYS,
  AMORTIZATION_SHARE_SCHEMA,
  amortizationReport,
  dateLabel,
  loanChartSvg,
  loanIssueMessage,
  loanScheduleNotes,
  loanShareState,
  loanTable,
  loanTooltip,
  loanView,
  termMonths,
  type LoanGrouping,
  type TermUnit,
} from '../../lib/calc/loan-view';
import { parseMoney, parsePercent, parseWhole, type Parsed } from '../../lib/calc/parse';
import { decodeShare, encodeShare, shareAmounts } from '../../lib/calc/share';
import type { LoanInput } from '../../lib/engines/loan';
import { loanPlan, type LoanPlan, type PaymentDate } from '../../lib/engines/loan-report';
import { wireExports } from './exports';
import { $, wireCalculator, wireShare, wireSticky, type Evaluation } from './kit';
import { wireSchedule } from './schedule';

interface Scenario {
  loan: LoanInput;
  first: PaymentDate;
  term: { value: number; unit: TermUnit };
}

const root = document.querySelector<HTMLElement>('[data-calc="loan"]');

if (root) {
  const page = document.body;
  const form = $(root, 'form') as HTMLFormElement;
  const input = (id: string) => $(root, `#${id}`) as HTMLInputElement;
  const fields: Record<string, HTMLInputElement> = {
    principal: input('la-principal'),
    rate: input('la-rate'),
    term: input('la-term'),
    firstYear: input('la-first-year'),
  };
  const unit = $(root, '#la-term-unit') as HTMLSelectElement;
  const firstMonth = $(root, '#la-first-month') as HTMLSelectElement;
  const out = (name: string) => $(page, `[data-out="${name}"]`);
  const sharedNote = out('shared-note');

  const reasonText = (reason: string, kind: 'money' | 'percent' | 'whole') =>
    reason === 'empty' ? 'Enter a value.' : reason === 'too-many-decimals' ? (kind === 'whole' ? 'Use a whole number.' : kind === 'percent' ? 'Use at most four decimal places.' : 'Use at most two decimal places (cents).') : 'Enter a number.';

  function evaluate(): Evaluation<Scenario, LoanPlan> {
    const errors = new Map<string, string>();
    const take = <T>(key: string, parsed: Parsed<T>, kind: 'money' | 'percent' | 'whole'): T | undefined => {
      if (parsed.ok) return parsed.value;
      errors.set(key, reasonText(parsed.reason, kind));
      return undefined;
    };
    const principal = take('principal', parseMoney(fields.principal!.value), 'money');
    const rate = take('rate', parsePercent(fields.rate!.value), 'percent');
    const term = take('term', parseWhole(fields.term!.value), 'whole');
    const year = take('firstYear', parseWhole(fields.firstYear!.value), 'whole');
    if (errors.size) return { input: null, result: null, errors };
    const scenario: Scenario = {
      loan: { principal: principal!, annualRate: rate!, termMonths: termMonths(term!, unit.value as TermUnit) },
      first: { year: year!, month: Number(firstMonth.value) },
      term: { value: term!, unit: unit.value as TermUnit },
    };
    const computed = loanPlan(scenario.loan, scenario.first);
    if (!computed.ok) {
      for (const issue of computed.issues) {
        const { field, message } = loanIssueMessage(issue);
        if (!errors.has(field)) errors.set(field, message);
      }
      return { input: null, result: null, errors };
    }
    return { input: scenario, result: computed.value, errors };
  }

  const schedule = wireSchedule($(page, '#la-schedule'), (g) => {
    out('export-grouping').textContent = g;
  });

  function render(scenario: Scenario, plan: LoanPlan): void {
    const view = loanView(scenario.loan, plan);
    out('payment').textContent = view.payment;
    out('payment-sticky').textContent = view.payment;
    out('payoff').textContent = view.payoff;
    view.breakdown.forEach((b, i) => {
      out(`breakdown-${i}`).textContent = b.value;
    });
    out('summary').textContent = view.summary;
    schedule.update({
      table: (g) => loanTable(plan, g as LoanGrouping, { extra: false }),
      chart: (g, width) => loanChartSvg(plan, g as LoanGrouping, view.summary, width ? { width } : {}),
      tooltip: (g, i) => loanTooltip(plan, g as LoanGrouping, i),
      notes: (g) => loanScheduleNotes(g as LoanGrouping, false),
    });
  }

  const calc = wireCalculator({
    root,
    form,
    fields,
    evaluate,
    render,
    status: out('status'),
    announce: (_s, plan) => `Monthly payment ${formatUSD(plan.schedule.payment)}, paid off ${dateLabel(plan.payoff)}.`,
    changed: () => share.refresh(),
  });

  const share = wireShare(root, 'la', (mode) => {
    const current = calc.current();
    if (!current) return null;
    const state = shareAmounts(loanShareState(current.input.loan, current.input.term, current.input.first), AMORTIZATION_MONEY_KEYS, mode);
    const fragment = encodeShare(AMORTIZATION_SHARE_SCHEMA, state);
    if (mode === 'none') return { fragment, preview: 'The link opens with the rate, term and dates filled in and the loan amount left blank.' };
    const shared = loanPlan({ ...current.input.loan, principal: state.p as number }, current.input.first);
    if (!shared.ok) return { fragment, preview: '' };
    return {
      fragment,
      preview: mode === 'rounded' ? `The link opens with a loan of ${formatUSD(state.p as number)} and a monthly payment of ${formatUSD(shared.value.schedule.payment)}.` : `The link opens with a monthly payment of ${formatUSD(shared.value.schedule.payment)}.`,
    };
  });

  wireExports(
    root,
    {
      name: 'loan-amortization',
      report: (generated) => {
        const current = calc.current();
        return current ? amortizationReport(current.input.loan, current.input.first, current.result, schedule.grouping() as LoanGrouping, generated) : null;
      },
      csv: () => {
        const current = calc.current();
        if (!current) return null;
        const g = schedule.grouping() as LoanGrouping;
        return { table: loanTable(current.result, g, { extra: false }), what: g === 'year' ? 'schedule by year' : 'schedule by payment' };
      },
    },
    () => calc.settle(),
  );

  function applyShared(): void {
    const state = decodeShare(AMORTIZATION_SHARE_SCHEMA, location.hash);
    if (!Object.keys(state).length) return;
    const leftOut: string[] = [];
    if (typeof state.p === 'number') fields.principal!.value = (state.p / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    else if (state.a === 'none') {
      fields.principal!.value = '';
      leftOut.push('principal');
    }
    if (typeof state.r === 'number') fields.rate!.value = String(state.r);
    if (typeof state.t === 'number') fields.term!.value = String(state.t);
    if (typeof state.u === 'string') unit.value = state.u;
    if (typeof state.fy === 'number') fields.firstYear!.value = String(state.fy);
    if (typeof state.fm === 'number') firstMonth.value = String(state.fm);
    calc.leaveBlank(leftOut);
    sharedNote.textContent =
      state.a === 'none' ? 'This shared link leaves out the loan amount. Enter your own to see results.' : state.a === 'rounded' ? 'The loan amount in this shared link was rounded, so these results may differ a little from the ones that were shared.' : '';
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

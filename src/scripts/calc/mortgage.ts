// Mortgage payoff calculator: the loan with and without extra payments, the monthly payment
// with the other housing costs kept apart, the schedule, and the exports.

import { formatUSD } from '../../lib/calc/format';
import {
  breakdownLines,
  dateLabel,
  loanIssueMessage,
  loanScheduleNotes,
  loanTable,
  ONE_TIME_SLOTS,
  PAYOFF_MONEY_KEYS,
  PAYOFF_SHARE_SCHEMA,
  payoffChartSvg,
  payoffReport,
  payoffShareState,
  payoffTooltip,
  payoffView,
  termMonths,
  type LoanGrouping,
  type TermUnit,
} from '../../lib/calc/loan-view';
import { parseMoney, parsePercent, parseWhole, type Parsed } from '../../lib/calc/parse';
import { decodeShare, encodeShare, shareAmounts } from '../../lib/calc/share';
import type { LoanInput, OneTimePayment } from '../../lib/engines/loan';
import { paymentBreakdown, paymentDate, payoffComparison, type HousingCosts, type PaymentBreakdown, type PaymentDate, type PayoffComparison } from '../../lib/engines/loan-report';
import { wireExports } from './exports';
import { $, wireCalculator, wireShare, wireSticky, type Evaluation } from './kit';
import { wireSchedule } from './schedule';

interface Scenario {
  loan: LoanInput;
  first: PaymentDate;
  term: { value: number; unit: TermUnit };
  costs: HousingCosts;
}

interface Outcome {
  comparison: PayoffComparison;
  breakdown: PaymentBreakdown;
}

const COST_FIELDS = [
  ['tax', 'propertyTaxAnnual'],
  ['insurance', 'insuranceAnnual'],
  ['mi', 'mortgageInsuranceMonthly'],
  ['hoa', 'hoaMonthly'],
] as const;

const root = document.querySelector<HTMLElement>('[data-calc="mortgage"]');

if (root) {
  const page = document.body;
  const form = $(root, 'form') as HTMLFormElement;
  const input = (id: string) => $(root, `#${id}`) as HTMLInputElement;
  const fields: Record<string, HTMLInputElement> = {
    principal: input('mp-principal'),
    rate: input('mp-rate'),
    term: input('mp-term'),
    firstYear: input('mp-first-year'),
    extra: input('mp-extra'),
    tax: input('mp-tax'),
    insurance: input('mp-insurance'),
    mi: input('mp-mi'),
    hoa: input('mp-hoa'),
  };
  for (const slot of ONE_TIME_SLOTS) {
    fields[`o${slot}`] = input(`mp-o${slot}`);
    fields[`o${slot}a`] = input(`mp-o${slot}a`);
  }
  const unit = $(root, '#mp-term-unit') as HTMLSelectElement;
  const firstMonth = $(root, '#mp-first-month') as HTMLSelectElement;
  const out = (name: string) => $(page, `[data-out="${name}"]`);
  const sharedNote = out('shared-note');

  const reasonText = (reason: string, kind: 'money' | 'percent' | 'whole') =>
    reason === 'empty' ? 'Enter a value.' : reason === 'too-many-decimals' ? (kind === 'whole' ? 'Use a whole number.' : kind === 'percent' ? 'Use at most four decimal places.' : 'Use at most two decimal places (cents).') : 'Enter a number.';

  function evaluate(): Evaluation<Scenario, Outcome> {
    const errors = new Map<string, string>();
    const take = <T>(key: string, parsed: Parsed<T>, kind: 'money' | 'percent' | 'whole'): T | undefined => {
      if (parsed.ok) return parsed.value;
      errors.set(key, reasonText(parsed.reason, kind));
      return undefined;
    };
    const money = (key: string) => take(key, parseMoney(fields[key]!.value), 'money');
    const principal = money('principal');
    const rate = take('rate', parsePercent(fields.rate!.value), 'percent');
    const term = take('term', parseWhole(fields.term!.value), 'whole');
    const year = take('firstYear', parseWhole(fields.firstYear!.value), 'whole');
    const extra = money('extra');
    const costs: Partial<Record<(typeof COST_FIELDS)[number][1], number>> = {};
    for (const [key, name] of COST_FIELDS) {
      const value = money(key);
      if (value !== undefined) costs[name] = value;
    }
    const oneTime: OneTimePayment[] = [];
    for (const slot of ONE_TIME_SLOTS) {
      const monthText = fields[`o${slot}`]!.value.trim();
      const amountText = fields[`o${slot}a`]!.value.trim();
      if (monthText === '' && amountText === '') continue;
      if (monthText === '' || amountText === '') {
        errors.set(monthText === '' ? `o${slot}` : `o${slot}a`, 'Enter both the payment number and the amount, or leave both blank.');
        continue;
      }
      const month = take(`o${slot}`, parseWhole(monthText), 'whole');
      const amount = take(`o${slot}a`, parseMoney(amountText), 'money');
      if (month !== undefined && amount !== undefined) oneTime.push({ month, amount });
    }
    if (errors.size) return { input: null, result: null, errors };
    for (const [key, name] of COST_FIELDS) if (costs[name]! < 0) errors.set(key, 'An amount cannot be negative.');
    if (extra! < 0) errors.set('extra', 'An extra payment cannot be negative.');
    if (errors.size) return { input: null, result: null, errors };
    const scenario: Scenario = {
      loan: { principal: principal!, annualRate: rate!, termMonths: termMonths(term!, unit.value as TermUnit), extraMonthly: extra!, oneTime },
      first: { year: year!, month: Number(firstMonth.value) },
      term: { value: term!, unit: unit.value as TermUnit },
      costs: costs as HousingCosts,
    };
    const computed = payoffComparison(scenario.loan, scenario.first);
    const breakdown = computed.ok ? paymentBreakdown(computed.value.accelerated.schedule.payment, scenario.costs) : null;
    if (!computed.ok || !breakdown?.ok) {
      const issues = !computed.ok ? computed.issues : breakdown && !breakdown.ok ? breakdown.issues : [];
      for (const issue of issues) {
        const cost = COST_FIELDS.find(([, name]) => name === issue.field);
        if (cost) errors.set(cost[0], 'This amount is above the largest this calculator accepts.');
        else {
          const { field, message } = loanIssueMessage(issue);
          if (!errors.has(field)) errors.set(field, message);
        }
      }
      return { input: null, result: null, errors };
    }
    return { input: scenario, result: { comparison: computed.value, breakdown: breakdown.value }, errors };
  }

  const schedule = wireSchedule($(page, '#mp-schedule'), (g) => {
    out('export-grouping').textContent = g;
  });

  function hint(slot: number, first: PaymentDate | null): void {
    const el = $(root!, `#mp-o${slot}-hint`);
    const n = Number(fields[`o${slot}`]!.value.trim());
    el.textContent = first && Number.isInteger(n) && n >= 1 && n <= 600 ? `Payment ${n} is in ${dateLabel(paymentDate(first, n))}.` : '';
  }

  function render(scenario: Scenario, outcome: Outcome): void {
    const c = outcome.comparison;
    const view = payoffView(c);
    out('hero').textContent = view.hero;
    out('hero-sticky').textContent = view.hero;
    out('hero-note').textContent = view.heroNote;
    out('compare-rows').replaceChildren(
      ...view.rows.map((r) => {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = r.label;
        tr.append(th);
        for (const text of [r.baseline, r.accelerated]) {
          const td = document.createElement('td');
          td.className = 'num';
          td.textContent = text;
          tr.append(td);
        }
        return tr;
      }),
    );
    for (const p of breakdownLines(outcome.breakdown)) out(`part-${p.key}`).textContent = p.value;
    out('summary').textContent = view.summary;
    for (const slot of ONE_TIME_SLOTS) hint(slot, scenario.first);
    schedule.update({
      table: (g) => loanTable(c.accelerated, g as LoanGrouping, { extra: true, baseline: c.baseline }),
      chart: (g, width) => payoffChartSvg(c, g as LoanGrouping, width ? { width } : {}),
      tooltip: (g, i) => payoffTooltip(c, g as LoanGrouping, i),
      notes: (g) => loanScheduleNotes(g as LoanGrouping, true, true),
    });
  }

  const calc = wireCalculator({
    root,
    form,
    fields,
    evaluate,
    render,
    status: out('status'),
    announce: (_s, o) => `Interest saved ${formatUSD(o.comparison.interestSaved)}, paid off ${dateLabel(o.comparison.accelerated.payoff)}.`,
    changed: () => share.refresh(),
  });

  const share = wireShare(root, 'mp', (mode) => {
    const current = calc.current();
    if (!current) return null;
    const s = current.input;
    const state = shareAmounts(payoffShareState(s.loan, s.term, s.first, s.costs), PAYOFF_MONEY_KEYS, mode);
    const fragment = encodeShare(PAYOFF_SHARE_SCHEMA, state);
    if (mode === 'none') return { fragment, preview: 'The link opens with the rate, term, dates and payment numbers filled in and every dollar amount left blank.' };
    const num = (key: string) => (typeof state[key] === 'number' ? (state[key] as number) : 0);
    const loan: LoanInput = {
      ...s.loan,
      principal: num('p'),
      extraMonthly: num('x'),
      oneTime: (s.loan.oneTime ?? []).map((o, i) => ({ month: o.month, amount: num(`o${i + 1}a`) || o.amount })),
    };
    const shared = payoffComparison(loan, s.first);
    if (!shared.ok) return { fragment, preview: '' };
    return {
      fragment,
      preview:
        mode === 'rounded'
          ? `The link opens with a balance of ${formatUSD(loan.principal)} and ${formatUSD(shared.value.interestSaved)} of interest saved.`
          : `The link opens with ${formatUSD(shared.value.interestSaved)} of interest saved, paid off ${dateLabel(shared.value.accelerated.payoff)}.`,
    };
  });

  wireExports(
    root,
    {
      name: 'mortgage-payoff',
      report: (generated) => {
        const current = calc.current();
        if (!current) return null;
        const s = current.input;
        return payoffReport(s.loan, s.first, s.costs, current.result.comparison, current.result.breakdown, schedule.grouping() as LoanGrouping, generated);
      },
      csv: () => {
        const current = calc.current();
        if (!current) return null;
        const g = schedule.grouping() as LoanGrouping;
        const c = current.result.comparison;
        return { table: loanTable(c.accelerated, g, { extra: true, baseline: c.baseline }), what: g === 'year' ? 'schedule by year' : 'schedule by payment' };
      },
    },
    () => calc.settle(),
  );

  function applyShared(): void {
    const state = decodeShare(PAYOFF_SHARE_SCHEMA, location.hash);
    if (!Object.keys(state).length) return;
    const leftOut: string[] = [];
    // A link carries every nonzero amount; one it leaves out is 0, or blank in a No amounts link.
    const money = (key: string, field: string) => {
      const v = state[key];
      if (typeof v === 'number') fields[field]!.value = (v / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      else if (state.a === 'none') {
        fields[field]!.value = '';
        leftOut.push(field);
      } else if (field !== 'principal') fields[field]!.value = '0.00';
    };
    money('p', 'principal');
    if (typeof state.r === 'number') fields.rate!.value = String(state.r);
    if (typeof state.t === 'number') fields.term!.value = String(state.t);
    if (typeof state.u === 'string') unit.value = state.u;
    if (typeof state.fy === 'number') fields.firstYear!.value = String(state.fy);
    if (typeof state.fm === 'number') firstMonth.value = String(state.fm);
    money('x', 'extra');
    money('tx', 'tax');
    money('in', 'insurance');
    money('mi', 'mi');
    money('hoa', 'hoa');
    for (const slot of ONE_TIME_SLOTS) {
      const m = state[`o${slot}`];
      const amount = state[`o${slot}a`];
      fields[`o${slot}`]!.value = typeof m === 'number' ? String(m) : '';
      fields[`o${slot}a`]!.value = typeof amount === 'number' ? (amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
      if (typeof m === 'number' && typeof amount !== 'number' && state.a === 'none') leftOut.push(`o${slot}a`);
    }
    calc.leaveBlank(leftOut);
    sharedNote.textContent =
      state.a === 'none' ? 'This shared link leaves out the dollar amounts. Enter your own to see results.' : state.a === 'rounded' ? 'The amounts in this shared link were rounded, so these results may differ a little from the ones that were shared.' : '';
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

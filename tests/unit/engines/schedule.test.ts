// Schedules by day, month and year (ENGINE_CONVENTIONS section 11) against the independent
// Python oracle (schedules.json), plus the identities that make switching views safe: every
// grouping reconciles to the same final balance and interest, credits appear only where a
// crediting period ends, and accrued interest adds up to what each credit rounds.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compoundInterest, type CompoundFrequency, type CompoundInput } from '../../../src/lib/engines/compound';
import type { ContributionFrequency, ContributionTiming } from '../../../src/lib/engines/calendar';
import { savingsGrowth, type HysaCompounding, type HysaInput } from '../../../src/lib/engines/hysa';
import { compoundDays, savingsDays, Schedule, type Grouping, type ScheduleRow } from '../../../src/lib/engines/schedule';

const schedules = JSON.parse(readFileSync('tests/oracle/fixtures/schedules.json', 'utf8'));

type Row = [number, number, number, string, number, number, number];
interface Case {
  id: string;
  engine: 'compound' | 'savings';
  principal_cents: number;
  annual_rate?: string;
  periods_per_year?: number;
  years: number;
  compounding?: HysaCompounding;
  rates?: { from_month: number; apy: string }[];
  contribution_frequency: ContributionFrequency;
  contribution_cents: number;
  timing: ContributionTiming;
  schedule: { days?: Row[]; months: Row[]; years: Row[] };
}

function closeRelative(actual: number, expected: number, label: string) {
  if (expected === 0) expect(Math.abs(actual), label).toBeLessThanOrEqual(1e-15);
  else expect(Math.abs(actual - expected) / Math.abs(expected), label).toBeLessThanOrEqual(1e-12);
}

function compoundCase(c: Case): CompoundInput {
  return {
    principal: c.principal_cents,
    annualRate: Number(c.annual_rate),
    periodsPerYear: c.periods_per_year as CompoundFrequency,
    years: c.years,
    contributionFrequency: c.contribution_frequency,
    contribution: c.contribution_cents,
    timing: c.timing,
  };
}

function savingsCase(c: Case): HysaInput {
  return {
    principal: c.principal_cents,
    years: c.years,
    compounding: c.compounding!,
    rates: c.rates!.map((r) => ({ fromMonth: r.from_month, apy: Number(r.apy) })),
    contributionFrequency: c.contribution_frequency,
    contribution: c.contribution_cents,
    timing: c.timing,
  };
}

function scheduleFor(c: Case): { schedule: Schedule; finalBalance: number; totalInterest: number } {
  if (c.engine === 'compound') {
    const input = compoundCase(c);
    const r = compoundInterest(input);
    if (!r.ok) throw new Error(`${c.id}: ${JSON.stringify(r.issues)}`);
    return { schedule: new Schedule(compoundDays(input, r.value)), finalBalance: r.value.finalBalance, totalInterest: r.value.totalInterest };
  }
  const input = savingsCase(c);
  const r = savingsGrowth(input);
  if (!r.ok) throw new Error(`${c.id}: ${JSON.stringify(r.issues)}`);
  return { schedule: new Schedule(savingsDays(input, r.value)), finalBalance: r.value.finalBalance, totalInterest: r.value.totalInterest };
}

function compareRows(id: string, grouping: Grouping, actual: readonly ScheduleRow[], expected: readonly Row[]) {
  expect(actual.length, `${id} ${grouping} count`).toBe(expected.length);
  expected.forEach((e, i) => {
    const a = actual[i]!;
    const label = `${id} ${grouping} ${e[0]}`;
    // Day rows are numbered from 0 in the fixture; month and year rows from 1.
    expect(grouping === 'day' ? a.firstDay : a.index, label).toBe(e[0]);
    expect([a.opening, a.deposits, a.credited, a.closing, a.cumulativeInterest], label).toEqual([e[1], e[2], e[4], e[5], e[6]]);
    closeRelative(a.accrued, Number(e[3]), `${label} accrued`);
  });
}

describe('schedules against the oracle', () => {
  const cases = schedules.cases as Case[];

  it('cover both engines, every compounding frequency, and day rows for short terms', () => {
    expect(cases.some((c) => c.engine === 'savings' && c.compounding === 'daily')).toBe(true);
    expect(cases.some((c) => c.engine === 'savings' && c.compounding === 'monthly')).toBe(true);
    for (const n of [1, 2, 4, 12, 365]) expect(cases.some((c) => c.engine === 'compound' && c.periods_per_year === n), `n=${n}`).toBe(true);
    for (const c of cases) expect(Boolean(c.schedule.days), c.id).toBe(c.years <= 2);
  });

  for (const c of cases) {
    it(`matches every reported period: ${c.id}`, () => {
      const { schedule } = scheduleFor(c);
      expect(schedule.days).toHaveLength(c.years * 365);
      if (c.schedule.days) compareRows(c.id, 'day', schedule.days, c.schedule.days);
      compareRows(c.id, 'month', schedule.months, c.schedule.months);
      compareRows(c.id, 'year', schedule.years, c.schedule.years);
    });
  }
});

describe('schedule identities', () => {
  const cases = schedules.cases as Case[];

  it('reconcile every grouping to the final balance and the total interest', () => {
    for (const c of cases) {
      const { schedule, finalBalance, totalInterest } = scheduleFor(c);
      for (const g of ['day', 'month', 'year'] as const) {
        const rows = schedule.rows(g);
        const last = rows[rows.length - 1]!;
        expect(last.closing, `${c.id} ${g}`).toBe(finalBalance);
        expect(last.cumulativeInterest, `${c.id} ${g}`).toBe(totalInterest);
        expect(rows.reduce((s, r) => s + r.credited, 0), `${c.id} ${g}`).toBe(totalInterest);
      }
    }
  });

  it('chain each row to the next and add up within every row', () => {
    for (const c of cases) {
      const { schedule } = scheduleFor(c);
      for (const g of ['day', 'month', 'year'] as const) {
        const rows = schedule.rows(g);
        rows.forEach((r, i) => {
          expect(r.closing, `${c.id} ${g} ${r.index}`).toBe(r.opening + r.deposits + r.credited);
          if (i > 0) expect(r.opening, `${c.id} ${g} ${r.index}`).toBe(rows[i - 1]!.closing);
        });
        expect(rows[0]!.opening).toBe(c.principal_cents);
      }
    }
  });

  it('keep the same totals whichever grouping is shown', () => {
    for (const c of cases) {
      const { schedule } = scheduleFor(c);
      const totals = (['day', 'month', 'year'] as const).map((g) => {
        const rows = schedule.rows(g);
        return { deposits: rows.reduce((s, r) => s + r.deposits, 0), accrued: rows.reduce((s, r) => s + r.accrued, 0) };
      });
      expect(totals[1]!.deposits).toBe(totals[0]!.deposits);
      expect(totals[2]!.deposits).toBe(totals[0]!.deposits);
      closeRelative(totals[1]!.accrued, totals[0]!.accrued, `${c.id} month accrued`);
      closeRelative(totals[2]!.accrued, totals[0]!.accrued, `${c.id} year accrued`);
    }
  });

  it('credit interest only on the last day of a crediting period, within half a cent of what accrued', () => {
    for (const c of cases.filter((x) => x.engine === 'savings')) {
      const { schedule } = scheduleFor(c);
      let accrued = 0;
      for (const day of schedule.days) {
        accrued += day.accrued;
        const lastOfMonth = schedule.months.some((m) => m.lastDay === day.firstDay);
        if (!lastOfMonth) {
          expect(day.credited, `${c.id} day ${day.firstDay}`).toBe(0);
          continue;
        }
        const gap = day.credited - accrued;
        expect(gap, `${c.id} day ${day.firstDay}`).toBeGreaterThan(-0.5 - 1e-6);
        expect(gap, `${c.id} day ${day.firstDay}`).toBeLessThanOrEqual(0.5 + 1e-6);
        accrued = 0;
      }
    }
  });

  it('shows no credit in a month that ends no compounding period of annual compounding', () => {
    const input: CompoundInput = { principal: 1_000_000, annualRate: 0.05, periodsPerYear: 1, years: 2, contributionFrequency: 'monthly', contribution: 10_000, timing: 'end' };
    const r = compoundInterest(input);
    if (!r.ok) throw new Error('invalid');
    const months = new Schedule(compoundDays(input, r.value)).months;
    months.forEach((m) => {
      if (m.index % 12 === 0) expect(m.credited).toBeGreaterThan(0);
      else expect(m.credited).toBe(0);
      expect(m.accrued).toBeGreaterThan(0);
    });
  });
});

describe('long schedules', () => {
  it('build all 36,500 days of a century of daily compounding quickly and reconcile', () => {
    const input: CompoundInput = { principal: 10_000_000, annualRate: 0.05, periodsPerYear: 365, years: 100, contributionFrequency: 'weekly', contribution: 10_000, timing: 'start' };
    const r = compoundInterest(input);
    if (!r.ok) throw new Error('invalid');
    const started = performance.now();
    const schedule = new Schedule(compoundDays(input, r.value));
    const years = schedule.years;
    const elapsed = performance.now() - started;
    expect(schedule.days).toHaveLength(36_500);
    expect(schedule.months).toHaveLength(1_200);
    expect(years).toHaveLength(100);
    expect(years.at(-1)!.closing).toBe(r.value.finalBalance);
    expect(elapsed).toBeLessThan(1_000);
    years.forEach((y, i) => expect(y.closing, `year ${y.index}`).toBe(r.value.years[i]!.endBalance));
  });

  it('build the 18,250 days of fifty years of savings and match the engine month by month', () => {
    const input: HysaInput = { principal: 1_000_000, years: 50, compounding: 'daily', rates: [{ fromMonth: 1, apy: 0.045 }, { fromMonth: 300, apy: 0.02 }], contributionFrequency: 'biweekly', contribution: 20_000, timing: 'end' };
    const r = savingsGrowth(input);
    if (!r.ok) throw new Error('invalid');
    const schedule = new Schedule(savingsDays(input, r.value));
    expect(schedule.days).toHaveLength(18_250);
    schedule.months.forEach((m, i) => {
      const e = r.value.months[i]!;
      expect([m.opening, m.deposits, m.credited, m.closing], `month ${m.index}`).toEqual([e.startBalance, e.contributions, e.interest, e.endBalance]);
    });
    // The year with the rate change lists both rate entries, in order.
    expect(schedule.years[24]!.rates).toEqual([0, 1]);
    expect(schedule.years[23]!.rates).toEqual([0]);
  });

  it('refuses a schedule that is not a whole number of years', () => {
    expect(() => new Schedule([])).toThrow(RangeError);
  });
});

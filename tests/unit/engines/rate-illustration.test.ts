// The APR/APY balance illustration (ENGINE_CONVENTIONS section 12) against the independent
// Python oracle (illustration.json), plus the weekly calendar and the result cap.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calendarDay, completedPeriods, periodBoundaries } from '../../../src/lib/engines/calendar';
import { rateIllustration, type IllustrationInput } from '../../../src/lib/engines/rate-illustration';
import { apyFromNominal, type CompoundingFrequency } from '../../../src/lib/engines/rates';
import type { Grouping } from '../../../src/lib/engines/schedule';

const fixture = JSON.parse(readFileSync('tests/oracle/fixtures/illustration.json', 'utf8'));

type Row = [number, number, string, number];
interface Case {
  id: string;
  deposit_cents: number;
  years: number;
  accounts: { annual_rate: string; n: number }[];
  results: { years: Row[]; months: Row[]; days?: Row[] }[];
  near_half: [number, 'years' | 'months' | 'days', number][];
}

const GROUPINGS: readonly [Grouping, 'years' | 'months' | 'days'][] = [
  ['year', 'years'],
  ['month', 'months'],
  ['day', 'days'],
];

const inputOf = (c: Case): IllustrationInput => ({
  deposit: c.deposit_cents,
  years: c.years,
  accounts: c.accounts.map((a) => ({ annualRate: Number(a.annual_rate), periodsPerYear: a.n as CompoundingFrequency })),
});

describe('rate illustration against the oracle', () => {
  const cases = fixture.cases as Case[];

  it('covers every compounding frequency, one-year day rows and multi-year terms', () => {
    for (const n of [1, 2, 4, 12, 52, 365]) expect(cases.some((c) => c.accounts.some((a) => a.n === n)), `n=${n}`).toBe(true);
    expect(cases.some((c) => c.years === 1 && c.results[0]!.days)).toBe(true);
    expect(cases.some((c) => c.years >= 20)).toBe(true);
  });

  for (const c of cases) {
    it(`matches every period of every account: ${c.id}`, () => {
      const skip = new Set(c.near_half.map(([a, g, row]) => `${a} ${g} ${row}`));
      for (const [grouping, key] of GROUPINGS) {
        if (!c.results[0]![key]) continue;
        const computed = rateIllustration(inputOf(c), grouping);
        if (!computed.ok) throw new Error(`${c.id}: ${JSON.stringify(computed.issues)}`);
        const rows = computed.value;
        c.results.forEach((result, a) => {
          const expected = result[key]!;
          expect(rows.length, `${c.id} ${key}`).toBe(expected.length);
          expected.forEach((e, i) => {
            const label = `${c.id} account ${a} ${key} row ${i + 1}`;
            const row = rows[i]!;
            // Day rows are numbered from 0 in the fixture; months and years from 1.
            expect(key === 'days' ? row.end - 1 : row.index, label).toBe(e[0]);
            expect(row.periods[a], label).toBe(e[1]);
            const balance = Number(e[2]);
            expect(Math.abs(row.balances[a]! - balance) / balance, label).toBeLessThanOrEqual(1e-12);
            if (!skip.has(`${a} ${key} ${i + 1}`)) expect(row.shown[a], label).toBe(e[3]);
          });
        });
      }
    });
  }
});

describe('rate illustration rules', () => {
  it('grows a deposit by exactly the APY each full year, before rounding', () => {
    for (const n of [1, 2, 4, 12, 52, 365] as const) {
      const r = rateIllustration({ deposit: 1_000_000, years: 3, accounts: [{ annualRate: 0.045, periodsPerYear: n }] }, 'year');
      if (!r.ok) throw new Error('invalid');
      const apy = apyFromNominal(0.045, n);
      r.value.forEach((row, y) => expect(Math.abs(row.balances[0]! / 1_000_000 - (1 + apy) ** (y + 1)), `n=${n} year ${y + 1}`).toBeLessThan(1e-13));
    }
  });

  it('counts weekly periods of 7 days with an 8-day last week each year', () => {
    expect(completedPeriods(52, 7)).toBe(1);
    expect(completedPeriods(52, 357)).toBe(51);
    expect(completedPeriods(52, 364)).toBe(51);
    expect(completedPeriods(52, 365)).toBe(52);
    expect(completedPeriods(52, 365 + 7)).toBe(53);
    const weeks = periodBoundaries(52, 1);
    expect(weeks).toHaveLength(53);
    expect(weeks.at(-1)! - weeks.at(-2)!).toBe(8);
  });

  it('counts calendar periods completed by any boundary', () => {
    expect(completedPeriods(12, 31)).toBe(1);
    expect(completedPeriods(12, 58)).toBe(1);
    expect(completedPeriods(12, 59)).toBe(2);
    expect(completedPeriods(4, 89)).toBe(0);
    expect(completedPeriods(4, 90)).toBe(1);
    expect(completedPeriods(1, 364)).toBe(0);
    expect(completedPeriods(365, 500)).toBe(500);
    expect(() => completedPeriods(3 as 12, 10)).toThrow(RangeError);
  });

  it('places days on the calendar', () => {
    expect(calendarDay(0)).toEqual({ year: 1, month: 1, termMonth: 1, dayOfMonth: 1 });
    expect(calendarDay(58)).toEqual({ year: 1, month: 2, termMonth: 2, dayOfMonth: 28 });
    expect(calendarDay(364)).toEqual({ year: 1, month: 12, termMonth: 12, dayOfMonth: 31 });
    expect(calendarDay(365)).toEqual({ year: 2, month: 1, termMonth: 13, dayOfMonth: 1 });
  });

  it('refuses a balance past the cap, naming the first year it is passed', () => {
    const r = rateIllustration({ deposit: 10_000_000_000, years: 30, accounts: [{ annualRate: 1, periodsPerYear: 365 }] }, 'year');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toEqual([{ field: 'years', code: 'result-too-large', limit: 14 }]);
    const fits = rateIllustration({ deposit: 10_000_000_000, years: 13, accounts: [{ annualRate: 1, periodsPerYear: 365 }] }, 'year');
    expect(fits.ok).toBe(true);
  });

  it('reports every input problem at once', () => {
    const r = rateIllustration({ deposit: 0, years: 31, accounts: [{ annualRate: 2, periodsPerYear: 3 as 12 }] }, 'month');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => `${i.field} ${i.code}`)).toEqual(['deposit below-minimum', 'years above-maximum', 'accounts[0].annualRate above-maximum', 'accounts[0].periodsPerYear unsupported-value']);
    const none = rateIllustration({ deposit: 100, years: 1, accounts: [] }, 'year');
    expect(none.ok).toBe(false);
    const four = rateIllustration({ deposit: 100, years: 1, accounts: Array.from({ length: 4 }, () => ({ annualRate: 0.01, periodsPerYear: 12 as const })) }, 'year');
    expect(four.ok).toBe(false);
  });

  it('returns one row per day, month or year of the term', () => {
    const input: IllustrationInput = { deposit: 100_000, years: 2, accounts: [{ annualRate: 0.05, periodsPerYear: 12 }] };
    const lengths = (['day', 'month', 'year'] as const).map((g) => {
      const r = rateIllustration(input, g);
      return r.ok ? r.value.length : -1;
    });
    expect(lengths).toEqual([730, 24, 2]);
  });
});

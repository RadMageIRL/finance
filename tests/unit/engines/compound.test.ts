import { describe, expect, it } from 'vitest';
import { contributionBoundaries, MONTH_DAYS, MONTH_STARTS, periodBoundaries } from '../../../src/lib/engines/calendar';
import { compoundInterest, type CompoundFrequency, type CompoundInput, type ContributionFrequency } from '../../../src/lib/engines/compound';
import { rng } from '../../support/random';

const base: CompoundInput = {
  principal: 100000,
  annualRate: 0.05,
  periodsPerYear: 12,
  years: 10,
  contributionFrequency: 'monthly',
  contribution: 10000,
  timing: 'end',
};

function run(input: CompoundInput) {
  const result = compoundInterest(input);
  if (!result.ok) throw new Error(`unexpected issues: ${JSON.stringify(result.issues)}`);
  return result.value;
}

/** The v1.1 model, one contribution per compounding period, written out for comparison. */
function perPeriodModel(input: CompoundInput): number[][] {
  let balance = input.principal;
  const rows: number[][] = [];
  for (let year = 1; year <= input.years; year += 1) {
    const start = balance;
    let interest = 0;
    for (let p = 0; p < input.periodsPerYear; p += 1) {
      if (input.timing === 'start') balance += input.contribution;
      // Round half up on an exact integer numerator: rates in these tests have at most 4 decimals.
      const scaled = BigInt(balance) * BigInt(Math.round(input.annualRate * 1e4));
      const den = 10000n * BigInt(input.periodsPerYear);
      const credited = Number((2n * scaled + den) / (2n * den));
      balance += credited;
      interest += credited;
      if (input.timing === 'end') balance += input.contribution;
    }
    rows.push([year, start, input.contribution * input.periodsPerYear, interest, balance]);
  }
  return rows;
}

describe('compound interest: invalid input is reported, not computed', () => {
  const cases: [string, Partial<CompoundInput>, { field: string; code: string }][] = [
    ['negative principal', { principal: -1 }, { field: 'principal', code: 'below-minimum' }],
    ['fractional cents', { principal: 100.5 }, { field: 'principal', code: 'not-an-integer' }],
    ['principal above the cap', { principal: 10_000_000_001 }, { field: 'principal', code: 'above-maximum' }],
    ['NaN rate', { annualRate: Number.NaN }, { field: 'annualRate', code: 'not-a-number' }],
    ['negative rate', { annualRate: -0.01 }, { field: 'annualRate', code: 'below-minimum' }],
    ['rate above 100%', { annualRate: 1.01 }, { field: 'annualRate', code: 'above-maximum' }],
    ['unsupported compounding frequency', { periodsPerYear: 3 as CompoundFrequency }, { field: 'periodsPerYear', code: 'unsupported-value' }],
    ['zero years', { years: 0 }, { field: 'years', code: 'below-minimum' }],
    ['fractional years', { years: 2.5 }, { field: 'years', code: 'not-an-integer' }],
    ['too many years', { years: 101 }, { field: 'years', code: 'above-maximum' }],
    ['unknown contribution frequency', { contributionFrequency: 'daily' as ContributionFrequency }, { field: 'contributionFrequency', code: 'unsupported-value' }],
    ['negative contribution', { contribution: -100 }, { field: 'contribution', code: 'below-minimum' }],
    ['fractional contribution', { contribution: 0.5 }, { field: 'contribution', code: 'not-an-integer' }],
    ['unknown timing', { timing: 'middle' as CompoundInput['timing'] }, { field: 'timing', code: 'unsupported-value' }],
  ];
  for (const [name, change, expected] of cases) {
    it(`rejects ${name}`, () => {
      const result = compoundInterest({ ...base, ...change });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues).toEqual([expect.objectContaining(expected)]);
    });
  }

  it('ignores the contribution amount and timing when the frequency is none', () => {
    const none = run({ ...base, contributionFrequency: 'none', contribution: -5, timing: 'middle' as CompoundInput['timing'] });
    expect(none.totalContributions).toBe(0);
    expect(none.contributionCount).toBe(0);
    expect(none.finalBalance).toBe(run({ ...base, contribution: 0 }).finalBalance);
  });

  it('rejects a result too large to hold exact cents (largest principal at 100% for 100 years)', () => {
    const result = compoundInterest({ ...base, principal: 10_000_000_000, annualRate: 1, periodsPerYear: 1, years: 100, contributionFrequency: 'none' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual([{ field: 'years', code: 'result-too-large', limit: 20 }]);
  });

  it('rejects a result too large to hold exact cents part way through a year of daily compounding', () => {
    const result = compoundInterest({ ...base, principal: 10_000_000_000, annualRate: 1, periodsPerYear: 365, years: 100, contributionFrequency: 'weekly' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual([expect.objectContaining({ field: 'years', code: 'result-too-large' })]);
  });

  it('rejects every invalid field at once', () => {
    const result = compoundInterest({ ...base, principal: -1, annualRate: 2, years: 0, contribution: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.field)).toEqual(['principal', 'annualRate', 'years', 'contribution']);
  });
});

describe('calendar (conventions 5.1 to 5.3)', () => {
  it('uses the real month lengths of a common year, never 30-day months', () => {
    expect(MONTH_DAYS.reduce((a, b) => a + b, 0)).toBe(365);
    expect(MONTH_STARTS).toEqual([0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]);
    expect(periodBoundaries(12, 2).slice(11, 15)).toEqual([334, 365, 396, 424]);
  });

  it('puts quarters and half years on calendar month starts', () => {
    expect(periodBoundaries(4, 1)).toEqual([0, 90, 181, 273, 365]);
    expect(periodBoundaries(2, 1)).toEqual([0, 181, 365]);
    expect(periodBoundaries(1, 3)).toEqual([0, 365, 730, 1095]);
    expect(periodBoundaries(365, 1)).toHaveLength(366);
  });

  it('makes monthly contributions on month starts at the start, and on month ends at the end', () => {
    expect(contributionBoundaries('monthly', 'start', 1)).toEqual(MONTH_STARTS);
    expect(contributionBoundaries('monthly', 'end', 1)).toEqual([...MONTH_STARTS.slice(1), 365]);
  });

  it('runs weekly and biweekly cycles across year ends: 53 then 52 weekly contributions at the start, 52 at the end', () => {
    const start = contributionBoundaries('weekly', 'start', 2);
    expect(start.filter((t) => t < 365)).toHaveLength(53);
    expect(start.filter((t) => t >= 365)).toHaveLength(52);
    expect(contributionBoundaries('weekly', 'end', 1)).toHaveLength(52);
    expect(contributionBoundaries('biweekly', 'start', 1)).toHaveLength(27);
    expect(contributionBoundaries('biweekly', 'end', 1)).toHaveLength(26);
  });

  it('makes 365 weekly contributions over 7 years with either timing', () => {
    expect(contributionBoundaries('weekly', 'start', 7)).toHaveLength(365);
    expect(contributionBoundaries('weekly', 'end', 7)).toHaveLength(365);
    expect(contributionBoundaries('none', 'end', 7)).toEqual([]);
  });

  it('rejects a frequency that does not follow the calendar', () => {
    expect(() => periodBoundaries(52 as 12, 1)).toThrow(RangeError);
  });
});

describe('compound interest: conventions and identities', () => {
  it('adds up: final = principal + contributions + interest, and every year adds up', () => {
    const generator = rng(20261115);
    const frequencies: ContributionFrequency[] = ['none', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annually'];
    for (let k = 0; k < 120; k += 1) {
      const input: CompoundInput = {
        principal: generator.int(0, 50_000_000),
        annualRate: generator.int(0, 2000) / 10000,
        periodsPerYear: generator.pick([1, 2, 4, 12, 365] as const),
        years: generator.int(1, 12),
        contributionFrequency: generator.pick(frequencies),
        contribution: generator.int(0, 500_000),
        timing: generator.pick(['start', 'end'] as const),
      };
      const r = run(input);
      expect(r.finalBalance).toBe(input.principal + r.totalContributions + r.totalInterest);
      let previousEnd = input.principal;
      let contributions = 0;
      for (const year of r.years) {
        expect(year.startBalance).toBe(previousEnd);
        expect(year.endBalance).toBe(year.startBalance + year.contributions + year.interest);
        previousEnd = year.endBalance;
        contributions += year.contributions;
      }
      expect(contributions).toBe(r.totalContributions);
    }
  });

  it('gives exactly the one-contribution-per-period results when contributions match compounding', () => {
    const generator = rng(42);
    const pairs: [ContributionFrequency, CompoundFrequency][] = [['monthly', 12], ['quarterly', 4], ['annually', 1]];
    for (let k = 0; k < 60; k += 1) {
      const [contributionFrequency, periodsPerYear] = generator.pick(pairs);
      const input: CompoundInput = {
        principal: generator.int(0, 50_000_000),
        annualRate: generator.int(0, 2000) / 10000,
        periodsPerYear,
        years: generator.int(1, 30),
        contributionFrequency,
        contribution: generator.int(0, 500_000),
        timing: generator.pick(['start', 'end'] as const),
      };
      expect(run(input).years.map((y) => [y.year, y.startBalance, y.contributions, y.interest, y.endBalance])).toEqual(perPeriodModel(input));
    }
  });

  it('pays a mid-period contribution interest for its days only: 53 weekly $100 deposits at 5% compounded yearly earn $132.86', () => {
    // Deposits on days 0, 7, ..., 364 are held 365 - 7k days: 9,699 deposit-days in all.
    // Interest = 10,000 x 9,699 x 0.05 / 365 = 13,286.30 cents, credited as 13,286.
    const r = run({ principal: 0, annualRate: 0.05, periodsPerYear: 1, years: 1, contributionFrequency: 'weekly', contribution: 10000, timing: 'start' });
    expect(r.contributionCount).toBe(53);
    expect(r.totalInterest).toBe(13286);
    expect(r.finalBalance).toBe(543286);
  });

  it('pays no interest on a contribution made at the very end of the term', () => {
    const r = run({ principal: 100000, annualRate: 0.05, periodsPerYear: 1, years: 1, contributionFrequency: 'annually', contribution: 50000, timing: 'end' });
    expect(r.totalInterest).toBe(5000);
    expect(r.finalBalance).toBe(155000);
  });

  it('weights monthly deposits by real month lengths: 12 deposits of $1,000 at 5% compounded yearly earn $326.30', () => {
    // Deposits on the month starts (days 0, 31, 59, ... 334) are held 365 minus that day:
    // 4,380 - 1,998 = 2,382 deposit-days. Interest = 100,000 x 2,382 x 0.05 / 365 = 32,630.14
    // cents. Thirty-day months would give 2,400 deposit-days and 32,877 cents instead.
    const r = run({ principal: 0, annualRate: 0.05, periodsPerYear: 1, years: 1, contributionFrequency: 'monthly', contribution: 100000, timing: 'start' });
    expect(r.totalInterest).toBe(32630);
    expect(r.finalBalance).toBe(1_232_630);
  });

  it('at a zero rate pays no interest: final = principal + contributions', () => {
    const r = run({ ...base, annualRate: 0, contributionFrequency: 'biweekly' });
    expect(r.totalInterest).toBe(0);
    expect(r.contributionCount).toBe(Math.floor((365 * 10) / 14));
    expect(r.finalBalance).toBe(100000 + 10000 * r.contributionCount);
  });

  it('rounds an exact half cent of interest up: 10 cents at 5% annual earns 1 cent', () => {
    const r = run({ ...base, principal: 10, annualRate: 0.05, periodsPerYear: 1, years: 1, contributionFrequency: 'none' });
    expect(r.totalInterest).toBe(1);
  });

  it('start-of-interval contributions earn more than end-of-interval ones at a positive rate', () => {
    for (const contributionFrequency of ['weekly', 'monthly', 'annually'] as const) {
      const start = run({ ...base, contributionFrequency, timing: 'start', years: 7 });
      const end = run({ ...base, contributionFrequency, timing: 'end', years: 7 });
      expect(start.finalBalance).toBeGreaterThan(end.finalBalance);
      expect(start.totalContributions).toBe(end.totalContributions);
    }
  });

  it('stays within a few cents of the textbook closed form when contributions match compounding', () => {
    const generator = rng(20261115);
    for (let k = 0; k < 200; k += 1) {
      const [contributionFrequency, n] = generator.pick([['monthly', 12], ['quarterly', 4], ['annually', 1]] as const);
      const input: CompoundInput = {
        principal: generator.int(0, 50_000_000),
        annualRate: generator.int(1, 2000) / 10000,
        periodsPerYear: n,
        years: generator.int(1, 40),
        contributionFrequency,
        contribution: generator.int(0, 500_000),
        timing: generator.pick(['start', 'end'] as const),
      };
      const r = run(input);
      const i = input.annualRate / n;
      const periods = n * input.years;
      const growth = Math.pow(1 + i, periods);
      const closedForm = input.principal * growth + input.contribution * ((growth - 1) / i) * (input.timing === 'start' ? 1 + i : 1);
      // Each credit rounds by at most half a cent and that error then compounds.
      const bound = 0.5 * periods * growth + 1;
      expect(Math.abs(r.finalBalance - closedForm)).toBeLessThanOrEqual(bound);
    }
  });

  it('never lowers the balance at a nonnegative rate with no withdrawals', () => {
    const r = run({ ...base, periodsPerYear: 365, years: 3, contributionFrequency: 'weekly' });
    for (const year of r.years) expect(year.endBalance).toBeGreaterThanOrEqual(year.startBalance);
  });
});

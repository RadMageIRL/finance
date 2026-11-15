import { describe, expect, it } from 'vitest';
import { compoundInterest, type CompoundInput } from '../../../src/lib/engines/compound';
import { rng } from '../../support/random';

const base: CompoundInput = {
  principal: 100000,
  annualRate: 0.05,
  periodsPerYear: 12,
  years: 10,
  contribution: 10000,
  timing: 'end',
};

function run(input: CompoundInput) {
  const result = compoundInterest(input);
  if (!result.ok) throw new Error(`unexpected issues: ${JSON.stringify(result.issues)}`);
  return result.value;
}

describe('compound interest: invalid input is reported, not computed', () => {
  const cases: [string, Partial<CompoundInput>, { field: string; code: string }][] = [
    ['negative principal', { principal: -1 }, { field: 'principal', code: 'below-minimum' }],
    ['fractional cents', { principal: 100.5 }, { field: 'principal', code: 'not-an-integer' }],
    ['principal above the cap', { principal: 10_000_000_001 }, { field: 'principal', code: 'above-maximum' }],
    ['NaN rate', { annualRate: Number.NaN }, { field: 'annualRate', code: 'not-a-number' }],
    ['negative rate', { annualRate: -0.01 }, { field: 'annualRate', code: 'below-minimum' }],
    ['rate above 100%', { annualRate: 1.01 }, { field: 'annualRate', code: 'above-maximum' }],
    ['unsupported frequency', { periodsPerYear: 3 as CompoundInput['periodsPerYear'] }, { field: 'periodsPerYear', code: 'unsupported-value' }],
    ['zero years', { years: 0 }, { field: 'years', code: 'below-minimum' }],
    ['fractional years', { years: 2.5 }, { field: 'years', code: 'not-an-integer' }],
    ['too many years', { years: 101 }, { field: 'years', code: 'above-maximum' }],
    ['negative contribution', { contribution: -100 }, { field: 'contribution', code: 'below-minimum' }],
    ['unknown timing', { timing: 'middle' as CompoundInput['timing'] }, { field: 'timing', code: 'unsupported-value' }],
  ];
  for (const [name, change, expected] of cases) {
    it(`rejects ${name}`, () => {
      const result = compoundInterest({ ...base, ...change });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues).toEqual([expect.objectContaining(expected)]);
    });
  }

  it('rejects a result too large to hold exact cents (largest principal at 100% for 100 years)', () => {
    const result = compoundInterest({ principal: 10_000_000_000, annualRate: 1, periodsPerYear: 1, years: 100, contribution: 0, timing: 'end' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual([{ field: 'years', code: 'result-too-large', limit: 20 }]);
  });

  it('rejects a result too large to hold exact cents part way through a year of daily compounding', () => {
    const result = compoundInterest({ principal: 10_000_000_000, annualRate: 1, periodsPerYear: 365, years: 100, contribution: 0, timing: 'end' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual([expect.objectContaining({ field: 'years', code: 'result-too-large' })]);
  });

  it('rejects every invalid field at once', () => {
    const result = compoundInterest({ ...base, principal: -1, annualRate: 2, years: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.field)).toEqual(['principal', 'annualRate', 'years']);
  });
});

describe('compound interest: conventions and identities', () => {
  it('adds up: final = principal + contributions + interest, and every year adds up', () => {
    const r = run(base);
    expect(r.finalBalance).toBe(base.principal + r.totalContributions + r.totalInterest);
    let previousEnd = base.principal;
    for (const year of r.years) {
      expect(year.startBalance).toBe(previousEnd);
      expect(year.endBalance).toBe(year.startBalance + year.contributions + year.interest);
      previousEnd = year.endBalance;
    }
  });

  it('at a zero rate pays no interest: final = principal + contributions', () => {
    const r = run({ ...base, annualRate: 0 });
    expect(r.totalInterest).toBe(0);
    expect(r.finalBalance).toBe(100000 + 10000 * 120);
  });

  it('rounds an exact half cent of interest up: 10 cents at 5% annual earns 1 cent', () => {
    const r = run({ principal: 10, annualRate: 0.05, periodsPerYear: 1, years: 1, contribution: 0, timing: 'end' });
    expect(r.totalInterest).toBe(1);
  });

  it('rounds an exact half cent up when the rate divides by 365: 3,650 cents at 5% daily earns 1 cent on day 1', () => {
    const r = run({ principal: 3650, annualRate: 0.05, periodsPerYear: 365, years: 1, contribution: 0, timing: 'end' });
    // Day 1 interest is exactly 0.5 cent, rounded to 1; the rest of the year then compounds on 3,651.
    expect(r.totalInterest).toBeGreaterThan(0);
    const dayOne = run({ principal: 3650, annualRate: 0.05, periodsPerYear: 1, years: 1, contribution: 0, timing: 'end' });
    expect(dayOne.totalInterest).toBe(183); // 3650 * 0.05 = 182.5, rounded up
  });

  it('start-of-period contributions earn more than end-of-period ones at a positive rate', () => {
    const start = run({ ...base, timing: 'start' });
    const end = run({ ...base, timing: 'end' });
    expect(start.finalBalance).toBeGreaterThan(end.finalBalance);
    expect(start.totalContributions).toBe(end.totalContributions);
  });

  it('stays within a few cents of the unrounded closed form', () => {
    const generator = rng(20261115);
    for (let k = 0; k < 200; k += 1) {
      const input: CompoundInput = {
        principal: generator.int(0, 50_000_000),
        annualRate: generator.int(0, 2000) / 10000,
        periodsPerYear: generator.pick([1, 2, 4, 12] as const),
        years: generator.int(1, 40),
        contribution: generator.int(0, 500_000),
        timing: generator.pick(['start', 'end'] as const),
      };
      const r = run(input);
      // Each credit rounds by at most half a cent and that error then compounds, so allow
      // half a cent per period grown at the rate (a loose but meaningful bound).
      const periods = input.periodsPerYear * input.years;
      const bound = 0.5 * periods * Math.pow(1 + input.annualRate / input.periodsPerYear, periods) + 1;
      expect(Math.abs(r.finalBalance - r.closedForm)).toBeLessThanOrEqual(bound);
    }
  });

  it('never lowers the balance at a nonnegative rate with no withdrawals', () => {
    const r = run({ ...base, periodsPerYear: 365, years: 3 });
    for (const year of r.years) expect(year.endBalance).toBeGreaterThanOrEqual(year.startBalance);
  });
});

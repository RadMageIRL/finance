import { describe, expect, it } from 'vitest';
import { MONTH_DAYS } from '../../../src/lib/engines/calendar';
import { rateFromApy, savingsGrowth, type HysaInput } from '../../../src/lib/engines/hysa';
import { rng } from '../../support/random';

const base: HysaInput = {
  principal: 1_000_000,
  years: 5,
  compounding: 'daily',
  rates: [{ fromMonth: 1, apy: 0.045 }],
  contributionFrequency: 'monthly',
  contribution: 50_000,
  timing: 'end',
};

function run(input: HysaInput) {
  const result = savingsGrowth(input);
  if (!result.ok) throw new Error(`unexpected issues: ${JSON.stringify(result.issues)}`);
  return result.value;
}

describe('savings account: invalid input is reported, not computed', () => {
  const cases: [string, Partial<HysaInput>, { field: string; code: string }][] = [
    ['a negative starting balance', { principal: -1 }, { field: 'principal', code: 'below-minimum' }],
    ['more than 50 years', { years: 51 }, { field: 'years', code: 'above-maximum' }],
    ['an unknown compounding', { compounding: 'weekly' as HysaInput['compounding'] }, { field: 'compounding', code: 'unsupported-value' }],
    ['no rates', { rates: [] }, { field: 'rates', code: 'below-minimum' }],
    ['five rates', { rates: [1, 2, 3, 4, 5].map((m) => ({ fromMonth: m, apy: 0.04 })) }, { field: 'rates', code: 'above-maximum' }],
    ['a first rate that does not start in month 1', { rates: [{ fromMonth: 2, apy: 0.04 }] }, { field: 'rates[0].fromMonth', code: 'unsupported-value' }],
    ['a rate change that does not move forward', { rates: [{ fromMonth: 1, apy: 0.04 }, { fromMonth: 1, apy: 0.03 }] }, { field: 'rates[1].fromMonth', code: 'below-minimum' }],
    ['a rate change after the last month', { years: 1, rates: [{ fromMonth: 1, apy: 0.04 }, { fromMonth: 13, apy: 0.03 }] }, { field: 'rates[1].fromMonth', code: 'above-maximum' }],
    ['an APY above 100%', { rates: [{ fromMonth: 1, apy: 1.2 }] }, { field: 'rates[0].apy', code: 'above-maximum' }],
    ['a negative contribution', { contribution: -5 }, { field: 'contribution', code: 'below-minimum' }],
  ];
  for (const [name, change, expected] of cases) {
    it(`rejects ${name}`, () => {
      const result = savingsGrowth({ ...base, ...change });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues).toEqual([expect.objectContaining(expected)]);
    });
  }

  it('rejects a balance too large to hold exact cents, naming the year it gets there', () => {
    // $100,000,000 at a 100% APY doubles every year: 2^19 times is under 2^53 - 1 cents and
    // 2^20 times is over, so the balance passes the cap during year 20.
    const result = savingsGrowth({ ...base, principal: 10_000_000_000, years: 50, rates: [{ fromMonth: 1, apy: 1 }], contributionFrequency: 'none' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual([{ field: 'years', code: 'result-too-large', limit: 20 }]);
  });
});

describe('savings account: from the advertised APY to the interest rate', () => {
  it('daily compounding: r = 365((1 + APY)^(1/365) - 1)', () => {
    // 365((1.045)^(1/365) - 1) in Python decimal: 0.04401953961415425174717532...
    const exact = 0.04401953961415425;
    expect(Math.abs(rateFromApy(0.045, 'daily') - exact) / exact).toBeLessThan(1e-13);
  });

  it('monthly compounding: the product over the real month lengths gives back the APY exactly', () => {
    for (const apy of [0.0001, 0.01, 0.045, 0.05, 0.2, 1]) {
      const r = rateFromApy(apy, 'monthly');
      const growth = MONTH_DAYS.reduce((g, days) => g * (1 + (r * days) / 365), 1);
      expect(Math.abs(growth - (1 + apy))).toBeLessThan(1e-14);
    }
    // Not the textbook 12((1 + APY)^(1/12) - 1), because months differ in length.
    expect(Math.abs(rateFromApy(0.045, 'monthly') - 12 * (Math.pow(1.045, 1 / 12) - 1))).toBeGreaterThan(1e-8);
    expect(rateFromApy(0, 'monthly')).toBe(0);
  });
});

describe('savings account: conventions and identities', () => {
  it('adds up for every month and every year, and the months add up to their year', () => {
    const generator = rng(15112026);
    for (let k = 0; k < 80; k += 1) {
      const input: HysaInput = {
        principal: generator.int(0, 20_000_000),
        years: generator.int(1, 6),
        compounding: generator.pick(['daily', 'monthly'] as const),
        rates: [{ fromMonth: 1, apy: generator.int(0, 800) / 10000 }, { fromMonth: generator.int(2, 12), apy: generator.int(0, 800) / 10000 }],
        contributionFrequency: generator.pick(['none', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annually'] as const),
        contribution: generator.int(0, 200_000),
        timing: generator.pick(['start', 'end'] as const),
      };
      const r = run(input);
      expect(r.finalBalance).toBe(input.principal + r.totalContributions + r.totalInterest);
      let previous = input.principal;
      for (const m of r.months) {
        expect(m.startBalance).toBe(previous);
        expect(m.endBalance).toBe(m.startBalance + m.contributions + m.interest);
        previous = m.endBalance;
      }
      for (const y of r.years) {
        const months = r.months.slice((y.year - 1) * 12, y.year * 12);
        expect(y.interest).toBe(months.reduce((s, m) => s + m.interest, 0));
        expect(y.contributions).toBe(months.reduce((s, m) => s + m.contributions, 0));
        expect(y.endBalance).toBe(months.at(-1)!.endBalance);
      }
    }
  });

  it('a single deposit earns the advertised APY in a year, within the cents of rounding each month: $10,000 at a 4.5 percent APY earns about $450.00', () => {
    for (const compounding of ['daily', 'monthly'] as const) {
      const r = run({ ...base, principal: 1_000_000, years: 1, compounding, rates: [{ fromMonth: 1, apy: 0.045 }], contributionFrequency: 'none' });
      // Twelve credits, each rounded by at most half a cent.
      expect(Math.abs(r.totalInterest - 45000)).toBeLessThanOrEqual(6);
    }
  });

  it('daily compounding with no deposits earns the advertised APY in every month, before rounding to the cent', () => {
    const r = run({ ...base, principal: 100_000_000, years: 1, contributionFrequency: 'none' });
    for (const m of r.months) expect(Math.abs(m.apyEarned! - 4.5)).toBeLessThan(0.0005);
  });

  it('monthly compounding earns a higher APY in a 28-day February than in a 31-day January', () => {
    const r = run({ ...base, principal: 100_000_000, years: 1, compounding: 'monthly', contributionFrequency: 'none' });
    expect(r.months[1]!.days).toBe(28);
    expect(r.months[1]!.apyEarned!).toBeGreaterThan(r.months[0]!.apyEarned!);
  });

  it('applies a rate change from its month on', () => {
    const r = run({ ...base, years: 2, rates: [{ fromMonth: 1, apy: 0.05 }, { fromMonth: 7, apy: 0 }] });
    expect(r.months.slice(0, 6).every((m) => m.rate === 0 && m.interest > 0)).toBe(true);
    expect(r.months.slice(6).every((m) => m.rate === 1 && m.interest === 0)).toBe(true);
    expect(r.rates[1]!.annualRate).toBe(0);
  });

  it('has no APY earned for a month with an average daily balance of 0', () => {
    const r = run({ ...base, principal: 0, years: 1, contribution: 10_000, timing: 'end' });
    expect(r.months[0]!.apyEarned).toBeNull();
    expect(r.months[0]!.interest).toBe(0);
    expect(r.months[1]!.apyEarned).not.toBeNull();
  });

  it('pays a deposit made during the month interest for its days only', () => {
    const weekly = run({ ...base, principal: 0, years: 1, contributionFrequency: 'weekly', contribution: 10_000, timing: 'start' });
    const january = weekly.months[0]!;
    // Deposits on days 0, 7, 14, 21, 28 are held 31, 24, 17, 10 and 3 days: 85 deposit-days.
    const expected = 10_000 * ((Math.pow(1.045, 31 / 365) - 1) + (Math.pow(1.045, 24 / 365) - 1) + (Math.pow(1.045, 17 / 365) - 1) + (Math.pow(1.045, 10 / 365) - 1) + (Math.pow(1.045, 3 / 365) - 1));
    expect(january.interest).toBe(Math.round(expected));
    expect(january.contributions).toBe(50_000);
  });
});

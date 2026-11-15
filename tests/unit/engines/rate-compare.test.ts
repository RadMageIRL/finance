import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareRates, type RateAccountInput } from '../../../src/lib/engines/rate-compare';
import type { CompoundingFrequency } from '../../../src/lib/engines/rates';

const conversions = JSON.parse(readFileSync('tests/oracle/fixtures/conversions.json', 'utf8'));

/** round_half_up(balance x value) for a plain decimal string, exactly, in integers. */
function exactInterest(balance: number, decimal: string): number {
  const [whole = '0', fraction = ''] = decimal.split('.');
  const digits = BigInt(whole + fraction);
  const scale = 10n ** BigInt(fraction.length);
  return Number((2n * BigInt(balance) * digits + scale) / (2n * scale));
}

const one = (account: RateAccountInput, balance = 1_000_000) => {
  const result = compareRates([account], balance);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value.accounts[0]!;
};

describe('rate comparison against the oracle conversions', () => {
  for (const row of conversions.apy_from_nominal) {
    it(`rate ${row.annual_rate} compounded ${row.periods_per_year} times gives APY ${row.apy_percent}% and the interest it implies`, () => {
      const a = one({ kind: 'rate', value: Number(row.annual_rate), periodsPerYear: row.periods_per_year as CompoundingFrequency });
      expect(a.apyPercent.toFixed(2)).toBe(row.apy_percent);
      expect(a.oneYearInterest).toBe(exactInterest(1_000_000, row.apy));
      if (Number(row.apy) > 0) expect(Math.abs(a.apy - Number(row.apy)) / Number(row.apy)).toBeLessThanOrEqual(1e-12);
    });
  }

  for (const row of conversions.nominal_from_apy) {
    it(`APY ${row.apy} compounded ${row.periods_per_year} times gives the oracle's interest rate`, () => {
      const a = one({ kind: 'apy', value: Number(row.apy), periodsPerYear: row.periods_per_year as CompoundingFrequency });
      const expected = Number(row.annual_rate);
      if (expected === 0) expect(a.annualRate).toBe(0);
      else expect(Math.abs(a.annualRate - expected) / expected).toBeLessThanOrEqual(1e-12);
      expect(a.apy).toBe(Number(row.apy));
      expect(a.periodicRate).toBe(a.annualRate / row.periods_per_year);
    });
  }
});

describe('rate comparison: accounts and ranking', () => {
  it('a 4.5% rate compounded daily is a 4.60% APY and earns $460.25 on $10,000 in a year', () => {
    const a = one({ kind: 'rate', value: 0.045, periodsPerYear: 365 }, 1_000_000);
    expect(a.apyPercent.toFixed(2)).toBe('4.60');
    expect(a.oneYearInterest).toBe(46025);
  });

  it('ranks by the unrounded APY, even when the disclosed APYs round to the same figure', () => {
    const r = compareRates(
      [
        { kind: 'rate', value: 0.045, periodsPerYear: 365 }, // 4.6025% APY
        null,
        { kind: 'rate', value: 0.046, periodsPerYear: 1 }, // 4.6000% APY
      ],
      1_000_000,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.accounts.map((a) => a.index)).toEqual([0, 2]);
    expect(r.value.accounts.map((a) => a.apyPercent)).toEqual([4.6, 4.6]);
    expect(r.value.best).toEqual([0]);
  });

  it('reports a true tie as several best accounts', () => {
    const same: RateAccountInput = { kind: 'rate', value: 0.05, periodsPerYear: 12 };
    const r = compareRates([same, same], 500_000);
    expect(r.ok && r.value.best).toEqual([0, 1]);
  });

  it('round-trips: the APY of a rate converts back to the same rate', () => {
    for (const n of [1, 2, 4, 12, 52, 365] as const) {
      const fromRate = one({ kind: 'rate', value: 0.0425, periodsPerYear: n });
      const back = one({ kind: 'apy', value: fromRate.apy, periodsPerYear: n });
      expect(Math.abs(back.annualRate - 0.0425)).toBeLessThan(1e-15);
    }
  });
});

describe('rate comparison: invalid input is reported, not computed', () => {
  const ok: RateAccountInput = { kind: 'rate', value: 0.05, periodsPerYear: 12 };
  const cases: [string, (RateAccountInput | null)[], number, { field: string; code: string }][] = [
    ['no accounts at all', [null, null, null], 100, { field: 'accounts', code: 'below-minimum' }],
    ['four accounts', [ok, ok, ok, ok], 100, { field: 'accounts', code: 'above-maximum' }],
    ['a rate above 100%', [{ ...ok, value: 1.5 }], 100, { field: 'accounts[0].value', code: 'above-maximum' }],
    ['a negative APY', [null, { ...ok, kind: 'apy', value: -0.01 }], 100, { field: 'accounts[1].value', code: 'below-minimum' }],
    ['an unsupported compounding frequency', [{ ...ok, periodsPerYear: 3 as CompoundingFrequency }], 100, { field: 'accounts[0].periodsPerYear', code: 'unsupported-value' }],
    ['an unknown kind', [{ ...ok, kind: 'apr' as RateAccountInput['kind'] }], 100, { field: 'accounts[0].kind', code: 'unsupported-value' }],
    ['a zero balance', [ok], 0, { field: 'balance', code: 'below-minimum' }],
    ['fractional cents', [ok], 10.5, { field: 'balance', code: 'not-an-integer' }],
    ['a balance above the cap', [ok], 10_000_000_001, { field: 'balance', code: 'above-maximum' }],
  ];
  for (const [name, accounts, balance, expected] of cases) {
    it(`rejects ${name}`, () => {
      const r = compareRates(accounts, balance);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues).toEqual([expect.objectContaining(expected)]);
    });
  }
});

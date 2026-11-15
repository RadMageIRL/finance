import { describe, expect, it } from 'vitest';
import { COMPOUNDING_FREQUENCIES, apyFromNominal, nominalFromApy, type CompoundingFrequency } from '../../../src/lib/engines/rates';

describe('rate and APY conversions', () => {
  it('gives an APY at least equal to the nominal rate, equal only with annual compounding', () => {
    for (const rate of [0.0001, 0.01, 0.05, 0.25, 1]) {
      expect(apyFromNominal(rate, 1)).toBeCloseTo(rate, 15);
      for (const n of [2, 4, 12, 52, 365] as const) expect(apyFromNominal(rate, n)).toBeGreaterThan(rate);
    }
  });

  it('gives a higher APY the more often interest compounds', () => {
    const apys = COMPOUNDING_FREQUENCIES.map((n) => apyFromNominal(0.05, n));
    for (let k = 1; k < apys.length; k += 1) expect(apys[k]!).toBeGreaterThan(apys[k - 1]!);
  });

  it('round-trips: nominal to APY and back returns the nominal rate', () => {
    for (const rate of [0, 0.0001, 0.0425, 0.05, 0.2499, 1]) {
      for (const n of COMPOUNDING_FREQUENCIES) {
        const back = nominalFromApy(apyFromNominal(rate, n), n as CompoundingFrequency);
        expect(Math.abs(back - rate)).toBeLessThanOrEqual(1e-14);
      }
    }
  });

  it('refuses an unsupported compounding frequency or a negative rate', () => {
    expect(() => apyFromNominal(0.05, 3 as CompoundingFrequency)).toThrow(RangeError);
    expect(() => apyFromNominal(-0.01, 12)).toThrow(RangeError);
    expect(() => nominalFromApy(Number.NaN, 12)).toThrow(RangeError);
  });
});

import { describe, expect, it } from 'vitest';
import { percent2Text, periodicInterest, roundCents, roundPercent2, sumCents } from '../../../src/lib/engines/money';

describe('roundCents: half away from zero, to the cent', () => {
  it('rounds exact halves away from zero in both directions', () => {
    expect([0.5, 1.5, 2.5, 101.5].map(roundCents)).toEqual([1, 2, 3, 102]);
    expect([-0.5, -1.5, -2.5].map(roundCents)).toEqual([-1, -2, -3]);
  });

  it('rounds values just off a half toward the nearer cent', () => {
    expect([0.49, 0.51, 2.4999, 2.5001].map(roundCents)).toEqual([0, 1, 2, 3]);
  });

  it('treats a float that is an exact half in decimal (1.005 dollars) as the half it is', () => {
    expect(1.005 * 100).toBeLessThan(100.5);
    expect(roundCents(1.005 * 100)).toBe(101);
  });

  it('keeps whole cents unchanged at the top of the input range', () => {
    expect(roundCents(10_000_000_000)).toBe(10_000_000_000);
    expect(roundCents(9_999_999_999.5)).toBe(10_000_000_000);
  });

  it('never bumps a whole number at large magnitudes (5,242,880,000,000,000 stays put)', () => {
    expect(roundCents(5_242_880_000_000_000)).toBe(5_242_880_000_000_000);
    expect(roundCents(9_007_199_254_740_991)).toBe(9_007_199_254_740_991);
  });

  it('keeps a real fraction at large magnitudes instead of treating it as a half', () => {
    // 500,000,000,000,000.375 is exactly representable; .375 must round down, not snap to .5.
    expect(roundCents(500_000_000_000_000.375)).toBe(500_000_000_000_000);
  });

  it('returns 0, never negative zero, for tiny negative values', () => {
    expect(Object.is(roundCents(-0.2), 0)).toBe(true);
  });

  it('refuses values that are not finite', () => {
    expect(() => roundCents(Number.NaN)).toThrow(RangeError);
    expect(() => roundCents(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('periodicInterest: balance x rate / n, posted exactly to the cent', () => {
  it('rounds exact half-cent ties up at any magnitude', () => {
    expect(periodicInterest(10, 0.05, 1)).toBe(1); // 0.5 cent
    expect(periodicInterest(3650, 0.05, 365)).toBe(1); // 0.5 cent with a repeating rate / 365
    expect(periodicInterest(100, 0.06, 12)).toBe(1); // 0.5 cent
    expect(periodicInterest(9_007_199_254_740_990, 0.5, 2)).toBe(2_251_799_813_685_248); // .5 at 2^53 scale
  });

  it('rounds down just below a half and up just above', () => {
    expect(periodicInterest(9, 0.05, 1)).toBe(0); // 0.45
    expect(periodicInterest(11, 0.05, 1)).toBe(1); // 0.55
  });

  it('reads the rate as its shortest decimal, including tiny rates written with an exponent', () => {
    expect(periodicInterest(100_000_000, 0.0000001, 1)).toBe(10); // 1e-7
    expect(periodicInterest(100_000_000, 0.0525, 12)).toBe(437_500);
  });

  it('refuses a balance that is not whole cents or a negative rate', () => {
    expect(() => periodicInterest(1.5, 0.05, 12)).toThrow(RangeError);
    expect(() => periodicInterest(100, -0.01, 12)).toThrow(RangeError);
  });
});

describe('roundPercent2: nearest 0.01 percentage point (12 CFR 1030.3(f)(1))', () => {
  it('rounds 5.644% down and 5.645% up, as in the official commentary', () => {
    expect(roundPercent2(5.644)).toBe(5.64);
    expect(roundPercent2(5.645)).toBe(5.65);
    expect(percent2Text(5.645)).toBe('5.65');
  });

  it('always shows two decimals', () => {
    expect(percent2Text(5.4)).toBe('5.40');
    expect(percent2Text(0)).toBe('0.00');
  });
});

describe('sumCents', () => {
  it('adds whole-cent amounts', () => {
    expect(sumCents([1, 2, 3])).toBe(6);
  });

  it('refuses a fractional cent amount', () => {
    expect(() => sumCents([1, 2.5])).toThrow(RangeError);
  });
});

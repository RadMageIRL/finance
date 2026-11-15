// Published worked examples from 12 CFR part 1030 (Regulation DD), Appendix A, transcribed
// from the regulation text (local/research/calc/raw/regdd/part1030.xml.txt). These test the
// engines against the regulator directly, independently of the oracle fixtures.
import { describe, expect, it } from 'vitest';
import { percent2Text, roundCents } from '../../../src/lib/engines/money';
import { apyEarnedPercent, creditedDailyInterest, dailyCompoundedInterest, regDdApyPercent, type RateSegment } from '../../../src/lib/engines/rates';

const apy = (interest: number, principal: number, days: number) => percent2Text(regDdApyPercent(interest, principal, days));
// Interest credited at the end of each year of the term and at maturity (conventions v1.1).
const interestCents = (principal: number, segments: RateSegment[]) => creditedDailyInterest(principal, segments);

describe('Regulation DD Appendix A, part I.A: APY from interest paid', () => {
  it('$61.68 on $1,000 for 365 days is an APY of 6.17%', () => {
    expect(apy(6168, 100000, 365)).toBe('6.17');
  });

  it('$30.37 on a $1,000 182-day certificate is an APY of 6.18%', () => {
    expect(apy(3037, 100000, 182)).toBe('6.18');
  });
});

describe('Regulation DD Appendix A, parts I.B and I.C: stepped and variable rates, compounded daily', () => {
  it('5% for 91 days then 5.5% for 92 days on $1,000 pays $26.68, an APY of 5.39%', () => {
    const interest = interestCents(100000, [{ annualRate: 0.05, days: 91 }, { annualRate: 0.055, days: 92 }]);
    expect(interest).toBe(2668);
    expect(apy(interest, 100000, 183)).toBe('5.39');
  });

  it('6% for one year then 6.5% for the next on $1,000 pays $133.13, an APY of 6.45%', () => {
    const interest = interestCents(100000, [{ annualRate: 0.06, days: 365 }, { annualRate: 0.065, days: 365 }]);
    expect(interest).toBe(13313);
    expect(apy(interest, 100000, 730)).toBe('6.45');
  });

  it('7% for 91 days then 5% for 274 days on $1,000 pays $56.52, an APY of 5.65%', () => {
    const interest = interestCents(100000, [{ annualRate: 0.07, days: 91 }, { annualRate: 0.05, days: 274 }]);
    expect(interest).toBe(5652);
    expect(apy(interest, 100000, 365)).toBe('5.65');
  });
});

describe('Regulation DD Appendix A, part I.D: tiered rates', () => {
  it('Method A: each tier pays its rate on the whole balance', () => {
    const cases: [number, number, number, string][] = [
      [100000, 0.0525, 5390, '5.39'],
      [800000, 0.055, 45229, '5.65'],
      [2000000, 0.0575, 118361, '5.92'],
    ];
    for (const [principal, rate, expectedInterest, expectedApy] of cases) {
      const interest = interestCents(principal, [{ annualRate: rate, days: 365 }]);
      expect(interest).toBe(expectedInterest);
      expect(apy(interest, principal, 365)).toBe(expectedApy);
    }
  });

  it('Method B: each rate applies only to the slice of the balance in its tier', () => {
    const tierB = (balance: number): number => {
      const slices: [number, number][] = [
        [Math.min(balance, 250000), 0.0525],
        [Math.min(Math.max(balance - 250000, 0), 1250000), 0.055],
        [Math.max(balance - 1500000, 0), 0.0575],
      ];
      const total = slices.reduce((sum, [slice, rate]) => sum + dailyCompoundedInterest(slice, [{ annualRate: rate, days: 365 }]), 0);
      return roundCents(total);
    };
    // [balance, published interest, principal the regulation divides by, published APY]
    const cases: [number, number, number, string][] = [
      [100000, 5390, 100000, '5.39'],
      [250001, 13475, 250000, '5.39'],
      [1500000, 84145, 1500000, '5.61'],
      [1500001, 84145, 1500000, '5.61'],
      [10000000, 587179, 10000000, '5.87'],
      [100000000, 5913422, 100000000, '5.91'],
    ];
    for (const [balance, expectedInterest, divisor, expectedApy] of cases) {
      expect(tierB(balance)).toBe(expectedInterest);
      expect(apy(expectedInterest, divisor, 365)).toBe(expectedApy);
    }
  });
});

describe('Regulation DD Appendix A, part II.A: APY earned on periodic statements', () => {
  it('$5.25 on an average daily balance of $1,000 over 30 days is 6.58%', () => {
    expect(percent2Text(apyEarnedPercent(525, 100000, 30))).toBe('6.58');
  });

  it('$6.50 on an average daily balance of $1,500 over 30 days is 5.40%', () => {
    expect(percent2Text(apyEarnedPercent(650, 150000, 30))).toBe('5.40');
  });

  it('$21 on an average daily balance of $2,000 over 91 days is 4.28%', () => {
    expect(percent2Text(apyEarnedPercent(2100, 200000, 91))).toBe('4.28');
  });
});

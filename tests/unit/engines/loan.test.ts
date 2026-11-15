import { describe, expect, it } from 'vitest';
import { amortize, scheduledPayment, type LoanInput } from '../../../src/lib/engines/loan';
import { rng } from '../../support/random';

const reference: LoanInput = { principal: 20_000_000, annualRate: 0.06, termMonths: 360 };

function schedule(input: LoanInput) {
  const result = amortize(input);
  if (!result.ok) throw new Error(`unexpected issues: ${JSON.stringify(result.issues)}`);
  return result.value;
}

function expectIdentities(input: LoanInput) {
  const s = schedule(input);
  const repaid = s.rows.reduce((sum, row) => sum + row.principal + row.extra, 0);
  expect(repaid).toBe(input.principal);
  expect(s.rows.at(-1)!.balance).toBe(0);
  expect(s.totalPaid).toBe(input.principal + s.totalInterest);
  expect(s.months).toBeLessThanOrEqual(input.termMonths);
  return s;
}

describe('loan payment', () => {
  it('matches the reference: $200,000 at 6% for 360 months is $1,199.10 a month', () => {
    expect(scheduledPayment(20_000_000, 0.06, 360)).toBe(119_910);
  });

  it('at a zero rate is the principal divided evenly, rounded to the cent', () => {
    expect(scheduledPayment(1_200_000, 0, 120)).toBe(10_000);
    expect(scheduledPayment(100_000, 0, 7)).toBe(14_286);
  });
});

describe('amortization schedule: conventions and identities', () => {
  it('repays exactly the principal and ends at a zero balance in month 360', () => {
    const s = expectIdentities(reference);
    expect(s.months).toBe(360);
    expect(s.rows[0]).toEqual({ month: 1, payment: 119_910, interest: 100_000, principal: 19_910, extra: 0, balance: 19_980_090 });
  });

  it('absorbs the rounded payment residual in a final payment at month N', () => {
    // 100,000 cents over 7 months at 0%: six payments of 14,286 leave 14,284 for the last.
    const s = expectIdentities({ principal: 100_000, annualRate: 0, termMonths: 7 });
    expect(s.rows.map((r) => r.payment)).toEqual([14_286, 14_286, 14_286, 14_286, 14_286, 14_286, 14_284]);
  });

  it('applies extra principal after the scheduled payment and ends early', () => {
    const s = expectIdentities({ ...reference, extraMonthly: 20_000 });
    expect(s.rows[0]!.extra).toBe(20_000);
    expect(s.months).toBeLessThan(360);
  });

  it('caps a one-time payment at the remaining balance and stops there', () => {
    const s = expectIdentities({ ...reference, oneTime: [{ month: 12, amount: 9_000_000_000 }] });
    expect(s.months).toBe(12);
    expect(s.rows[11]!.balance).toBe(0);
    expect(s.rows[11]!.extra).toBeLessThan(9_000_000_000);
  });

  it('adds together one-time payments that share a month', () => {
    const one = schedule({ ...reference, oneTime: [{ month: 5, amount: 150_000 }] });
    const two = schedule({ ...reference, oneTime: [{ month: 5, amount: 100_000 }, { month: 5, amount: 50_000 }] });
    expect(two.rows).toEqual(one.rows);
  });

  it('rounds an exact half cent of interest up: 100 cents at 6% owes 1 cent in month 1', () => {
    const s = expectIdentities({ principal: 100, annualRate: 0.06, termMonths: 12 });
    expect(s.rows[0]!.interest).toBe(1);
  });

  it('handles a one-month term as a single final payment', () => {
    const s = expectIdentities({ principal: 500_000, annualRate: 0.12, termMonths: 1 });
    expect(s.rows).toEqual([{ month: 1, payment: 505_000, interest: 5_000, principal: 500_000, extra: 0, balance: 0 }]);
  });

  it('handles the extremes of the input range', () => {
    const tiny = expectIdentities({ principal: 1, annualRate: 0, termMonths: 12 });
    expect(tiny.rows.map((r) => r.payment)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expectIdentities({ principal: 100, annualRate: 0.005, termMonths: 12 });
    expectIdentities({ principal: 10_000_000_000, annualRate: 1, termMonths: 120 });
  });

  it('refuses loans whose payment rounds to no more than their interest', () => {
    // 1 cent at 6%: payment and interest both round to 0. $100 million at 100% over 600
    // months: the principal part of each payment is about 1e-11 cents.
    for (const input of [
      { principal: 1, annualRate: 0.06, termMonths: 360 },
      { principal: 10_000_000_000, annualRate: 1, termMonths: 600 },
    ]) {
      const result = amortize(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues).toEqual([{ field: 'annualRate', code: 'payment-does-not-cover-interest' }]);
    }
  });

  it('never increases total interest or the payoff month when extra payments are added', () => {
    const generator = rng(1115);
    for (let k = 0; k < 150; k += 1) {
      const input: LoanInput = {
        principal: generator.int(100_000, 100_000_000),
        annualRate: generator.int(0, 1500) / 10000,
        termMonths: generator.pick([12, 36, 60, 120, 180, 360]),
      };
      const baseline = expectIdentities(input);
      const extraMonthly = generator.int(1, 200_000);
      const month = generator.int(1, input.termMonths);
      const accelerated = expectIdentities({ ...input, extraMonthly, oneTime: [{ month, amount: generator.int(1, 5_000_000) }] });
      expect(accelerated.totalInterest).toBeLessThanOrEqual(baseline.totalInterest);
      expect(accelerated.months).toBeLessThanOrEqual(baseline.months);
    }
  });
});

describe('amortization: invalid input is reported, not computed', () => {
  const cases: [string, Partial<LoanInput>, { field: string; code: string }][] = [
    ['a zero principal', { principal: 0 }, { field: 'principal', code: 'below-minimum' }],
    ['fractional cents', { principal: 1000.25 }, { field: 'principal', code: 'not-an-integer' }],
    ['an infinite rate', { annualRate: Number.POSITIVE_INFINITY }, { field: 'annualRate', code: 'not-a-number' }],
    ['a rate above 100%', { annualRate: 1.5 }, { field: 'annualRate', code: 'above-maximum' }],
    ['a zero term', { termMonths: 0 }, { field: 'termMonths', code: 'below-minimum' }],
    ['a term over 600 months', { termMonths: 601 }, { field: 'termMonths', code: 'above-maximum' }],
    ['a negative extra payment', { extraMonthly: -5 }, { field: 'extraMonthly', code: 'below-minimum' }],
    ['a one-time payment after the term', { oneTime: [{ month: 361, amount: 100 }] }, { field: 'oneTime[0].month', code: 'above-maximum' }],
    ['a one-time payment of zero', { oneTime: [{ month: 3, amount: 0 }] }, { field: 'oneTime[0].amount', code: 'below-minimum' }],
  ];
  for (const [name, change, expected] of cases) {
    it(`rejects ${name}`, () => {
      const result = amortize({ ...reference, ...change });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues).toEqual([expect.objectContaining(expected)]);
    });
  }
});

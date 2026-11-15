// The engines against the independent Python decimal oracle (tests/oracle/generate.py).
// Money must match to the cent; unrounded fractions to a relative 1e-12.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compoundInterest, type CompoundFrequency, type ContributionFrequency } from '../../../src/lib/engines/compound';
import { savingsGrowth, type HysaCompounding } from '../../../src/lib/engines/hysa';
import { amortize } from '../../../src/lib/engines/loan';
import { percent2Text, roundCents } from '../../../src/lib/engines/money';
import {
  apyEarnedPercent,
  apyFromNominal,
  creditedDailyInterest,
  dailyCompoundedInterest,
  nominalFromApy,
  regDdApyPercent,
  type CompoundingFrequency,
} from '../../../src/lib/engines/rates';

const fixture = (name: string) => JSON.parse(readFileSync(`tests/oracle/fixtures/${name}.json`, 'utf8'));
const regdd = fixture('regdd');
const conversions = fixture('conversions');
const loans = fixture('loans');
const compound = fixture('compound');
const hysa = fixture('hysa');

function expectCloseRelative(actual: number, expected: number, tolerance = 1e-12) {
  if (expected === 0) expect(Math.abs(actual)).toBeLessThanOrEqual(1e-15);
  else expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThanOrEqual(tolerance);
}

describe('oracle fixtures', () => {
  it('were generated under the conventions this code implements (v1.5)', () => {
    for (const f of [regdd, conversions, loans, compound, hysa, fixture('schedules'), fixture('illustration'), fixture('loan_reports')]) expect(f.conventions).toBe('v1.5');
  });

  it('cover every contribution frequency with every compounding frequency and both timings', () => {
    const seen = new Set(compound.cases.map((c: { contribution_frequency: string; periods_per_year: number; timing: string }) => `${c.contribution_frequency} ${c.periods_per_year} ${c.contribution_frequency === 'none' ? 'end' : c.timing}`));
    for (const f of ['weekly', 'biweekly', 'monthly', 'quarterly', 'annually']) {
      for (const n of [1, 2, 4, 12, 365]) for (const timing of ['start', 'end']) expect(seen.has(`${f} ${n} ${timing}`), `${f} ${n} ${timing}`).toBe(true);
    }
    for (const n of [1, 2, 4, 12, 365]) expect(seen.has(`none ${n} end`), `none ${n}`).toBe(true);
  });
});

describe('oracle: Regulation DD', () => {
  it('APY from interest matches the oracle and the published figures', () => {
    for (const c of regdd.apy_from_interest) {
      const percent = regDdApyPercent(c.interest_cents, c.principal_cents, c.days);
      expect(percent2Text(percent), c.id).toBe(c.oracle_apy_percent);
      expect(c.oracle_apy_percent, c.id).toBe(c.published_apy_percent);
      expectCloseRelative(percent, Number(c.oracle_apy_unrounded));
    }
  });

  it('daily compounding with annual crediting matches every credit and the total', () => {
    for (const c of regdd.daily_compounded) {
      const segments = c.segments.map((s: { annual_rate: string; days: number }) => ({ annualRate: Number(s.annual_rate), days: s.days }));
      expect(creditedDailyInterest(c.principal_cents, segments), c.id).toBe(c.oracle_interest_cents);
      expect(c.oracle_interest_cents, c.id).toBe(c.published_interest_cents);
      expectCloseRelative(dailyCompoundedInterest(c.principal_cents, segments), Number(c.oracle_interest_unrounded_cents));
      expect(percent2Text(regDdApyPercent(c.oracle_interest_cents, c.principal_cents, c.term_days)), c.id).toBe(c.published_apy_percent);
    }
  });

  it('tiered Method B matches the oracle', () => {
    for (const c of regdd.tiered_method_b) {
      let lower = 0;
      let total = 0;
      for (const tier of c.tiers as { up_to_cents: number | null; annual_rate: string }[]) {
        const upper = tier.up_to_cents ?? Number.POSITIVE_INFINITY;
        const slice = Math.max(0, Math.min(c.balance_cents, upper) - lower);
        total += dailyCompoundedInterest(slice, [{ annualRate: Number(tier.annual_rate), days: c.days }]);
        lower = upper;
      }
      expect(roundCents(total), c.id).toBe(c.oracle_interest_cents);
      expect(percent2Text(regDdApyPercent(c.oracle_interest_cents, c.apy_principal_cents, c.days)), c.id).toBe(c.oracle_apy_percent);
    }
  });

  it('APY earned matches the oracle', () => {
    for (const c of regdd.apy_earned) {
      expect(percent2Text(apyEarnedPercent(c.interest_cents, c.balance_cents, c.days)), c.id).toBe(c.oracle_apy_earned_percent);
    }
  });
});

describe('oracle: conversions', () => {
  it(`nominal to APY matches all ${conversions.apy_from_nominal.length} grid points`, () => {
    for (const c of conversions.apy_from_nominal) {
      const apy = apyFromNominal(Number(c.annual_rate), c.periods_per_year as CompoundingFrequency);
      expectCloseRelative(apy, Number(c.apy));
      expect(percent2Text(apy * 100), `${c.annual_rate} n=${c.periods_per_year}`).toBe(c.apy_percent);
    }
  });

  it(`APY to nominal matches all ${conversions.nominal_from_apy.length} grid points`, () => {
    for (const c of conversions.nominal_from_apy) {
      expectCloseRelative(nominalFromApy(Number(c.apy), c.periods_per_year as CompoundingFrequency), Number(c.annual_rate));
    }
  });
});

describe('oracle: loan schedules', () => {
  for (const c of loans.cases) {
    it(`${c.id}: every row matches to the cent`, () => {
      const result = amortize({
        principal: c.principal_cents,
        annualRate: Number(c.annual_rate),
        termMonths: c.term_months,
        extraMonthly: c.extra_monthly_cents,
        oneTime: c.one_time.map((o: { month: number; amount_cents: number }) => ({ month: o.month, amount: o.amount_cents })),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const s = result.value;
      expect(s.payment).toBe(c.payment_cents);
      expect(s.months).toBe(c.months);
      expect(s.totalInterest).toBe(c.total_interest_cents);
      expect(s.totalPaid).toBe(c.total_paid_cents);
      expect(s.rows.map((r) => [r.month, r.payment, r.interest, r.principal, r.extra, r.balance])).toEqual(c.rows);
    });
  }
});

describe('oracle: compound interest', () => {
  for (const c of compound.cases) {
    it(`${c.id}: every year matches to the cent`, () => {
      const result = compoundInterest({
        principal: c.principal_cents,
        annualRate: Number(c.annual_rate),
        periodsPerYear: c.periods_per_year as CompoundFrequency,
        years: c.years,
        contributionFrequency: c.contribution_frequency as ContributionFrequency,
        contribution: c.contribution_cents,
        timing: c.timing,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const r = result.value;
      expect(r.finalBalance).toBe(c.final_balance_cents);
      expect(r.contributionCount).toBe(c.contribution_count);
      expect(r.totalContributions).toBe(c.total_contributions_cents);
      expect(r.totalInterest).toBe(c.total_interest_cents);
      expect(r.years.map((y) => [y.year, y.startBalance, y.contributions, y.interest, y.endBalance])).toEqual(c.yearly);
    });
  }
});

describe('oracle: savings account (HYSA)', () => {
  for (const c of hysa.cases) {
    it(`${c.id}: every month and year matches to the cent, rates and APY earned to 1e-12`, () => {
      const result = savingsGrowth({
        principal: c.principal_cents,
        years: c.years,
        compounding: c.compounding as HysaCompounding,
        rates: c.rates.map((r: { from_month: number; apy: string }) => ({ fromMonth: r.from_month, apy: Number(r.apy) })),
        contributionFrequency: c.contribution_frequency as ContributionFrequency,
        contribution: c.contribution_cents,
        timing: c.timing,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const r = result.value;
      expect(r.finalBalance).toBe(c.final_balance_cents);
      expect(r.contributionCount).toBe(c.contribution_count);
      expect(r.totalContributions).toBe(c.total_contributions_cents);
      expect(r.totalInterest).toBe(c.total_interest_cents);
      expect(r.months.map((m) => [m.month, m.days, m.startBalance, m.contributions, m.interest, m.endBalance])).toEqual(c.monthly);
      expect(r.years.map((y) => [y.year, y.startBalance, y.contributions, y.interest, y.endBalance])).toEqual(c.yearly);
      r.rates.forEach((rate, i) => expectCloseRelative(rate.annualRate, Number(c.rates[i].annual_rate)));
      r.months.forEach((m, i) => {
        const expected = c.monthly_apy_earned_percent[i];
        if (expected === null) expect(m.apyEarned).toBeNull();
        else expectCloseRelative(m.apyEarned!, Number(expected));
      });
    });
  }
});

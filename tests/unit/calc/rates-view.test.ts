import { describe, expect, it } from 'vitest';
import { DEFAULT_RATES, percentText, ratesCsv, ratesIssueMessage, ratesShareState, ratesView } from '../../../src/lib/calc/rates-view';
import { horizontalBarsSvg } from '../../../src/lib/calc/chart';
import { compareRates, type RateAccountInput } from '../../../src/lib/engines/rate-compare';

function compare(accounts: (RateAccountInput | null)[], balance = 1_000_000) {
  const r = compareRates(accounts, balance);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

describe('APR/APY view', () => {
  it('describes a single conversion: 4.5% compounded daily is a 4.60% APY, about $460.25 on $10,000', () => {
    const v = ratesView(compare([{ kind: 'rate', value: 0.045, periodsPerYear: 365 }, null, null]));
    expect(v.hero).toBe('4.60% APY');
    expect(v.heroNote).toBe('4.5% interest rate, compounded daily');
    expect(v.summary).toContain('$10,000.00 left in the account for a year');
    expect(v.summary).toContain('$460.25');
    expect(v.rows[0]!.best).toBe(false);
  });

  it('names the best account and the others, from highest to lowest', () => {
    const r = compare(DEFAULT_RATES.accounts);
    const v = ratesView(r);
    expect(v.rows.map((row) => row.name)).toEqual(['Account A', 'Account B']);
    expect(v.heroNote).toBe('Account A has the highest APY');
    expect(v.summary).toContain('Account A earns about $460.25, compared with $455.00 for Account B.');
    expect(v.rows[0]!.best).toBe(true);
  });

  it('says when a lower APY rounds to the same disclosed figure', () => {
    const v = ratesView(compare([{ kind: 'rate', value: 0.045, periodsPerYear: 365 }, null, { kind: 'rate', value: 0.046, periodsPerYear: 1 }]));
    expect(v.rows.map((r) => r.apy)).toEqual(['4.60%', '4.60%']);
    expect(v.heroNote).toBe('Account A has the highest APY. Account C also shows 4.60% once rounded, but earns a little less');
  });

  it('shows a rate derived from an APY to four decimals, and the rate per period', () => {
    const v = ratesView(compare([{ kind: 'apy', value: 0.0455, periodsPerYear: 12 }]));
    expect(v.rows[0]!.rate).toBe('4.4578%');
    expect(v.rows[0]!.periodic).toBe('0.371482% a month'); // 0.3714819558...% (Python decimal)
    expect(v.rows[0]!.apy).toBe('4.55%');
    expect(v.rows[0]!.after).toBe('$10,455.00');
  });

  it('lists the APY of the first rate at every compounding frequency, marking the current one', () => {
    const v = ratesView(compare([{ kind: 'rate', value: 0.05, periodsPerYear: 12 }]));
    expect(v.byFrequency.map((r) => `${r.label} ${r.apy}`)).toEqual([
      'Annually 5.00%',
      'Semiannually 5.06%',
      'Quarterly 5.09%',
      'Monthly 5.12%',
      'Weekly 5.12%',
      'Daily 5.13%',
    ]);
    expect(v.byFrequency.filter((r) => r.current).map((r) => r.label)).toEqual(['Monthly']);
  });

  it('exports one CSV row per account with unformatted numbers', () => {
    const lines = ratesCsv(compare(DEFAULT_RATES.accounts)).trim().split('\r\n');
    expect(lines[0]).toBe('account,entered,periods_per_year,interest_rate_percent,periodic_rate_percent,apy_percent,apy_unrounded_percent,reference_balance_usd,one_year_interest_usd,balance_after_one_year_usd');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^A,interest rate,365,4\.5000000000,0\.0123287671,4\.60,4\.60\d+,10000\.00,460\.25,10460\.25$/);
    expect(lines[2]).toMatch(/^B,apy,12,4\.45\d+,0\.37\d+,4\.55,4\.5500000000,10000\.00,455\.00,10455\.00$/);
  });

  it('puts only the filled accounts in the share state, rates as entered', () => {
    expect(ratesShareState(DEFAULT_RATES)).toEqual({ b: 1_000_000, k0: 'rate', v0: '4.5', n0: '365', k1: 'apy', v1: '4.55', n1: '12', y: 5 });
  });

  it('maps engine issues to the field that shows them', () => {
    expect(ratesIssueMessage({ field: 'accounts[2].value', code: 'above-maximum', limit: 1 })).toEqual({ field: 'value2', message: 'Rates up to 100% only.' });
    expect(ratesIssueMessage({ field: 'accounts', code: 'below-minimum', limit: 1 }).field).toBe('value0');
    expect(ratesIssueMessage({ field: 'balance', code: 'above-maximum', limit: 1 }).field).toBe('balance');
  });

  it('formats percents with trailing zeros removed', () => {
    expect(percentText(0.045, 4)).toBe('4.5%');
    expect(percentText(0.04, 4)).toBe('4%');
    expect(percentText(1, 4)).toBe('100%');
  });
});

describe('horizontal bar chart', () => {
  const svg = horizontalBarsSvg({ categories: ['A', 'B <x>'], values: [46025, 0], formatValue: (c) => `$${c}`, title: 't', description: 'd', idPrefix: 'h', width: 400 });

  it('draws one hit area and one value label per bar, and no bar for a zero value', () => {
    expect(svg.match(/class="chart__hit"/g)).toHaveLength(2);
    expect(svg.match(/class="chart__label"/g)).toHaveLength(2);
    expect(svg.match(/<path class="chart__seg/g)).toHaveLength(1);
    expect(svg).toContain('B &lt;x&gt;');
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_SAVINGS, savingsCsv, savingsIssueMessage, savingsShareState, savingsView } from '../../../src/lib/calc/savings-view';
import { savingsGrowth, type HysaInput } from '../../../src/lib/engines/hysa';

function view(change: Partial<HysaInput> = {}) {
  const input = { ...DEFAULT_SAVINGS, ...change };
  const result = savingsGrowth(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return { input, result: result.value, view: savingsView(input, result.value) };
}

describe('savings view', () => {
  it('breaks the final balance into starting balance, deposits and interest that add up', () => {
    const { result, view: v } = view();
    const cents = (text: string) => Number(text.replace(/[$,.]/g, ''));
    expect(cents(v.breakdown[0]!.value) + cents(v.breakdown[1]!.value) + cents(v.breakdown[2]!.value)).toBe(result.finalBalance);
    expect(v.yearRows).toHaveLength(5);
    expect(v.monthRows).toHaveLength(60);
    expect(v.yearRows.at(-1)!.cells.at(-1)).toBe(v.final);
  });

  it('describes the rates, deposits and compounding in the summary', () => {
    const { view: v } = view();
    expect(v.summary).toContain('at a 4.50% APY, compounded daily and credited monthly');
    expect(v.summary).toContain('$500.00 a month at the end of each month (60 deposits, $30,000.00 in all)');
    const two = view({ rates: [{ fromMonth: 1, apy: 0.05 }, { fromMonth: 13, apy: 0.035 }], compounding: 'monthly' }).view;
    expect(two.summary).toContain('at APYs of 5.00%, then 3.50%, compounded and credited monthly');
  });

  it('lists each rate with the months it covers, its interest rate and the APY earned', () => {
    const { view: v } = view({ rates: [{ fromMonth: 1, apy: 0.05 }, { fromMonth: 13, apy: 0.035 }] });
    expect(v.rates.map((r) => r.months)).toEqual(['Months 1 to 12', 'Months 13 to 60']);
    expect(v.rates.map((r) => r.apy)).toEqual(['5.00%', '3.50%']);
    expect(v.rates[0]!.rate).toBe('4.8793%');
    expect(v.rates[0]!.earned).toMatch(/^\d\.\d{2}%( to \d\.\d{2}%)?$/);
  });

  it('shows None for a month with no average balance, and no deposits wording without deposits', () => {
    const empty = view({ principal: 0, years: 1, timing: 'end' });
    expect(empty.view.monthRows[0]!.cells.at(-1)).toBe('None');
    expect(view({ contributionFrequency: 'none' }).view.summary).toContain('with no regular deposits');
  });

  it('exports one CSV row per month with unformatted numbers', () => {
    const { result } = view({ years: 1 });
    const lines = savingsCsv(result).trim().split('\r\n');
    expect(lines[0]).toBe('month,year,days,apy_percent,interest_rate_percent,start_balance_usd,deposits_usd,interest_usd,end_balance_usd,apy_earned_percent');
    expect(lines).toHaveLength(13);
    expect(lines[2]).toMatch(/^2,1,28,4\.50,4\.40\d+,\d+\.\d{2},500\.00,\d+\.\d{2},\d+\.\d{2},4\.\d+$/);
  });

  it('puts rate changes and deposits in the share state only when there are any', () => {
    expect(savingsShareState(DEFAULT_SAVINGS)).toEqual({ p: 1_000_000, r0: '4.5', cmp: 'daily', y: 5, f: 'monthly', c: 50_000, t: 'end' });
    expect(savingsShareState({ ...DEFAULT_SAVINGS, contributionFrequency: 'none', rates: [{ fromMonth: 1, apy: 0.05 }, { fromMonth: 7, apy: 0.04 }] })).toEqual({ p: 1_000_000, r0: '5', cmp: 'daily', y: 5, m1: 7, r1: '4', f: 'none' });
  });

  it('maps a rate-change issue back to the change row it came from', () => {
    expect(savingsIssueMessage({ field: 'rates[1].fromMonth', code: 'above-maximum', limit: 60 }, [3])).toEqual({ field: 'm3', message: 'This month is after the end of the projection.' });
    expect(savingsIssueMessage({ field: 'rates[0].apy', code: 'above-maximum', limit: 1 }, []).field).toBe('r0');
    expect(savingsIssueMessage({ field: 'years', code: 'result-too-large', limit: 31 }, []).message).toContain('by year 31');
  });
});

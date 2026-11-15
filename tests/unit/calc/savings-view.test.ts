import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SAVINGS,
  SAVINGS_ASSUMPTIONS,
  savingsIssueMessage,
  savingsRateChanges,
  savingsSchedule,
  savingsScheduleConfig,
  savingsShareState,
  savingsView,
} from '../../../src/lib/calc/savings-view';
import { scheduleTable } from '../../../src/lib/calc/schedule-view';
import { tableCsv } from '../../../src/lib/report/table';
import { savingsGrowth, type HysaInput } from '../../../src/lib/engines/hysa';

function view(change: Partial<HysaInput> = {}) {
  const input = { ...DEFAULT_SAVINGS, ...change };
  const result = savingsGrowth(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  const schedule = savingsSchedule(input, result.value);
  const config = savingsScheduleConfig(result.value);
  return { input, result: result.value, view: savingsView(input, result.value), table: (g: 'day' | 'month' | 'year') => scheduleTable(schedule, g, config) };
}

describe('savings view', () => {
  it('breaks the final balance into starting balance, deposits and interest that add up', () => {
    const { result, view: v, table } = view();
    const cents = (text: string) => Number(text.replace(/[$,.]/g, ''));
    expect(cents(v.breakdown[0]!.value) + cents(v.breakdown[1]!.value) + cents(v.breakdown[2]!.value)).toBe(result.finalBalance);
    expect(table('year').count).toBe(5);
    expect(table('month').count).toBe(60);
    expect(table('day').count).toBe(5 * 365);
    expect(table('year').row(4).cells[5]).toBe(v.final);
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

  it('states each rate change, marks the month it starts, and shows both APYs in that year', () => {
    const { input, result, table } = view({ rates: [{ fromMonth: 1, apy: 0.05 }, { fromMonth: 13, apy: 0.035 }] });
    expect(savingsRateChanges(input, result)).toEqual([
      'From the start (month 1, Jan, year 1) to month 12 (Dec, year 1): APY 5.00%, interest rate 4.8793%, compounded daily.',
      expect.stringMatching(/^From month 13 \(Jan, year 2\) to month 60 \(Dec, year 5\): APY 3\.50%, interest rate 3\.44\d\d%, compounded daily\.$/),
    ]);
    expect(table('month').row(12).note).toBe('New APY');
    expect(table('month').row(11).note).toBeUndefined();
    expect(table('day').row(365).note).toBe('New APY');
    expect(savingsRateChanges(DEFAULT_SAVINGS, view().result)[0]).toMatch(/^No rate changes: the APY is 4\.50%/);
  });

  it('shows the APY earned for months only, and None for a month with no average balance', () => {
    const empty = view({ principal: 0, years: 1, timing: 'end' }).table('month');
    expect(empty.columns.at(-1)!.label).toBe('APY earned');
    expect(empty.row(0).cells.at(-1)).toBe('None');
    expect(view().table('year').columns.map((c) => c.label)).not.toContain('APY earned');
    expect(view().table('day').columns.map((c) => c.label)).not.toContain('APY earned');
    expect(view({ contributionFrequency: 'none' }).view.summary).toContain('with no regular deposits');
  });

  it('exports one CSV row per month with unformatted numbers', () => {
    const lines = tableCsv(view({ years: 1 }).table('month')).trim().split('\r\n');
    expect(lines[0]).toBe('month,year,month_of_year,days,opening_balance_usd,deposits_usd,interest_accrued_usd,interest_credited_usd,apy_percent,interest_rate_percent,closing_balance_usd,cumulative_interest_usd,apy_earned_percent');
    expect(lines).toHaveLength(13);
    expect(lines[2]).toMatch(/^2,1,2,28,\d+\.\d{2},500\.00,\d+\.\d{6},\d+\.\d{2},4\.50,4\.40\d+,\d+\.\d{2},\d+\.\d{2},4\.\d+$/);
  });

  it('labels the five approved conventions as assumptions', () => {
    const labeled = SAVINGS_ASSUMPTIONS.filter((a) => a.startsWith('Assumption ('));
    expect(labeled.map((a) => a.slice(0, a.indexOf(')') + 1))).toEqual([
      'Assumption (interest rate from the APY)',
      'Assumption (rounding)',
      'Assumption (monthly crediting)',
      'Assumption (calendar)',
      'Assumption (deposit day)',
    ]);
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

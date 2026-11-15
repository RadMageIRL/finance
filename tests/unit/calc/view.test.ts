import { describe, expect, it } from 'vitest';
import { niceTicks, stackedColumnsSvg } from '../../../src/lib/calc/chart';
import { compoundSchedule, compoundScheduleConfig, compoundShareState, compoundView, DEFAULT_INPUT } from '../../../src/lib/calc/compound-view';
import { scheduleTable, scheduleTooltip } from '../../../src/lib/calc/schedule-view';
import { tableCsv } from '../../../src/lib/report/table';
import { contributionHint } from '../../../src/lib/calc/frequency';
import { compoundInterest } from '../../../src/lib/engines/compound';

function example() {
  const result = compoundInterest(DEFAULT_INPUT);
  if (!result.ok) throw new Error('example scenario invalid');
  return result.value;
}

describe('chart ticks', () => {
  it('uses round steps of 1, 2, 2.5 or 5 that cover the maximum', () => {
    expect(niceTicks(3_199_839)).toEqual([0, 1_000_000, 2_000_000, 3_000_000, 4_000_000]);
    expect(niceTicks(95)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(0)).toEqual([0]);
  });
});

describe('stacked column chart', () => {
  const svg = (width?: number) =>
    stackedColumnsSvg({
      categories: ['1', '2', '3'],
      series: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
      values: [[100, 50], [100, 120], [100, 0]],
      formatTick: String,
      formatTotal: (c) => `T${c}`,
      title: 'Title <&>',
      description: 'Desc',
      idPrefix: 't',
      ...(width ? { width } : {}),
    });

  it('draws one hit area per column, no invalid numbers, and escapes its text', () => {
    const s = svg();
    expect(s.match(/class="chart__hit"/g)).toHaveLength(3);
    expect(s).not.toMatch(/NaN|Infinity|undefined/);
    expect(s).toContain('Title &lt;&amp;&gt;');
  });

  it('labels only the final total', () => {
    expect(svg().match(/class="chart__label"/g)).toHaveLength(1);
    expect(svg()).toContain('>T100<');
  });

  it('skips zero segments and rounds only each column top', () => {
    const s = svg();
    expect(s.match(/<path class="chart__seg/g)).toHaveLength(3);
    expect(s.match(/<rect class="chart__seg/g)).toHaveLength(2);
  });

  it('never crowds a regular year label against the final one', () => {
    const labels = (count: number, width: number) =>
      [...stackedColumnsSvg({
        categories: Array.from({ length: count }, (_, i) => String(i + 1)),
        series: [{ key: 'a', label: 'A' }],
        values: Array.from({ length: count }, () => [100]),
        formatTick: () => '',
        formatTotal: String,
        title: 't',
        description: 'd',
        idPrefix: 'x',
        width,
      }).matchAll(/text-anchor="middle">(\d+)</g)].map((m) => Number(m[1]));
    // 10 years on a phone-width chart: labels every other year, and 9 is dropped next to 10.
    expect(labels(10, 340)).toEqual([1, 3, 5, 7, 10]);
    expect(labels(10, 640)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('draws at the requested width, never narrower than 280', () => {
    expect(svg(390)).toContain('viewBox="0 0 390 300"');
    expect(svg(100)).toContain('viewBox="0 0 280 300"');
  });
});

describe('compound interest view', () => {
  it('shows the engine result: breakdown adds up and the yearly schedule ends at the final balance', () => {
    const result = example();
    const view = compoundView(DEFAULT_INPUT, result);
    expect(view.final).toBe('$31,998.39');
    expect(view.breakdown.map((b) => b.value)).toEqual(['$10,000.00', '$12,000.00', '$9,998.39']);
    const schedule = compoundSchedule(DEFAULT_INPUT, result);
    const table = scheduleTable(schedule, 'year', compoundScheduleConfig(DEFAULT_INPUT));
    expect(table.count).toBe(10);
    expect(table.row(9).cells[5]).toBe(view.final);
    expect(table.footer!.cells[5]).toBe(view.final);
    expect(scheduleTooltip(schedule, 'year', DEFAULT_INPUT.principal, 'Contributions', 9)[0]).toBe('Year 10: $31,998.39');
  });

  it('exports the yearly schedule as CSV matching the engine to the cent', () => {
    const result = example();
    const schedule = compoundSchedule(DEFAULT_INPUT, result);
    const lines = tableCsv(scheduleTable(schedule, 'year', compoundScheduleConfig(DEFAULT_INPUT))).trim().split(/\r\n/);
    expect(lines[0]).toBe('year,days,opening_balance_usd,contributions_usd,interest_accrued_usd,interest_credited_usd,annual_rate_percent,closing_balance_usd,cumulative_interest_usd');
    const y = result.years[9]!;
    const fields = lines[10]!.split(',');
    expect(fields).toHaveLength(9);
    expect(fields.slice(0, 4)).toEqual(['10', '365', (y.startBalance / 100).toFixed(2), '1200.00']);
    expect(fields[4]).toMatch(/^\d+\.\d{6}$/);
    expect(fields.slice(5)).toEqual([(y.interest / 100).toFixed(2), '5.0000000000', '31998.39', '9998.39']);
  });
});

describe('compound interest view: contribution wording', () => {
  const view = (change: Partial<typeof DEFAULT_INPUT>) => {
    const input = { ...DEFAULT_INPUT, ...change };
    const result = compoundInterest(input);
    if (!result.ok) throw new Error('scenario invalid');
    return compoundView(input, result.value);
  };

  it('states the contribution schedule and count in the summary', () => {
    expect(view({ years: 1, contributionFrequency: 'weekly', timing: 'start' }).summary).toContain('$100.00 a week at the start of each week, 53 contributions');
    expect(view({}).summary).toContain('$100.00 a month at the end of each month, 120 contributions');
  });

  it('says there are no regular contributions when the frequency is none', () => {
    const s = view({ contributionFrequency: 'none' }).summary;
    expect(s).toContain('with no regular contributions');
    expect(s).not.toContain('in contributions');
  });

  it('hints how often and when a contribution is added', () => {
    expect(contributionHint('biweekly', 'end')).toBe('Added every 2 weeks, at the end of each 2-week period.');
    expect(contributionHint('quarterly', 'start')).toBe('Added once a quarter, at the start of each quarter.');
    expect(contributionHint('none', 'end')).toBe('No regular contributions.');
  });

  it('leaves the contribution and timing out of the share state when there are none', () => {
    expect(compoundShareState({ ...DEFAULT_INPUT, contributionFrequency: 'none' })).toEqual({ p: 1_000_000, r: '5', n: '12', y: 10, f: 'none' });
    expect(compoundShareState(DEFAULT_INPUT)).toEqual({ p: 1_000_000, r: '5', n: '12', y: 10, f: 'monthly', c: 10_000, t: 'end' });
  });
});

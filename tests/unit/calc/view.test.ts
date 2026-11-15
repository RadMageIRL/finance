import { describe, expect, it } from 'vitest';
import { niceTicks, stackedColumnsSvg } from '../../../src/lib/calc/chart';
import { compoundCsv, compoundView, DEFAULT_INPUT } from '../../../src/lib/calc/compound-view';
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

  it('draws at the requested width, never narrower than 280', () => {
    expect(svg(390)).toContain('viewBox="0 0 390 300"');
    expect(svg(100)).toContain('viewBox="0 0 280 300"');
  });
});

describe('compound interest view', () => {
  it('shows the engine result: breakdown adds up and the table ends at the final balance', () => {
    const result = example();
    const view = compoundView(DEFAULT_INPUT, result);
    expect(view.final).toBe('$31,998.39');
    expect(view.breakdown.map((b) => b.value)).toEqual(['$10,000.00', '$12,000.00', '$9,998.39']);
    expect(view.rows).toHaveLength(10);
    expect(view.rows.at(-1)!.end).toBe(view.final);
    expect(view.tooltips[9]![0]).toBe('Year 10: $31,998.39');
  });

  it('exports the yearly table as CSV matching the engine to the cent', () => {
    const result = example();
    const lines = compoundCsv(result).trim().split('\r\n');
    expect(lines[0]).toBe('year,start_balance_usd,contributions_usd,interest_usd,end_balance_usd');
    expect(lines[10]).toBe(`10,${(result.years[9]!.startBalance / 100).toFixed(2)},1200.00,${(result.years[9]!.interest / 100).toFixed(2)},31998.39`);
  });
});

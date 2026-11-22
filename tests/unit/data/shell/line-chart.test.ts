// The dashboard line chart (src/lib/data/line-chart.ts) beyond the oracle cases: the SVG it
// draws (gaps, markers, steps and bands to the right edge, dash classes, no inline styles), its
// size on a long series, the reading data round trip and the period labels it picks per width.
import { describe, expect, it } from 'vitest';
import { DRAW_COLUMNS, PLOT_W, READ_COLUMNS, dayNumber, decodeChartData, encodeChartData, monthNumber, periodLabels, relativePath, renderChart, valueAxis } from '../../../../src/lib/data/line-chart';
import type { ChartSpec } from '../../../../src/lib/data/ui';

const day = (n: number) => {
  const d = new Date(Date.UTC(2000, 0, 3) + n * 86_400_000);
  return d.toISOString().slice(0, 10);
};

/** Test inputs only: a deterministic walk in hundredths over consecutive days. */
function walk(count: number): { x: string; y: string | null }[] {
  let v = 500;
  let state = 7;
  return Array.from({ length: count }, (_, i) => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    v += (state % 19) - 9;
    const abs = Math.abs(v);
    return { x: day(i), y: `${v < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}` };
  });
}

const pathOf = (svg: string, cls: string): string[] => [...svg.matchAll(new RegExp(`<path class="${cls}[^"]*" d="([^"]*)"`, 'g'))].map((m) => m[1]!);

const base: ChartSpec = { id: 't', title: 'Test', unitLabel: 'Percent', periodKind: 'day', lines: [] };

describe('drawing', () => {
  it('breaks a line at a null point and draws a lone point as a marker', () => {
    const r = renderChart({
      ...base,
      lines: [{ key: 'a', label: 'A', shape: 'line', kind: 'observed', points: [{ x: '2026-01-05', y: '1.00' }, { x: '2026-01-06', y: '1.10' }, { x: '2026-01-07', y: null }, { x: '2026-01-08', y: '1.20' }, { x: '2026-01-09', y: null }, { x: '2026-01-12', y: '1.30' }, { x: '2026-01-13', y: '1.40' }] }],
    });
    const [line] = pathOf(r.plotSvg, 'dchart__line');
    expect(line!.match(/M/g)).toHaveLength(2);
    const [dots] = pathOf(r.plotSvg, 'dchart__dot dchart__dot--1');
    expect(dots).toMatch(/^M[\d.]+,[\d.]+h0$/);
    expect(r.drawn).toBe(5);
  });

  it('holds a step and a band to the right edge, and ends a step at its null point', () => {
    const r = renderChart({
      ...base,
      lines: [
        { key: 'm', label: 'Market', shape: 'line', kind: 'observed', points: [{ x: '2008-12-01', y: '1.00' }, { x: '2008-12-31', y: '0.10' }] },
        { key: 't', label: 'Target', shape: 'step', kind: 'derived', points: [{ x: '2008-12-01', y: '1.00' }, { x: '2008-12-16', y: null }] },
      ],
      bands: [{ key: 'r', label: 'Range', kind: 'derived', points: [{ x: '2008-12-16', lower: '0.00', upper: '0.25' }] }],
    });
    const [step] = pathOf(r.plotSvg, 'dchart__line dchart__line--2');
    // From the left edge to the null point at 2008-12-16 (15 of 30 days), never beyond.
    expect(step).toBe('M0,0H500');
    const edges = pathOf(r.plotSvg, 'dchart__edge');
    expect(edges).toHaveLength(2);
    for (const e of edges) expect(e.endsWith(`L${PLOT_W},${e.split(',').at(-1)}`)).toBe(true);
    expect(r.plotSvg).toContain('class="dchart__line dchart__line--2 is-derived"');
    expect(r.plotSvg).toContain('class="dchart__line dchart__line--1 is-observed is-observed-1"');
  });

  it('holds the last value of a step line to the right edge', () => {
    const r = renderChart({
      ...base,
      lines: [
        { key: 'm', label: 'Market', shape: 'line', kind: 'observed', points: [{ x: '2026-01-01', y: '2.00' }, { x: '2026-01-11', y: '1.50' }] },
        { key: 't', label: 'Target', shape: 'step', kind: 'derived', points: [{ x: '2026-01-01', y: '2.00' }, { x: '2026-01-06', y: '1.00' }] },
      ],
    });
    expect(pathOf(r.plotSvg, 'dchart__line dchart__line--2')).toEqual(['M0,0H500V120H1000']);
  });

  it('dashes a second and third observed line differently and never uses an inline style', () => {
    const pts = [{ x: '2026-01', y: '1' }, { x: '2026-02', y: '2' }];
    const r = renderChart({
      ...base,
      periodKind: 'month',
      lines: ['a', 'b', 'c', 'd'].map((k) => ({ key: k, label: k.toUpperCase(), shape: 'line' as const, kind: 'observed' as const, points: pts })),
    });
    expect(r.plotSvg).toContain('dchart__line--2 is-observed is-observed-2');
    expect(r.plotSvg).toContain('dchart__line--3 is-observed is-observed-3');
    // A fourth line keeps the third color and dash: the palette is never cycled.
    expect(r.plotSvg.match(/dchart__line--3 is-observed is-observed-3/g)).toHaveLength(2);
    for (const part of [r.plotSvg, r.wideAxisSvg, r.narrowAxisSvg]) {
      expect(part).not.toMatch(/\sstyle=/);
      expect(part).not.toMatch(/<script/);
    }
  });

  it('escapes the title and labels it writes into the SVG', () => {
    const r = renderChart({ ...base, title: 'A <b> & "c"', lines: [{ key: 'a', label: 'L<1>', shape: 'line', kind: 'observed', points: [{ x: '2026-01-05', y: '1' }] }] });
    expect(r.plotSvg).toContain('A &lt;b&gt; &amp; &quot;c&quot;');
    expect(r.plotSvg).toContain('L&lt;1&gt; (observed)');
    expect(r.plotSvg).not.toContain('<b>');
  });

  it('draws nothing but says so when no value is given', () => {
    const r = renderChart({ ...base, lines: [{ key: 'a', label: 'A', shape: 'line', kind: 'observed', points: [{ x: '2026-01-05', y: null }] }] });
    expect(r.hasData).toBe(false);
    expect(r.description).toBe('A (observed): no values in this range.');
  });
});

describe('screen resolution', () => {
  it('keeps a long series within two points per drawing column and the reading data within its columns', () => {
    const points = walk(6600);
    const r = renderChart({ ...base, lines: [{ key: 'a', label: 'Walk', shape: 'line', kind: 'observed', points }] });
    expect(r.given).toBe(6600);
    expect(r.drawn).toBeLessThanOrEqual(2 * DRAW_COLUMNS + 2);
    expect(r.drawn).toBeGreaterThan(DRAW_COLUMNS);
    expect(r.readable).toBeLessThanOrEqual(2 * READ_COLUMNS + 2);
    // The page weight stays small: the drawing and the reading data together.
    expect(r.plotSvg.length + r.data.length).toBeLessThan(16_000);
    // The lowest and highest values of the whole series are drawn and readable.
    const values = points.map((p) => Number(p.y));
    const lo = points[values.indexOf(Math.min(...values))]!;
    const hi = points[values.indexOf(Math.max(...values))]!;
    const d = decodeChartData(r.data, ['Walk'], 'Percent');
    for (const p of [lo, hi]) expect(d.nav).toContain(dayNumber(p.x));
    // The first and the latest value are always readable, so Home and End reach them.
    expect(d.nav[0]).toBe(dayNumber(points[0]!.x));
    expect(d.nav.at(-1)).toBe(dayNumber(points.at(-1)!.x));
  });

  it('keeps every point of a short range readable', () => {
    const points = walk(240);
    const r = renderChart({ ...base, lines: [{ key: 'a', label: 'Walk', shape: 'line', kind: 'observed', points }] });
    expect(r.drawn).toBe(240);
    expect(r.readable).toBe(240);
  });

  it('writes relative path data that never drifts from the rounded positions', () => {
    const pts: [number, number][] = [
      [0.04, 10.06],
      [1.26, 9.94],
      [2.55, 10.05],
      [999.96, 0.04],
    ];
    const d = relativePath(pts);
    expect(d).toBe('M0,10.1l1.3,-.2l1.3,.2l997.4,-10.1');
    let x = 0;
    let y = 0;
    for (const m of d.matchAll(/[Ml](-?[\d.]+),(-?[\d.]+)/g)) {
      x += Number(m[1]);
      y += Number(m[2]);
    }
    expect([Math.round(x * 10) / 10, Math.round(y * 10) / 10]).toEqual([1000, 0]);
  });
});

describe('reading data and labels', () => {
  it('round-trips the encoded reading data', () => {
    const data = { kind: 'day' as const, first: 100, last: 110, unitLabel: 'Percent', nav: [100, 104, 110], series: [{ type: 'line' as const, kind: 'observed' as const, label: 'A', values: ['1.5', null, undefined] }, { type: 'step' as const, kind: 'derived' as const, label: 'B', points: [{ at: 100, y: '2' }, { at: 105, y: null }] }, { type: 'band' as const, kind: 'derived' as const, label: 'C', points: [{ at: 105, lower: '0.00', upper: '0.25' }] }] };
    const text = encodeChartData(data);
    expect(text).toBe('day,100,110;0,4,6;Lo1.5,~,;Sd0:2,5:~;Bd5:0.00:0.25');
    expect(decodeChartData(text, ['A', 'B', 'C'], 'Percent')).toEqual(data);
  });

  it('labels a decade of years one by one on wide plots and every other year on narrow ones', () => {
    const r = renderChart({ ...base, periodKind: 'month', lines: [{ key: 'a', label: 'A', shape: 'line', kind: 'observed', points: [{ x: '2017-01', y: '1' }, { x: '2026-10', y: '2' }] }] });
    const texts = (svg: string) => [...svg.matchAll(/>(\d{4})<\/text>/g)].map((m) => m[1]);
    expect(texts(r.wideAxisSvg)).toEqual(['2018', '2020', '2022', '2024', '2026']);
    expect(texts(r.narrowAxisSvg)).toEqual(['2020', '2025']);
    expect(periodLabels('month', monthNumber('2017-01'), monthNumber('2026-10'), 10).map((l) => l.text)).toEqual(['2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026']);
  });

  it('throws on a period that is not a date and on a value that is not a decimal', () => {
    expect(() => dayNumber('2026-02-30')).toThrow();
    expect(() => renderChart({ ...base, lines: [{ key: 'a', label: 'A', shape: 'line', kind: 'observed', points: [{ x: '2026-13-01', y: '1' }] }] })).toThrow();
    expect(() => valueAxis(['1e3'], 'Percent')).toThrow();
  });
});

// The shared read-only interface to a v0.8 dataset (src/lib/data/econ.ts, econ-load.ts), on the
// appendix B fixture root written fresh by the fixture scenario.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changePoints, csvFields, observations, parseSegmentCsv, revisionRows, segmentComments, seriesInfo, valueColumn } from '../../../src/lib/data/econ';
import { loadEconDataset } from '../../../src/lib/data/econ-load';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
// The pipeline comes from finance-data (ECON_TOOLS) or this tree (tools/econ-tools.mjs; brief V item 3).
import { importEconTool } from '../../../tools/econ-tools.mjs';
const { runScenario } = (await importEconTool('pipeline/bin/fixture-scenario.mjs')) as Loose;

let work = '';
let live = '';
beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'rmf-econ-'));
  await runScenario(work);
  live = join(work, 'live');
}, 600_000);
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('CSV parsing', () => {
  it('splits quoted fields with doubled quotes and empty cells', () => {
    expect(csvFields('a,"[""r""]",,3.88')).toEqual(['a', '["r"]', '', '3.88']);
    expect(csvFields('')).toEqual(['']);
  });
  it('separates comment lines, header and rows, and throws on a malformed file', () => {
    expect(parseSegmentCsv('# t\n# u\nperiod,value_percent\n2026-01-02,3.64\n')).toEqual({ comments: ['t', 'u'], header: ['period', 'value_percent'], rows: [{ period: '2026-01-02', value_percent: '3.64' }] });
    expect(() => parseSegmentCsv('period,value\n1,2')).toThrow(/newline/);
    expect(() => parseSegmentCsv('# only\n')).toThrow(/header/);
    expect(() => parseSegmentCsv('a,b\n1\n')).toThrow(/fields/);
  });
});

describe('the dataset', () => {
  it('is null without ECON_DIR, and labels anything but a release as fixture data', () => {
    expect(loadEconDataset(undefined, undefined)).toBeNull();
    expect(loadEconDataset(live, undefined)?.source).toBe('fixture');
    expect(loadEconDataset(live, 'release')?.source).toBe('release');
  });
  it('reads every series as decimal strings, oldest first, from the files the manifest names', () => {
    const ds = loadEconDataset(live, undefined)!;
    expect(Object.keys(ds.manifest.series).sort()).toEqual(['debt-held-public', 'debt-intragov', 'debt-total', 'effr', 'fomc-target', 'm1-nsa', 'm1-sa', 'm2-nsa', 'm2-sa']);
    for (const id of ['effr', 'debt-total', 'debt-held-public', 'debt-intragov', 'm1-sa', 'm2-sa', 'm1-nsa', 'm2-nsa']) {
      const obs = observations(ds, id);
      expect(obs.length).toBeGreaterThan(0);
      const periods = obs.map((o) => o.period);
      expect(periods).toEqual([...periods].sort());
      expect(new Set(periods).size).toBe(periods.length);
      expect(periods.at(-1)).toBe(seriesInfo(ds, id).last_period);
      for (const o of obs) if (o.value !== null) expect(o.value).toMatch(/^-?\d+(\.\d+)?$/);
    }
    expect(valueColumn(ds, 'effr')).toBe('value_percent');
    expect(valueColumn(ds, 'm2-sa')).toBe('value_usd_billions');
    expect(valueColumn(ds, 'debt-total')).toBe('value_usd');
    const cps = changePoints(ds);
    expect(cps.some((c) => c.kind === 'rate' && c.value !== null && c.lower === null)).toBe(true);
    expect(cps.some((c) => c.kind === 'range' && c.value === null && c.lower !== null && c.upper !== null)).toBe(true);
    expect(revisionRows(ds, 'effr').length).toBeGreaterThan(0);
    expect(segmentComments(ds, 'fomc-target').some((c) => c.startsWith('Derived by RadMage Finance'))).toBe(true);
  });
  it('throws on a file whose SHA-256 differs from the manifest, and on a path the manifest does not name', () => {
    const copy = join(work, 'tampered');
    cpSync(live, copy, { recursive: true });
    const ds = loadEconDataset(copy, undefined)!;
    const path = seriesInfo(ds, 'effr').csvs[0]?.path ?? '';
    writeFileSync(join(copy, path), readFileSync(join(copy, path), 'utf8').replace(/\n$/, '\n\n'));
    expect(() => observations(ds, 'effr')).toThrow(/SHA-256/);
    expect(() => ds.readText('../manifest.json')).toThrow(/does not name/);
  });
});

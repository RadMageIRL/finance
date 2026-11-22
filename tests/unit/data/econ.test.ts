// The shared read-only interface to a v0.8 dataset (src/lib/data/econ.ts, econ-load.ts), on the
// appendix B fixture root written fresh by the fixture scenario.
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changePoints, csvFields, observations, parseSegmentCsv, revisionRows, segmentComments, seriesInfo, termsUrl, valueColumn } from '../../../src/lib/data/econ';
import { COMPAT_DATASET, compatManifest, loadEconDataset } from '../../../src/lib/data/econ-load';
import * as compatTool from '../../../tools/econ-compat.mjs';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
// The pipeline comes from finance-data (ECON_TOOLS) or this tree (tools/econ-tools.mjs; brief V item 3).
import { econToolsPath, importEconTool } from '../../../tools/econ-tools.mjs';
const { runScenario } = (await importEconTool('pipeline/bin/fixture-scenario.mjs')) as Loose;
const { compatSupplement, COMPAT_DATASET: TOOL_COMPAT } = compatTool as unknown as Loose;

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

// DATA_CONVENTIONS v0.8 amendment 1 (22.2, 22.8; owner authorization P107): the one manifest/3
// dataset the site accepts, with the build supplement of tools/econ-compat.mjs. The real dataset
// cannot be forged (its SHA-256 pins it), so these tests turn the fixture's manifest/4 into a
// manifest/3 and pass its own identity as the pinned one; production stays bound to the constant.
describe('the dataset of amendment 1 (a manifest/3 published unchanged)', () => {
  const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
  const asV3 = () => {
    const m4 = JSON.parse(readFileSync(join(live, 'manifest.json'), 'utf8')) as Loose;
    const m3: Loose = { ...m4, schema: 'rmf.econ.manifest/3' };
    delete m3.rules;
    m3.series = Object.fromEntries(Object.entries(m4.series as Loose).map(([id, s]) => {
      const { deadline: _d, stale_at: _s, revision_csvs: _r, ...rest } = s as Loose;
      return [id, rest];
    }));
    const text = JSON.stringify(m3);
    return { m4, m3, text, pinned: { snapshot: m3.snapshot.id as string, manifest_sha256: sha(text) } };
  };
  const tools = async () => ({
    canonicalJson: ((await importEconTool('pipeline/lib/canonical.mjs')) as Loose).canonicalJson,
    registryVersions: ((await importEconTool('pipeline/lib/rules.mjs')) as Loose).registryVersions,
    deadlines: ((await importEconTool('pipeline/lib/tree.mjs')) as Loose).deadlines,
    makeCalendar: ((await importEconTool('pipeline/lib/calendar.mjs')) as Loose).makeCalendar,
  });
  const snapshotsOf = (dir: string) => new Map(readdirSync(join(dir, 'snapshots')).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(dir, 'snapshots', f), 'utf8'))]));
  const registry = () => JSON.parse(readFileSync(econToolsPath('pipeline', 'registry', 'econ.json'), 'utf8')) as Loose;
  const holidays = () => JSON.parse(readFileSync(econToolsPath('pipeline', 'registry', registry().holiday_table), 'utf8')) as Loose;
  const supplementFor = async (text: string, pinned?: Loose, snapshots = snapshotsOf(live)) => compatSupplement({ manifestBytes: Buffer.from(text), snapshots, registry: registry(), holidays: holidays(), tools: await tools(), ...(pinned ? { pinned } : {}) });

  it('names the same dataset in the site, the build tool and the pipeline', async () => {
    expect(COMPAT_DATASET).toEqual({ snapshot: '20261121T001752Z', manifest_sha256: '180a1991a56582e8a03813efa556d2695b3f28f7e415b763b06e499e57c1188d' });
    expect(TOOL_COMPAT).toEqual(COMPAT_DATASET);
    expect(((await importEconTool('pipeline/bin/publish.mjs')) as Loose).COMPAT_DATASET).toEqual(COMPAT_DATASET);
  });

  it('the build supplement gives exactly the deadline and stale_at a manifest/4 writer gives, and the registry', async () => {
    const { m4, text, pinned } = asV3();
    const sup = await supplementFor(text, pinned);
    for (const [id, s] of Object.entries(m4.series as Loose)) expect(sup.series[id]).toEqual({ deadline: (s as Loose).deadline, stale_at: (s as Loose).stale_at });
    expect(sha(sup.registry.text)).toBe(sup.registry.sha256);
    expect(sup.registry.sha256).toBe(m4.rules.registry.sha256);
    expect(sup.dataset).toEqual(pinned);
    // Any other manifest/3, and a manifest/4, is refused.
    await expect(supplementFor(text)).rejects.toThrow(/accepted only for the dataset of amendment 1/);
    await expect(supplementFor(JSON.stringify(m4), pinned)).rejects.toThrow(/is rmf.econ.manifest.4, not/);
    // A window snapshot whose registry is not an I7 version of the checkout's is refused.
    const snaps = snapshotsOf(live);
    const [firstId, first] = [...snaps][0]!;
    snaps.set(firstId, { ...first, run: { ...first.run, registry_sha256: 'f'.repeat(64) } });
    await expect(supplementFor(text, pinned, snaps)).rejects.toThrow(/not a version of the checkout/);
  });

  it('the loader accepts that manifest/3 only with its supplement, and takes the terms address from the registry', async () => {
    const { m3, text, pinned } = asV3();
    const sup = await supplementFor(text, pinned);
    const { manifest, compat } = compatManifest(m3 as never, pinned.manifest_sha256, sup, pinned);
    expect(manifest.schema).toBe('rmf.econ.manifest/3');
    expect(manifest.rules).toBeNull();
    for (const id of Object.keys(m3.series)) {
      expect(manifest.series[id]!.deadline).toBe(sup.series[id].deadline);
      expect(manifest.series[id]!.stale_at).toBe(sup.series[id].stale_at);
      expect(manifest.series[id]!.revision_csvs).toEqual([]);
    }
    expect(compat.registryText).toBe(sup.registry.text);
    // The default pin is the real dataset: this manifest/3 is not it.
    expect(() => compatManifest(m3 as never, pinned.manifest_sha256, sup)).toThrow(/accepted only for the dataset of amendment 1/);
    expect(() => compatManifest(m3 as never, pinned.manifest_sha256, null, pinned)).toThrow(/needs the build supplement/);
    expect(() => compatManifest(m3 as never, pinned.manifest_sha256, { ...sup, dataset: COMPAT_DATASET }, pinned)).toThrow(/another dataset/);
    expect(() => compatManifest(m3 as never, pinned.manifest_sha256, { ...sup, schema: 'x' }, pinned)).toThrow(/schema/);
    expect(() => compatManifest(m3 as never, pinned.manifest_sha256, { ...sup, registry: { ...sup.registry, text: `${sup.registry.text} ` } }, pinned)).toThrow(/SHA-256/);
    expect(() => compatManifest(m3 as never, pinned.manifest_sha256, { ...sup, series: { ...sup.series, effr: { deadline: 'soon', stale_at: null } } }, pinned)).toThrow(/stored UTC times/);
    const { effr: _e, ...fewer } = sup.series;
    expect(() => compatManifest(m3 as never, pinned.manifest_sha256, { ...sup, series: fewer }, pinned)).toThrow(/exactly the manifest/);
    // Through the loader, the real pin refuses this manifest/3, with or without a supplement.
    const dir = join(work, 'as-v3');
    cpSync(live, dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), text);
    const supFile = join(work, 'compat.json');
    writeFileSync(supFile, JSON.stringify(sup));
    expect(() => loadEconDataset(dir, 'release', supFile)).toThrow(/accepted only for the dataset of amendment 1/);
    expect(() => loadEconDataset(dir, 'fixture', undefined)).toThrow(/accepted only for the dataset of amendment 1/);
    // A manifest/4 never takes the supplement, and its terms come from the CSV comments.
    const ds4 = loadEconDataset(live, 'release', supFile)!;
    expect(ds4.compat).toBeUndefined();
    expect(termsUrl(ds4, 'effr')).toBe(segmentComments(ds4, 'effr').find((c) => c.startsWith('Terms: '))!.slice('Terms: '.length));
    // With the supplement, the registry's terms address, per source.
    const ds3 = { ...ds4, manifest, compat };
    const reg = registry();
    for (const s of reg.series as Loose[]) expect(termsUrl(ds3, s.id)).toBe(reg.sources[s.source].terms_url);
    expect(termsUrl(ds3, 'effr')).toBe('https://www.newyorkfed.org/privacy/termsofuse');
    expect(() => termsUrl(ds3, 'no-such-series')).toThrow(/no terms address/);
  });
});

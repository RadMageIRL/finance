#!/usr/bin/env node
// The site build's supplement for the one manifest/3 dataset the site accepts (DATA_CONVENTIONS
// v0.8 amendment 1, 22.2 and 22.8; owner authorization P107).
//
//   node tools/econ-compat.mjs <econ dir> <supplement file outside dist>
//
// The site's pages read four manifest/4 fields (section 9): `deadline`, `stale_at`,
// `revision_csvs` and `rules`. The dataset of amendment 1 is a manifest/3, published unchanged,
// so it has none of them. For that dataset alone, identified by its snapshot id and the SHA-256 of
// its manifest bytes together, this writes what the pages need, from the finance-data checkout the
// build already uses (ECON_TOOLS, tools/econ-tools.mjs):
// - the registry: the checkout's registry as canonical JSON, refused unless the registry hash
//   that every window snapshot records is a version of it under appendix I row I7;
// - each series' `deadline` and `stale_at`: computed from the published snapshot, the registry and
//   the checkout's holiday table by the pipeline's own `deadlines` (pipeline/lib/tree.mjs), as
//   `buildManifest` writes them into a manifest/4 (9, 14.2, D7);
// The supplement goes to a file outside dist/ and is never deployed; dist/data/econ/ stays the
// release's tree, byte for byte. For a manifest/4 it writes nothing (no supplement is needed).
// Any other manifest/3, or a check that fails, exits 1.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { econToolsPath, importEconTool } from './econ-tools.mjs';

/** Equal to COMPAT_DATASET of src/lib/data/econ-load.ts and finance-data pipeline/bin/publish.mjs. */
export const COMPAT_DATASET = Object.freeze({ snapshot: '20261121T001752Z', manifest_sha256: '180a1991a56582e8a03813efa556d2695b3f28f7e415b763b06e499e57c1188d' });
export const COMPAT_SCHEMA = 'rmf.site.econ-compat/1';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The supplement. o: { manifestBytes, snapshots (Map id -> parsed window snapshot), registry,
 * holidays, tools: { canonicalJson, registryVersions, deadlines, makeCalendar }, pinned }.
 * Returns the supplement object, or throws with the refusal.
 */
export function compatSupplement({ manifestBytes, snapshots, registry, holidays, tools, pinned = COMPAT_DATASET }) {
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  const manifestSha = sha256(manifestBytes);
  if (manifest.schema !== 'rmf.econ.manifest/3') throw new Error(`the manifest is ${manifest.schema}, not rmf.econ.manifest/3`);
  if (manifest.snapshot?.id !== pinned.snapshot || manifestSha !== pinned.manifest_sha256) throw new Error(`a manifest/3 is accepted only for the dataset of amendment 1 (${pinned.snapshot}:${pinned.manifest_sha256}), not ${manifest.snapshot?.id}:${manifestSha}`);
  const snapshot = snapshots.get(manifest.snapshot.id);
  if (!snapshot) throw new Error(`the manifest's snapshot ${manifest.snapshot.id} is not in the tree`);
  // I7: every window snapshot's registry is a version of the checkout's registry.
  const versions = tools.registryVersions(registry);
  const known = new Map(versions.map((v) => [v.sha256, v.version]));
  const named = {};
  for (const [id, snap] of [...snapshots].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const h = snap.run?.registry_sha256;
    if (!known.has(h)) throw new Error(`the window snapshot ${id} records the registry ${h}, which is not a version of the checkout's registry under I7`);
    named[id] = { registry_sha256: h, version: known.get(h) };
  }
  const ids = registry.series.map((s) => s.id).sort();
  if (JSON.stringify(Object.keys(manifest.series).sort()) !== JSON.stringify(ids)) throw new Error("the manifest's series are not the registry's");
  // 9, D7: exactly as buildManifest gives `deadline` and `stale_at` for a manifest/4.
  const calendar = tools.makeCalendar(holidays);
  const times = {};
  for (const s of registry.series) {
    const st = snapshot.series[s.id];
    if (st.status !== 'not-yet-published') times[s.id] = tools.deadlines(s, st, registry, calendar);
  }
  const series = {};
  for (const s of registry.series) {
    const st = snapshot.series[s.id];
    const own = st.status === 'not-yet-published' ? null : (times[s.id] ?? null);
    const followed = s.staleness.follows !== undefined ? (times[s.staleness.follows] ?? null) : own;
    series[s.id] = { deadline: own?.deadline ?? null, stale_at: st.status === 'not-yet-published' ? null : (followed?.staleAt ?? null) };
  }
  const text = versions[0].text;
  return {
    schema: COMPAT_SCHEMA,
    note: 'The build supplement for the dataset of DATA_CONVENTIONS v0.8 amendment 1 (22.2, 22.8): a manifest/3 published unchanged, without rule files. Never deployed.',
    dataset: { snapshot: manifest.snapshot.id, manifest_sha256: manifestSha },
    registry: { sha256: sha256(text), version: versions[0].version, text },
    holidays_sha256: sha256(tools.canonicalJson(holidays)),
    window_registries: named,
    series,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) {
    console.error('usage: node tools/econ-compat.mjs <econ dir> <supplement file outside dist>');
    process.exit(2);
  }
  try {
    if (resolve(out).startsWith(resolve('dist'))) throw new Error('the supplement must lie outside dist/');
    const manifestBytes = readFileSync(join(dir, 'manifest.json'));
    const schema = JSON.parse(manifestBytes.toString('utf8')).schema;
    if (schema === 'rmf.econ.manifest/4') {
      console.log('econ compat: manifest/4, no supplement needed');
      process.exit(0);
    }
    const snapshots = new Map();
    const sdir = join(dir, 'snapshots');
    for (const f of existsSync(sdir) ? readdirSync(sdir).sort() : []) {
      if (!/^\d{8}T\d{6}Z\.json$/.test(f)) throw new Error(`snapshots/${f} is not a snapshot file name`);
      snapshots.set(f.slice(0, -5), JSON.parse(readFileSync(join(sdir, f), 'utf8')));
    }
    const registry = JSON.parse(readFileSync(econToolsPath('pipeline', 'registry', 'econ.json'), 'utf8'));
    const holidays = JSON.parse(readFileSync(econToolsPath('pipeline', 'registry', registry.holiday_table), 'utf8'));
    const { canonicalJson } = await importEconTool('pipeline/lib/canonical.mjs');
    const { registryVersions } = await importEconTool('pipeline/lib/rules.mjs');
    const { deadlines } = await importEconTool('pipeline/lib/tree.mjs');
    const { makeCalendar } = await importEconTool('pipeline/lib/calendar.mjs');
    const sup = compatSupplement({ manifestBytes, snapshots, registry, holidays, tools: { canonicalJson, registryVersions, deadlines, makeCalendar } });
    writeFileSync(out, `${JSON.stringify(sup, null, 2)}\n`);
    console.log(`econ compat: supplement for ${sup.dataset.snapshot} (manifest/3, amendment 1) written to ${out}; registry ${sup.registry.version} ${sup.registry.sha256.slice(0, 16)}`);
    for (const [id, t] of Object.entries(sup.series)) console.log(`  ${id}: deadline ${t.deadline}, stale_at ${t.stale_at}`);
  } catch (e) {
    console.error(`econ compat: refused: ${e.message}`);
    process.exit(1);
  }
}

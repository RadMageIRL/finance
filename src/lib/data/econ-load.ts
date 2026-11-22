// Build-time loader for a v0.8 economic dataset (DATA_CONVENTIONS v0.8; design P28 8.8, decision
// D11). It reads `ECON_DIR` (an econ root: manifest.json and the files it names) and verifies the
// SHA-256 of every segment it reads against the manifest, failing on any mismatch. Without
// `ECON_DIR` there is no dataset and pages show their unavailable state. `ECON_SOURCE=release` is
// set only by the site build for a verified release; anything else is the appendix B fixture
// root, which is test data and never a publication (pages label it as such).
//
// Local builds and tests use fixture data only: `node tools/econ-fixture.mjs` writes it.
//
// SHARED FILE (brief Q): owned by the integrator; dashboard agents read it and never change it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import type { CompatInfo, EconDataset, Manifest } from './econ';

const cache = new Map<string, EconDataset>();

const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * The one manifest/3 dataset the site accepts (DATA_CONVENTIONS v0.8 amendment 1, 22.2 and 22.8;
 * owner authorization P107): both values together identify it. Equal to `COMPAT_DATASET` of
 * finance-data `pipeline/bin/publish.mjs` and of `tools/econ-compat.mjs` (a unit test holds them equal).
 */
export const COMPAT_DATASET = Object.freeze({ snapshot: '20261121T001752Z', manifest_sha256: '180a1991a56582e8a03813efa556d2695b3f28f7e415b763b06e499e57c1188d' });
export const COMPAT_SCHEMA = 'rmf.site.econ-compat/1';

const isTimeOrNull = (v: unknown) => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v));

/**
 * The manifest/3 of the dataset of amendment 1 with the manifest/4 fields its pages read, from
 * the build's supplement (`tools/econ-compat.mjs`, outside dist, never deployed): each series'
 * `deadline` and `stale_at`, `revision_csvs` empty (none was published) and `rules` null (no rule
 * files were published); and the registry text. Throws for any other manifest/3, a supplement for
 * another dataset, or a damaged one. The published files are not changed; only this in-memory view.
 */
export function compatManifest(manifest: Manifest, manifestSha256: string, supplement: unknown, pinned: { snapshot: string; manifest_sha256: string } = COMPAT_DATASET): { manifest: Manifest; compat: CompatInfo } {
  if (manifest.schema !== 'rmf.econ.manifest/3') throw new Error(`manifest schema ${manifest.schema} is not rmf.econ.manifest/3`);
  if (manifest.snapshot?.id !== pinned.snapshot || manifestSha256 !== pinned.manifest_sha256) throw new Error(`a manifest/3 is accepted only for the dataset of amendment 1 (${pinned.snapshot}:${pinned.manifest_sha256}), not ${manifest.snapshot?.id}:${manifestSha256}`);
  if (supplement === null || supplement === undefined) throw new Error('the dataset of amendment 1 needs the build supplement (ECON_COMPAT, tools/econ-compat.mjs)');
  const s = supplement as { schema?: unknown; dataset?: { snapshot?: unknown; manifest_sha256?: unknown }; registry?: { sha256?: unknown; text?: unknown }; series?: Record<string, { deadline?: unknown; stale_at?: unknown }> };
  if (s.schema !== COMPAT_SCHEMA) throw new Error(`the supplement's schema ${String(s.schema)} is not ${COMPAT_SCHEMA}`);
  if (s.dataset?.snapshot !== pinned.snapshot || s.dataset?.manifest_sha256 !== pinned.manifest_sha256) throw new Error('the supplement is for another dataset');
  if (typeof s.registry?.text !== 'string' || sha256(s.registry.text) !== s.registry.sha256) throw new Error('the supplement registry does not match its SHA-256');
  const ids = Object.keys(manifest.series).sort();
  if (JSON.stringify(Object.keys(s.series ?? {}).sort()) !== JSON.stringify(ids)) throw new Error("the supplement does not give exactly the manifest's series");
  const series: Manifest['series'] = {};
  for (const id of ids) {
    const t = s.series![id]!;
    if (!isTimeOrNull(t.deadline) || !isTimeOrNull(t.stale_at)) throw new Error(`the supplement's times for ${id} are not stored UTC times or null`);
    series[id] = { ...manifest.series[id]!, deadline: t.deadline as string | null, stale_at: t.stale_at as string | null, revision_csvs: [] };
  }
  return { manifest: { ...manifest, series, rules: null }, compat: { schema: manifest.schema, registryText: s.registry.text } };
}

/** The dataset at `dir` (default `ECON_DIR`), or null when none is configured. Throws on a damaged one. */
export function loadEconDataset(dir: string | undefined = process.env.ECON_DIR, source: string | undefined = process.env.ECON_SOURCE, compatFile: string | undefined = process.env.ECON_COMPAT): EconDataset | null {
  if (!dir) return null;
  const key = `${dir}\u0000${source ?? ''}\u0000${compatFile ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const manifestFile = join(dir, 'manifest.json');
  if (!existsSync(manifestFile)) throw new Error(`ECON_DIR ${dir} has no manifest.json`);
  const manifestBytes = readFileSync(manifestFile);
  let manifest = JSON.parse(manifestBytes.toString('utf8')) as Manifest;
  let compat: CompatInfo | undefined;
  if (manifest.schema === 'rmf.econ.manifest/3') {
    // Amendment 1 (22.2, 22.8): this one manifest/3 only, with the build's supplement.
    try {
      ({ manifest, compat } = compatManifest(manifest, sha256(manifestBytes), compatFile ? JSON.parse(readFileSync(compatFile, 'utf8')) : null));
    } catch (e) {
      throw new Error(`ECON_DIR ${dir}: ${(e as Error).message}`);
    }
  } else if (manifest.schema !== 'rmf.econ.manifest/4') throw new Error(`ECON_DIR ${dir}: manifest schema ${manifest.schema}, expected rmf.econ.manifest/4`);
  // Every file the manifest names, with its hash where the manifest gives one.
  const expected = new Map<string, string | null>();
  for (const s of Object.values(manifest.series)) {
    for (const r of [...(s.csvs ?? []), ...(s.revision_csvs ?? [])]) expected.set(r.path, r.sha256);
    for (const r of [...(s.revisions ?? []), ...(s.objects ?? [])]) expected.set(r.path, typeof r.sha256 === 'string' ? r.sha256 : null);
  }
  if (manifest.rules) for (const r of Object.values(manifest.rules)) for (const f of Array.isArray(r) ? r : [r]) if (f && typeof f === 'object' && typeof f.path === 'string') expected.set(f.path, typeof f.sha256 === 'string' ? f.sha256 : null);
  const root = normalize(dir);
  const texts = new Map<string, string>();
  const ds: EconDataset = {
    source: source === 'release' ? 'release' : 'fixture',
    manifest,
    ...(compat ? { compat } : {}),
    readText(path: string) {
      const known = texts.get(path);
      if (known !== undefined) return known;
      if (!expected.has(path)) throw new Error(`the manifest does not name ${path}`);
      const file = normalize(join(root, path));
      if (!file.startsWith(root + sep)) throw new Error(`${path} is outside the dataset`);
      const bytes = readFileSync(file);
      const want = expected.get(path);
      if (want && sha256(bytes) !== want) throw new Error(`${path} does not match its SHA-256 in the manifest`);
      const text = bytes.toString('utf8');
      texts.set(path, text);
      return text;
    },
  };
  cache.set(key, ds);
  return ds;
}

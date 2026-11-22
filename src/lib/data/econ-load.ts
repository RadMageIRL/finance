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
import type { EconDataset, Manifest } from './econ';

const cache = new Map<string, EconDataset>();

/** The dataset at `dir` (default `ECON_DIR`), or null when none is configured. Throws on a damaged one. */
export function loadEconDataset(dir: string | undefined = process.env.ECON_DIR, source: string | undefined = process.env.ECON_SOURCE): EconDataset | null {
  if (!dir) return null;
  const key = `${dir}\u0000${source ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const manifestFile = join(dir, 'manifest.json');
  if (!existsSync(manifestFile)) throw new Error(`ECON_DIR ${dir} has no manifest.json`);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Manifest;
  if (manifest.schema !== 'rmf.econ.manifest/4') throw new Error(`ECON_DIR ${dir}: manifest schema ${manifest.schema}, expected rmf.econ.manifest/4`);
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
    readText(path: string) {
      const known = texts.get(path);
      if (known !== undefined) return known;
      if (!expected.has(path)) throw new Error(`the manifest does not name ${path}`);
      const file = normalize(join(root, path));
      if (!file.startsWith(root + sep)) throw new Error(`${path} is outside the dataset`);
      const bytes = readFileSync(file);
      const want = expected.get(path);
      if (want && createHash('sha256').update(bytes).digest('hex') !== want) throw new Error(`${path} does not match its SHA-256 in the manifest`);
      const text = bytes.toString('utf8');
      texts.set(path, text);
      return text;
    },
  };
  cache.set(key, ds);
  return ds;
}

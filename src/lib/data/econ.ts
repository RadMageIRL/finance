// The shared, read-only interface to a v0.8 economic dataset (DATA_CONVENTIONS v0.8: manifest/4
// in section 9, the CSV segments of 16, the revision CSVs of 10 and 16). Pure: no file system and
// no network, so the same code runs at build time (econ-load.ts) and in the browser. Values stay
// the decimal strings the CSVs hold; nothing here rounds, converts or computes. Dashboards compute
// in their own modules, labeled "Computed by RadMage Finance" with the formula.
//
// SHARED FILE (brief Q, docs/P36_V020_PARALLEL_DASHBOARDS.md): owned by the integrator. Dashboard
// agents read it and never change it; a needed change is reported, not made.

/** One CSV segment file of a series, as the manifest names it. */
export interface SegmentRef {
  path: string;
  segment: string;
  sha256: string;
  retrieved_at: string;
}

/** The manifest/4 fields of one series that the dashboards use (section 9). */
export interface ManifestSeries {
  title: string;
  unit_label: string;
  class: string;
  frequency: string;
  status: string;
  status_reason: string | null;
  attribution: string | null;
  notice: string | null;
  retrieved_at: string | null;
  checked_at: string | null;
  last_period: string | null;
  last_value: string | null;
  /** The latest period's release date and its basis (calendar, rule, first-seen, not-recorded); date null when not recorded. */
  last_released: { basis: string; date: string | null } | null;
  /** The latest target range of a change point series ({ lower, upper }), else null. */
  last_range: { lower: string; upper: string } | null;
  deadline: string | null;
  stale_at: string | null;
  csvs: SegmentRef[];
  revision_csvs: SegmentRef[];
  revisions: { path: string; [k: string]: unknown }[];
  objects: { path: string; [k: string]: unknown }[];
  [k: string]: unknown;
}

/** The manifest/4 fields the dashboards use. */
export interface Manifest {
  schema: string;
  generated_at: string;
  snapshot: { id: string; [k: string]: unknown };
  previous_snapshot: string | null;
  health: unknown;
  rules: { notice: { path: string; sha256: string }; [k: string]: unknown } | null;
  series: Record<string, ManifestSeries>;
  [k: string]: unknown;
}

/** A dataset: its manifest and a reader for the files it names (paths relative to the econ root). */
export interface EconDataset {
  /** 'fixture' for the appendix B test data (never a publication); 'release' for a verified release. */
  source: 'fixture' | 'release';
  manifest: Manifest;
  readText(path: string): string;
}

/** A parsed CSV segment: its `# ` comment lines (without the prefix), header and rows. */
export interface ParsedCsv {
  comments: string[];
  header: string[];
  rows: Record<string, string>[];
}

/** One observation of a period series (business-day or monthly). Empty CSV cells become null. */
export interface Observation {
  period: string;
  value: string | null;
  missingCode: string | null;
  released: string | null;
  releasedBasis: string;
}

/** One change point of the FOMC target (`fomc-target`): a single rate, or a range from 2008-12-16. */
export interface ChangePoint {
  effective: string;
  kind: 'rate' | 'range';
  value: string | null;
  lower: string | null;
  upper: string | null;
  released: string | null;
  releasedBasis: string;
}

/** One row of a revision CSV (changes observed between collections, section 10). */
export interface RevisionRow {
  detectedAt: string;
  snapshot: string;
  period: string;
  field: string;
  before: string;
  after: string;
  kind: string;
  basis: string;
  releaseDate: string | null;
}

/** Splits one CSV line into fields (RFC 4180 quoting; the files are LF, one record per line). */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let v = '';
      i += 1;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          v += '"';
          i += 2;
        } else if (line[i] === '"') {
          i += 1;
          break;
        } else {
          v += line.charAt(i);
          i += 1;
        }
      }
      out.push(v);
      if (line[i] === ',') i += 1;
      else break;
    } else {
      const j = line.indexOf(',', i);
      if (j < 0) {
        out.push(line.slice(i));
        break;
      }
      out.push(line.slice(i, j));
      i = j + 1;
    }
  }
  return out;
}

/** Parses a CSV segment as 16 writes it: `# ` comment lines, then the header, then the rows. Throws on a malformed file. */
export function parseSegmentCsv(text: string): ParsedCsv {
  if (!text.endsWith('\n')) throw new Error('a CSV segment must end with a newline');
  const lines = text.slice(0, -1).split('\n');
  const comments: string[] = [];
  let k = 0;
  for (; k < lines.length; k += 1) {
    const line = lines[k] ?? '';
    if (!line.startsWith('# ')) break;
    comments.push(line.slice(2));
  }
  const headerLine = lines[k];
  if (headerLine === undefined) throw new Error('a CSV segment has no header');
  const header = csvFields(headerLine);
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(k + 1)) {
    const f = csvFields(line);
    if (f.length !== header.length) throw new Error(`a CSV row has ${f.length} fields, the header ${header.length}`);
    rows.push(Object.fromEntries(header.map((h, n) => [h, f[n] ?? ''])));
  }
  return { comments, header, rows };
}

const orNull = (v: string | undefined) => (v === undefined || v === '' ? null : v);
/** A cell of a parsed row; a missing column reads as the empty string. */
const cell = (r: Record<string, string>, k: string): string => r[k] ?? '';

/** The manifest entry of a series; throws when the dataset has no such series. */
export function seriesInfo(ds: EconDataset, id: string): ManifestSeries {
  const s = ds.manifest.series[id];
  if (!s) throw new Error(`the dataset has no series ${id}`);
  return s;
}

/** The segments of a series in join order (ascending segment, as 16 joins them). */
export function segmentsInOrder(refs: SegmentRef[]): SegmentRef[] {
  return [...refs].sort((a, b) => (a.segment < b.segment ? -1 : a.segment > b.segment ? 1 : 0));
}

/** Every observation of a period series, oldest first, joined from its segments. */
export function observations(ds: EconDataset, id: string): Observation[] {
  const out: Observation[] = [];
  for (const ref of segmentsInOrder(seriesInfo(ds, id).csvs)) {
    const { header, rows } = parseSegmentCsv(ds.readText(ref.path));
    const valueColumn = header.find((h) => h.startsWith('value_'));
    if (header[0] !== 'period' || !valueColumn) throw new Error(`${ref.path} is not a period series segment`);
    for (const r of rows) out.push({ period: cell(r, 'period'), value: orNull(r[valueColumn]), missingCode: orNull(r.missing_code), released: orNull(r.released), releasedBasis: cell(r, 'released_basis') });
  }
  return out;
}

/** The value column's name in a series' segments, for example `value_percent` (its unit). */
export function valueColumn(ds: EconDataset, id: string): string {
  const ref = segmentsInOrder(seriesInfo(ds, id).csvs)[0];
  if (!ref) throw new Error(`the series ${id} has no segments`);
  const col = parseSegmentCsv(ds.readText(ref.path)).header.find((h) => h.startsWith('value_'));
  if (!col) throw new Error(`${ref.path} has no value column`);
  return col;
}

/** Every change point of the FOMC target series, oldest first. */
export function changePoints(ds: EconDataset, id = 'fomc-target'): ChangePoint[] {
  const out: ChangePoint[] = [];
  for (const ref of segmentsInOrder(seriesInfo(ds, id).csvs)) {
    const { header, rows } = parseSegmentCsv(ds.readText(ref.path));
    if (header[0] !== 'effective') throw new Error(`${ref.path} is not a change point segment`);
    for (const r of rows) {
      const kind = cell(r, 'kind');
      if (kind !== 'rate' && kind !== 'range') throw new Error(`${ref.path}: unknown change point kind ${kind}`);
      out.push({ effective: cell(r, 'effective'), kind, value: orNull(r.value_percent), lower: orNull(r.lower_percent), upper: orNull(r.upper_percent), released: orNull(r.released), releasedBasis: cell(r, 'released_basis') });
    }
  }
  return out;
}

/** Every revision row of a series, oldest segment first, in file order. */
export function revisionRows(ds: EconDataset, id: string): RevisionRow[] {
  const out: RevisionRow[] = [];
  for (const ref of segmentsInOrder(seriesInfo(ds, id).revision_csvs ?? [])) {
    for (const r of parseSegmentCsv(ds.readText(ref.path)).rows) out.push({ detectedAt: cell(r, 'detected_at'), snapshot: cell(r, 'snapshot'), period: cell(r, 'period'), field: cell(r, 'field'), before: cell(r, 'before'), after: cell(r, 'after'), kind: cell(r, 'kind'), basis: cell(r, 'basis'), releaseDate: orNull(r.release_date) });
  }
  return out;
}

/** The comment lines of a series' newest segment: title, attribution, notice, terms and derivation text (16). */
export function segmentComments(ds: EconDataset, id: string): string[] {
  const refs = segmentsInOrder(seriesInfo(ds, id).csvs);
  const newest = refs[refs.length - 1];
  if (!newest) throw new Error(`the series ${id} has no segments`);
  return parseSegmentCsv(ds.readText(newest.path)).comments;
}

// The economic data rules of tools/dist-check.mjs (brief Q, agent 4; DATA_CONVENTIONS v0.8
// 22.8; design P28 8.9). Pure and free of imports so that dist-check (plain Node, which strips
// the types) and the unit tests use the same code, and the mutation pass can perturb it.
//
// RULES
// D1 Weight. Calculator and lesson pages, the data overview /finance/data/, every page
//    directly below it (/finance/data/<slug>/) and the design-system review page (which shows
//    the interactive data components) are interactive pages, with the interactive JavaScript
//    budget; every other page has the site chrome budget.
// D2 Data files in the build. dist/data/econ/ exists only in a build made with a verified
//    release: the data step writes the verified file list (path and SHA-256 of every file, in
//    path order) outside dist/ and names it in ECON_VERIFIED. With ECON_VERIFIED, dist/data/econ/
//    holds exactly those paths, each with that SHA-256, and nothing else. Without it, dist/ has
//    no data/econ/ at all (the site never serves data it has not verified).
// D3 Links to data files. A link whose path is under /finance/data/econ/ points at a file that
//    exists only where a verified release is placed, so it is never checked against dist/ as an
//    ordinary page link. Instead:
//    - its rest must be a plain relative path (letters, digits, ".", "_" and "-" in segments
//      separated by "/", no empty segment, no "." or ".." segment, no query or fragment);
//    - with a verified list (D2) it must be one of the listed files;
//    - otherwise, with a dataset directory (ECON_DIR, the build's input) it must be a file of
//      that dataset;
//    - otherwise the build has no data, and any such link is a problem.
//    Every other internal link keeps the ordinary rule: a broken one fails.

// D4 Indexing (a note for astro.config.mjs, which this module cannot change). The data pages are
//    indexed only in a build from a verified release (ECON_SOURCE=release with ECON_DIR);
//    otherwise DataLayout gives them noindex, and dist-check fails while the sitemap still lists
//    them. The sitemap filter in astro.config.mjs therefore has to leave out /finance/data/ and
//    the pages directly below it in exactly those builds: `dataPagesIndexed` is that test.

// D5 The pages guard (owner brief R, option (b); decision D16, whose `pages` step is its own
//    approval). The overview and the three dashboards, and every menu entry and link to them, are
//    built only when the build's environment has DATA_PAGES=on. Without it the build is the live
//    Finance site as it was: no page at /finance/data/ or directly below it, and no link to one
//    anywhere. With it, all four pages are built. The data files of a verified release (D2) do
//    not depend on this switch: the first data deployment ships them unlinked (D16).

// D6 Production (owner brief V item 1; ledger P78). A build on GitHub Actions (GITHUB_ACTIONS=true:
//    `pages.yml`, the only production build) shows the data pages only from a verified release,
//    and reads no dataset that is not one. A verified release here means all of: ECON_SOURCE=release,
//    ECON_DIR naming a directory that exists, and ECON_VERIFIED (the list of D2). With DATA_PAGES=on
//    and no verified release, the build is refused; with ECON_DIR and no verified release, too. So a
//    run that could not place a verified release can never deploy the pages (fail closed):
//    `pages.yml` turns the pages on only with the owner's approval and a placed release, and this
//    rule refuses any other combination. Builds elsewhere (local checks) are not production and
//    keep the fixture and no-data builds.

/** D5: whether a build holds the data pages (false) or builds them (true), from its environment. */
export function dataPagesOn(env: Record<string, string | undefined>): boolean {
  return env.DATA_PAGES === 'on';
}

/** D5: the URL paths of the four data pages under the site base, in menu order. */
export const DATA_PAGE_PATHS: readonly string[] = ['/finance/data/', '/finance/data/federal-funds-rate/', '/finance/data/money-stock/', '/finance/data/public-debt/'];

/**
 * D5: the problems with a build's data pages. `on` is dataPagesOn of the build; `pages` the URL
 * paths of its built pages; `links` the internal link targets (URL paths) found on its pages.
 */
export function pagesGuardProblems(on: boolean, pages: readonly string[], links: readonly string[]): string[] {
  const problems: string[] = [];
  const built = new Set(pages);
  if (on) {
    for (const p of DATA_PAGE_PATHS) if (!built.has(p)) problems.push(`the data page ${p} is missing although DATA_PAGES=on`);
    return problems;
  }
  for (const p of pages) if (isDataPage(p)) problems.push(`the data page ${p} is built although the pages are held (DATA_PAGES is not on)`);
  for (const l of new Set(links)) if (isDataPage(l)) problems.push(`a link to the data page ${l} although the pages are held (DATA_PAGES is not on)`);
  return problems;
}

/**
 * D6: the problems with a production build's data, from its environment. `dirExists` is whether
 * ECON_DIR names an existing directory. Empty outside GitHub Actions.
 */
export function productionProblems(env: Record<string, string | undefined>, dirExists: boolean): string[] {
  if (env.GITHUB_ACTIONS !== 'true') return [];
  const release = env.ECON_SOURCE === 'release' && Boolean(env.ECON_DIR) && dirExists && Boolean(env.ECON_VERIFIED);
  const problems: string[] = [];
  if (dataPagesOn(env) && !release) problems.push('the data pages are on in a production build without a verified release (ECON_SOURCE=release, an existing ECON_DIR and ECON_VERIFIED)');
  if (env.ECON_DIR && !release) problems.push('a production build read a dataset that is not a verified release (ECON_DIR without ECON_SOURCE=release, an existing directory and ECON_VERIFIED)');
  return problems;
}

/** D4: whether a build indexes the data pages (a verified release), from its environment. */
export function dataPagesIndexed(env: Record<string, string | undefined>): boolean {
  return env.ECON_SOURCE === 'release' && Boolean(env.ECON_DIR);
}

/** D4: whether a sitemap URL is a data page (the overview or a dashboard). */
export function isDataPage(pageUrl: string): boolean {
  return /\/finance\/data\/([a-z0-9-]+\/)?$/.test(pageUrl);
}

/** The prefix of the data files under the site base. */
export const ECON_PREFIX = '/finance/data/econ/';

/** D1: whether a page (its URL path) has the interactive JavaScript budget. */
export function isInteractive(page: string): boolean {
  return /^\/finance\/(calculators|learn)\/[^/]+\/$/.test(page) || /^\/finance\/data\/([a-z0-9-]+\/)?$/.test(page) || page === '/finance/design-system/';
}

/** D3: whether an internal path is a link to a data file (and so follows D3, not the page rule). */
export function isEconPath(pathname: string): boolean {
  return pathname.startsWith(ECON_PREFIX);
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * D3: the problem with a link to a data file, or null when it is fine. `verified` is the set of
 * verified paths (D2) or null; `available` the set of the dataset directory's files or null.
 */
export function econLinkProblem(pathname: string, search: string, verified: ReadonlySet<string> | null, available: ReadonlySet<string> | null): string | null {
  if (!isEconPath(pathname)) return null;
  const rest = pathname.slice(ECON_PREFIX.length);
  const segments = rest.split('/');
  if (search || rest === '' || segments.some((s) => s === '' || s === '.' || s === '..' || !SEGMENT.test(s))) return `a data link that is not a plain file path: ${pathname}${search}`;
  if (verified) return verified.has(rest) ? null : `links to ${rest}, which the verified release does not have`;
  if (available) return available.has(rest) ? null : `links to ${rest}, which the build's dataset does not have`;
  return `links to the data file ${rest}, but this build has no dataset`;
}

/**
 * D2: the problems with dist/data/econ/. `present` is null when the directory does not exist,
 * otherwise its files (relative paths); `verified` is the parsed verified list or null when
 * ECON_VERIFIED is not set; `hashOf` gives the SHA-256 of a present file.
 */
export function econTreeProblems(present: readonly string[] | null, verified: readonly { path: string; sha256: string }[] | null, hashOf: (path: string) => string): string[] {
  if (!verified) return present === null ? [] : ['dist/data/econ/ is present without a verified list (ECON_VERIFIED)'];
  const problems: string[] = [];
  const have = new Set(present ?? []);
  const want = new Set(verified.map((v) => v.path));
  for (const v of verified) {
    if (!have.has(v.path)) problems.push(`dist/data/econ/ is missing ${v.path} of the verified release`);
    else if (hashOf(v.path) !== v.sha256) problems.push(`dist/data/econ/${v.path} does not match the verified release`);
  }
  for (const p of have) if (!want.has(p)) problems.push(`dist/data/econ/${p} is not in the verified release`);
  return problems;
}

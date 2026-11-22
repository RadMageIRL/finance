// The economic data rules of tools/dist-check.mjs (src/lib/data/shell-dist.ts D1 to D3): which
// pages get the interactive budget, links to data files, and dist/data/econ/ against the
// verified release list.
import { describe, expect, it } from 'vitest';
import { DATA_PAGE_PATHS, dataPagesIndexed, dataPagesOn, econLinkProblem, econTreeProblems, isDataPage, isEconPath, isInteractive, pagesGuardProblems, productionProblems } from '../../../../src/lib/data/shell-dist';

describe('D1: interactive pages', () => {
  it('gives the data overview, the dashboards and the design-system page the interactive budget', () => {
    for (const page of ['/finance/data/', '/finance/data/federal-funds-rate/', '/finance/data/money-stock/', '/finance/data/public-debt/', '/finance/calculators/apr-apy/', '/finance/learn/what-is-money/', '/finance/design-system/']) {
      expect(isInteractive(page), page).toBe(true);
    }
  });
  it('keeps the chrome budget for every other page, and for data files and deeper paths', () => {
    for (const page of ['/finance/', '/finance/about/', '/finance/calculators/', '/finance/learn/', '/finance/data/econ/x/', '/finance/data', '/finance/news/']) {
      expect(isInteractive(page), page).toBe(false);
    }
  });
});

describe('D3: links to data files', () => {
  const verified = new Set(['manifest.json', 'series/effr/2026/0123456789abcdef.csv']);
  const available = new Set(['manifest.json', 'notices/9d190fa98f6dcc22.txt']);

  it('leaves every other link to the page rule', () => {
    expect(isEconPath('/finance/data/')).toBe(false);
    expect(isEconPath('/finance/data/econ')).toBe(false);
    expect(econLinkProblem('/finance/data/money-stock/', '', null, null)).toBeNull();
  });

  it('accepts a file of the verified release, and reports one it does not have', () => {
    expect(econLinkProblem('/finance/data/econ/series/effr/2026/0123456789abcdef.csv', '', verified, available)).toBeNull();
    expect(econLinkProblem('/finance/data/econ/notices/9d190fa98f6dcc22.txt', '', verified, available)).toMatch(/verified release does not have/);
  });

  it("accepts a file of the build's dataset without a verified list, and reports one it does not have", () => {
    expect(econLinkProblem('/finance/data/econ/notices/9d190fa98f6dcc22.txt', '', null, available)).toBeNull();
    expect(econLinkProblem('/finance/data/econ/series/effr/2026/0123456789abcdef.csv', '', null, available)).toMatch(/dataset does not have/);
  });

  it('reports any data link in a build with no dataset', () => {
    expect(econLinkProblem('/finance/data/econ/manifest.json', '', null, null)).toMatch(/no dataset/);
  });

  it('reports a data link that is not a plain file path', () => {
    for (const [path, search] of [['/finance/data/econ/', ''], ['/finance/data/econ/manifest.json', '?v=2'], ['/finance/data/econ/a//b.csv', ''], ['/finance/data/econ/a/../manifest.json', ''], ['/finance/data/econ/a b.csv', '']] as const) {
      expect(econLinkProblem(path, search, verified, available), `${path}${search}`).toMatch(/not a plain file path/);
    }
  });
});

describe('D2: dist/data/econ/', () => {
  const list = [
    { path: 'manifest.json', sha256: 'a'.repeat(64) },
    { path: 'series/effr/2026/0123456789abcdef.csv', sha256: 'b'.repeat(64) },
  ];
  const hashes: Record<string, string> = { 'manifest.json': 'a'.repeat(64), 'series/effr/2026/0123456789abcdef.csv': 'b'.repeat(64), 'extra.txt': 'c'.repeat(64) };
  const hashOf = (p: string) => hashes[p] ?? '';

  it('passes a build without data and a build whose tree equals the verified list', () => {
    expect(econTreeProblems(null, null, hashOf)).toEqual([]);
    expect(econTreeProblems(list.map((x) => x.path), list, hashOf)).toEqual([]);
  });

  it('reports data/econ/ present without a verified list', () => {
    expect(econTreeProblems(['manifest.json'], null, hashOf)).toEqual(['dist/data/econ/ is present without a verified list (ECON_VERIFIED)']);
    expect(econTreeProblems([], null, hashOf)).toHaveLength(1);
  });

  it('reports a missing file, an extra file and a changed file', () => {
    expect(econTreeProblems(['manifest.json'], list, hashOf)).toEqual(['dist/data/econ/ is missing series/effr/2026/0123456789abcdef.csv of the verified release']);
    expect(econTreeProblems([...list.map((x) => x.path), 'extra.txt'], list, hashOf)).toEqual(['dist/data/econ/extra.txt is not in the verified release']);
    expect(econTreeProblems(list.map((x) => x.path), list, (p) => (p === 'manifest.json' ? 'd'.repeat(64) : hashOf(p)))).toEqual(['dist/data/econ/manifest.json does not match the verified release']);
    expect(econTreeProblems(null, list, hashOf)).toHaveLength(2);
  });
});

describe('D4: indexing', () => {
  it('indexes the data pages only in a build from a verified release', () => {
    expect(dataPagesIndexed({ ECON_SOURCE: 'release', ECON_DIR: 'dist/data/econ' })).toBe(true);
    expect(dataPagesIndexed({ ECON_DIR: 'local/econ-fixture/live' })).toBe(false);
    expect(dataPagesIndexed({ ECON_SOURCE: 'release' })).toBe(false);
    expect(dataPagesIndexed({})).toBe(false);
  });
  it('knows the data pages among sitemap URLs', () => {
    expect(isDataPage('https://radmagelabs.com/finance/data/')).toBe(true);
    expect(isDataPage('https://radmagelabs.com/finance/data/public-debt/')).toBe(true);
    expect(isDataPage('https://radmagelabs.com/finance/learn/')).toBe(false);
    expect(isDataPage('https://radmagelabs.com/finance/data/econ/x/')).toBe(false);
  });
});

describe('D5: the pages guard (owner brief R, option (b))', () => {
  const SITE = ['/finance/', '/finance/learn/what-is-money/', '/finance/calculators/', '/finance/404.html'];
  it('builds the data pages only when DATA_PAGES is exactly on', () => {
    expect(dataPagesOn({ DATA_PAGES: 'on' })).toBe(true);
    expect(dataPagesOn({})).toBe(false);
    expect(dataPagesOn({ DATA_PAGES: '' })).toBe(false);
    expect(dataPagesOn({ DATA_PAGES: 'ON' })).toBe(false);
    expect(dataPagesOn({ DATA_PAGES: 'true' })).toBe(false);
    // A dataset alone, even a verified release, does not build the pages: that is their own approval (D16).
    expect(dataPagesOn({ ECON_DIR: 'x', ECON_SOURCE: 'release' })).toBe(false);
  });
  it('names the overview and the three dashboards', () => {
    expect(DATA_PAGE_PATHS).toEqual(['/finance/data/', '/finance/data/federal-funds-rate/', '/finance/data/money-stock/', '/finance/data/public-debt/']);
    for (const p of DATA_PAGE_PATHS) expect(isDataPage(p)).toBe(true);
  });
  it('accepts a held build that has no data page and no link to one', () => {
    expect(pagesGuardProblems(false, SITE, ['/finance/learn/', '/finance/calculators/apr-apy/'])).toEqual([]);
  });
  it('reports a data page built in a held build', () => {
    expect(pagesGuardProblems(false, [...SITE, '/finance/data/money-stock/'], [])).toEqual(['the data page /finance/data/money-stock/ is built although the pages are held (DATA_PAGES is not on)']);
    expect(pagesGuardProblems(false, [...SITE, '/finance/data/'], [])).toHaveLength(1);
  });
  it('reports each data page a held build links to, once per target', () => {
    expect(pagesGuardProblems(false, SITE, ['/finance/data/public-debt/', '/finance/learn/', '/finance/data/public-debt/'])).toEqual(['a link to the data page /finance/data/public-debt/ although the pages are held (DATA_PAGES is not on)']);
    expect(pagesGuardProblems(false, SITE, ['/finance/data/'])).toHaveLength(1);
  });
  it('lets a held build carry the data files of a verified release (D16: data first, unlinked)', () => {
    expect(pagesGuardProblems(false, SITE, ['/finance/data/econ/series/effr/2026/a.csv'])).toEqual([]);
  });
  it('requires all four pages when the pages are built', () => {
    expect(pagesGuardProblems(true, [...SITE, ...DATA_PAGE_PATHS], ['/finance/data/'])).toEqual([]);
    expect(pagesGuardProblems(true, [...SITE, '/finance/data/', '/finance/data/money-stock/', '/finance/data/public-debt/'], [])).toEqual(['the data page /finance/data/federal-funds-rate/ is missing although DATA_PAGES=on']);
    expect(pagesGuardProblems(true, SITE, [])).toHaveLength(4);
  });
});

describe('D6: production shows the data pages only from a verified release (owner brief V item 1)', () => {
  const GH = { GITHUB_ACTIONS: 'true' };
  const RELEASE = { ...GH, ECON_SOURCE: 'release', ECON_DIR: '/tmp/econ', ECON_VERIFIED: '/tmp/econ-verified.json' };
  const PAGES_NO_RELEASE = 'the data pages are on in a production build without a verified release (ECON_SOURCE=release, an existing ECON_DIR and ECON_VERIFIED)';
  const NOT_A_RELEASE = 'a production build read a dataset that is not a verified release (ECON_DIR without ECON_SOURCE=release, an existing directory and ECON_VERIFIED)';
  it('accepts the pages on with a verified release, and a release with the pages held', () => {
    expect(productionProblems({ ...RELEASE, DATA_PAGES: 'on' }, true)).toEqual([]);
    expect(productionProblems(RELEASE, true)).toEqual([]);
  });
  it('accepts a production build with neither the pages nor data (the live site as it was)', () => {
    expect(productionProblems(GH, false)).toEqual([]);
    expect(productionProblems({ ...GH, DATA_PAGES: '' }, false)).toEqual([]);
  });
  it('reports the pages on without data, or with any part of a verified release missing', () => {
    expect(productionProblems({ ...GH, DATA_PAGES: 'on' }, false)).toEqual([PAGES_NO_RELEASE]);
    expect(productionProblems({ ...RELEASE, DATA_PAGES: 'on', ECON_VERIFIED: '' }, true)).toEqual([PAGES_NO_RELEASE, NOT_A_RELEASE]);
    expect(productionProblems({ ...RELEASE, DATA_PAGES: 'on', ECON_SOURCE: '' }, true)).toEqual([PAGES_NO_RELEASE, NOT_A_RELEASE]);
    expect(productionProblems({ ...RELEASE, DATA_PAGES: 'on', ECON_DIR: '' }, false)).toEqual([PAGES_NO_RELEASE]);
    expect(productionProblems({ ...RELEASE, DATA_PAGES: 'on' }, false)).toEqual([PAGES_NO_RELEASE, NOT_A_RELEASE]);
  });
  it('reports a dataset that is not a verified release, such as the fixture, with the pages held too', () => {
    expect(productionProblems({ ...GH, ECON_DIR: 'local/econ-fixture/live' }, true)).toEqual([NOT_A_RELEASE]);
    expect(productionProblems({ ...GH, ECON_DIR: 'local/econ-fixture/live', ECON_SOURCE: 'release' }, true)).toEqual([NOT_A_RELEASE]);
  });
  it('applies only on GitHub Actions: local fixture and no-data builds stay allowed', () => {
    expect(productionProblems({ DATA_PAGES: 'on' }, false)).toEqual([]);
    expect(productionProblems({ DATA_PAGES: 'on', ECON_DIR: 'local/econ-fixture/live' }, true)).toEqual([]);
    expect(productionProblems({ GITHUB_ACTIONS: 'false', DATA_PAGES: 'on' }, false)).toEqual([]);
  });
});

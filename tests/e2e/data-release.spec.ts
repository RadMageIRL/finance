// The data pages as production builds them from a verified release (owner brief V item 2; rules
// D2 to D4 of src/lib/data/shell-dist.ts; DATA_CONVENTIONS v0.8 22.8). Run with ECON_BUILD=release
// against the rehearsal of tools/econ-release.mjs: the appendix J scenario's release placed outside
// dist/ by the site build's own fetch-step code, the build made from it (DATA_PAGES=on, ECON_DIR,
// ECON_SOURCE=release, ECON_VERIFIED), and the tree copied to dist/data/econ. Test data from the
// fixtures, never a publication.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { DATA_PAGES_REVIEWED } from '../../src/lib/data/review';
import { collectErrors, DATA_PAGE_URLS, ECON_BUILD, url } from './helpers';

test.skip(ECON_BUILD !== 'release', 'needs the build from the verified release (ECON_BUILD=release)');

const TREE = 'local/econ-release/econ';
const VERIFIED = 'local/econ-release/verified.json';
const MANIFEST_PATH = '/finance/data/econ/manifest.json';
const isBrowserNetworkLine = (text: string) => /^console: Failed to load resource/.test(text);

const snapshotId = () => (JSON.parse(readFileSync(`${TREE}/manifest.json`, 'utf8')) as { snapshot: { id: string } }).snapshot.id;
const verified = () => new Map((JSON.parse(readFileSync(VERIFIED, 'utf8')) as { path: string; sha256: string }[]).map((v) => [v.path, v.sha256]));

test.describe('a build from a verified release', () => {
  for (const path of DATA_PAGE_URLS) {
    test(`${path} is indexed and stamped with the release, with no test-data notice`, async ({ page }) => {
      await page.goto(url(path));
      expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBe(0);
      const stamp = page.locator('[data-econ-stamp]');
      await expect(stamp).toHaveAttribute('data-state', 'current');
      await expect(stamp).toHaveAttribute('data-check', 'release');
      await expect(stamp).toHaveAttribute('data-snapshot', snapshotId());
      expect(await page.locator('[data-state="fixture"]').count()).toBe(0);
      await expect(page.getByText('Test data', { exact: true })).toHaveCount(0);
    });
  }

  test('the sitemap lists the four data pages, and dates them and the data sections by their review', async ({ request }) => {
    const xml = await (await request.get(url('sitemap-0.xml'))).text();
    // The sitemap writes each lastmod as midnight UTC of the page's review date.
    for (const path of DATA_PAGE_URLS) expect(xml).toContain(`<loc>https://radmagelabs.com${url(path)}</loc><lastmod>${DATA_PAGES_REVIEWED}T00:00:00.000Z</lastmod>`);
    for (const path of ['sources/', 'methodology/', 'privacy/', 'corrections/']) expect(xml).toContain(`<loc>https://radmagelabs.com${url(path)}</loc><lastmod>${DATA_PAGES_REVIEWED}T00:00:00.000Z</lastmod>`);
    // Pages without data sections keep their own review date.
    expect(xml).toContain(`<loc>https://radmagelabs.com${url('calculators/')}</loc><lastmod>2026-11-16T00:00:00.000Z</lastmod>`);
  });

  test('checks the deployed manifest itself: the same snapshot, one same-origin request, no error', async ({ page, baseURL }) => {
    const requests: { url: string; method: string }[] = [];
    page.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
    const errors = collectErrors(page);
    await page.goto(url('data/'), { waitUntil: 'networkidle' });
    await expect(page.locator('[data-econ-stamp]')).toHaveAttribute('data-refresh', 'same');
    await expect(page.locator('[data-refresh-status]')).toHaveText('');
    const origin = new URL(baseURL ?? page.url()).origin;
    expect(requests.filter((r) => r.url.includes('/data/econ/')).map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([`GET ${MANIFEST_PATH}`]);
    expect([...new Set(requests.map((r) => new URL(r.url).origin))]).toEqual([origin]);
    expect(errors.filter((e) => !isBrowserNetworkLine(e))).toEqual([]);
  });

  test('every data file the pages link to is served, byte for byte the verified file', async ({ page, request }) => {
    const want = verified();
    const links = new Set<string>();
    for (const path of DATA_PAGE_URLS) {
      await page.goto(url(path));
      for (const h of await page.locator('a[href^="/finance/data/econ/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))) links.add(h);
    }
    expect(links.size).toBeGreaterThan(0);
    for (const h of links) {
      const rest = h.slice('/finance/data/econ/'.length);
      expect(want.has(rest), `${rest} is in the verified list`).toBe(true);
      const r = await request.get(h);
      expect(r.status(), h).toBe(200);
      expect(createHash('sha256').update(await r.body()).digest('hex'), h).toBe(want.get(rest));
    }
  });
});

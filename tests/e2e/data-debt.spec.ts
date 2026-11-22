// The National Debt Tracker in the browser (/finance/data/public-debt/): readable without
// JavaScript, accessible in both themes, no horizontal scrolling at 320 px or at 400 percent zoom,
// and no requests to other origins. Built with the appendix B fixture dataset (ECON_DIR), the page
// shows the data; built without one, it shows the unavailable state and its explanation, and these
// tests check that instead.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, HELD, storeTheme, url } from './helpers';

// Held as in production (DATA_PAGES not on): the data pages are not built; tests/e2e/data-held.spec.ts
// checks that instead.
test.skip(HELD, 'the data pages are held in this build');

const DEBT = url('data/public-debt/');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const hasData = async (page: Page) => (await page.locator('[data-state="unavailable"]').count()) === 0;

test.describe('National Debt Tracker', () => {
  for (const stored of ['light', 'dark']) {
    test(`has no axe violations in the ${stored} theme`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: stored === 'dark' ? 'light' : 'dark' });
      await storeTheme(context, stored);
      const page = await context.newPage();
      await page.goto(DEBT);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-ready'));
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(stored);
      // Open every download list, so the links inside are checked too.
      for (const d of await page.locator('details').all()) await d.evaluate((el) => el.setAttribute('open', ''));
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      await context.close();
    });
  }

  test('has no horizontal scrolling at 320 px', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
    const page = await context.newPage();
    await page.goto(DEBT);
    for (const d of await page.locator('details').all()) await d.evaluate((el) => el.setAttribute('open', ''));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });

  test('reflows at 400 percent zoom (320 CSS px) with the menu available', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.setViewportSize({ width: 320, height: 200 });
    await page.goto(DEBT);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator('[data-menu-open]')).toBeVisible();
    await context.close();
  });

  test('makes no requests to other origins and logs no errors', async ({ page, baseURL }) => {
    const origins = new Set<string>();
    page.on('request', (request) => {
      const target = new URL(request.url());
      if (target.protocol !== 'data:') origins.add(target.origin);
    });
    const errors = collectErrors(page);
    const violations: string[] = [];
    await page.exposeFunction('__reportCsp', (v: string) => violations.push(v));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        (window as unknown as { __reportCsp: (v: string) => void }).__reportCsp(`${e.violatedDirective} ${e.blockedURI}`);
      });
    });
    await page.goto(DEBT, { waitUntil: 'networkidle' });
    expect([...origins]).toEqual([new URL(baseURL ?? '').origin]);
    expect(errors).toEqual([]);
    expect(violations).toEqual([]);
    expect(await page.context().cookies()).toEqual([]);
  });

  test('reads without JavaScript: the latest total, its changes, both parts, recent records and downloads', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(DEBT);
    await expect(page.locator('h1')).toHaveText('National Debt Tracker');
    await expect(page.locator('#debt-about')).toBeVisible();
    // The page's own link to the lesson (the shared layout's Related section adds another).
    await expect(page.locator('.data-content a[href="/finance/learn/how-money-flows/"]')).toHaveCount(1);
    await expect(page.locator('.data-related a[href="/finance/learn/how-money-flows/"]')).toHaveCount(1);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.map((t) => JSON.parse(t)['@type'])).toContain('Dataset');
    if (!(await hasData(page))) {
      await expect(page.locator('[data-state="unavailable"]')).toBeVisible();
      await expect(page.locator('table')).toHaveCount(0);
      await context.close();
      return;
    }
    // The latest total, exact to the cent, then rounded for display beside it.
    const latest = page.locator('[data-debt="latest"]');
    await expect(latest).toContainText(/\$\d{1,3}(,\d{3}){4}\.\d{2}/);
    await expect(latest).toContainText('trillion, rounded for display.');
    await expect(latest).toContainText('Record date ');
    // Three computed changes, each labeled with its formula or the reason it is not shown.
    const changes = page.locator('[data-debt="changes"] > *');
    await expect(changes).toHaveCount(3);
    for (const c of await changes.all()) {
      await expect(c).toContainText('Computed by RadMage Finance');
      await expect(c).toContainText('Formula: ');
    }
    // Both parts, and the chart of the parts as two lines.
    await expect(page.locator('[data-debt="parts"] > *')).toHaveCount(2);
    await expect(page.locator('#debt-chart-parts')).toContainText('not stacked');
    // The last 30 record dates of all three series.
    await expect(page.locator('#debt-recent tbody tr')).toHaveCount(30);
    await expect(page.locator('#debt-recent thead th')).toHaveCount(6);
    // Gaps and inconsistencies from the registry, and the dates where the parts and total differ.
    await expect(page.locator('#debt-gaps tbody tr').first()).toContainText('no Debt to the Penny record');
    await expect(page.locator('#debt-inconsistencies tbody tr')).not.toHaveCount(0);
    await expect(page.locator('#debt-disagreements')).toContainText('Parts minus total');
    // Downloads: one CSV link per segment, newest first, same origin, with a readable name.
    const csv = page.locator('.debt-downloads[data-series="debt-total"] a');
    expect(await csv.count()).toBeGreaterThan(1);
    const first = await csv.first().getAttribute('href');
    expect(first).toMatch(/^\/finance\/data\/econ\/series\/debt-total\/\d{4}\/[0-9a-f]{16}\.csv$/);
    const names = await csv.evaluateAll((links) => links.map((a) => a.getAttribute('download') ?? ''));
    expect(names).toEqual([...names].sort().reverse());
    // Source, status and the as-of stamp.
    await expect(page.locator('main')).toContainText('Source: U.S. Department of the Treasury, Bureau of the Fiscal Service, Debt to the Penny.');
    await expect(page.locator('#debt-parts').locator('..')).toContainText('Intragovernmental holdings');
    await expect(page.locator('main')).toContainText('As of the snapshot of');
    await context.close();
  });
});

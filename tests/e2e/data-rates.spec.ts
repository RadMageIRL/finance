// The federal funds rate page (/finance/data/federal-funds-rate/): readable without JavaScript,
// the range switch by keyboard, observed and derived values told apart, accessibility in both
// themes, reflow, and no requests to other origins. Data tests run on a build with a dataset
// (ECON_DIR, the appendix B fixture root: test data); a build without one shows the unavailable
// state, which the first test checks either way.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { collectErrors, HELD, storeTheme, url } from './helpers';

// Held as in production (DATA_PAGES not on): the data pages are not built; tests/e2e/data-held.spec.ts
// checks that instead.
test.skip(HELD, 'the data pages are held in this build');

const PAGE = url('data/federal-funds-rate/');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const hasData = async (page: Page) => (await page.locator('.rates-observed').count()) > 0;

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe('Federal funds rate page', () => {
  test('builds with or without a dataset: the explanation always, the data only when the build had it', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('h1')).toHaveText('Federal Funds Rate Tracker');
    await expect(page.locator('#rates-what-effr')).toBeVisible();
    await expect(page.locator('#rates-why-derived')).toBeVisible();
    if (await hasData(page)) {
      await expect(page.locator('[data-state="unavailable"]')).toHaveCount(0);
      await expect(page.locator('#rates-now')).toBeVisible();
    } else {
      await expect(page.locator('[data-state="unavailable"]')).toBeVisible();
      await expect(page.locator('#rates-chart')).toHaveCount(0);
    }
  });

  test('reads without JavaScript: the five-year chart, the headlines, the tables and the CSV links', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(PAGE);
    test.skip(!(await hasData(page)), 'this build has no dataset');
    await expect(page.locator('[data-range-panel="5y"]')).toBeVisible();
    for (const r of ['1y', '10y', 'all']) await expect(page.locator(`[data-range-panel="${r}"]`)).toBeHidden();
    await expect(page.locator('.data-switch')).toBeHidden();
    await expect(page.locator('.rates-nojs')).toBeVisible();
    await expect(page.locator('.rates-observed')).toContainText(/\d+\.\d{2} percent/);
    await expect(page.locator('.rates-derived')).toContainText(/\d+\.\d{2} to \d+\.\d{2} percent/);
    await expect(page.locator('#rates-recent tbody tr')).toHaveCount(30);
    expect(await page.locator('#rates-target tbody tr').count()).toBeGreaterThan(1);
    await expect(page.locator('#rates-target tbody tr').last()).toContainText('not a decision date');
    await expect(page.locator('#rates-compare tbody tr')).toHaveCount(5);
    const csv = page.locator('.rates-files a');
    expect(await csv.count()).toBeGreaterThan(2);
    await expect(csv.first()).toHaveAttribute('href', /^\/finance\/data\/econ\/series\/effr\/\d{4}\/[0-9a-f]{16}\.csv$/);
    await expect(csv.first()).toHaveAttribute('download', /^effr-\d{4}\.csv$/);
    await context.close();
  });

  test('keeps the observed rate and the derived target apart in the headlines, the chart and the tables', async ({ page }) => {
    await page.goto(PAGE);
    test.skip(!(await hasData(page)), 'this build has no dataset');
    await expect(page.locator('.rates-observed')).toContainText('market rate, observed');
    await expect(page.locator('.rates-derived')).toContainText('derived');
    await expect(page.locator('.rates-derived')).toContainText("New York Fed's EFFR records");
    const chart = page.locator('[data-range-panel="all"]');
    await expect(chart).toContainText('EFFR (market rate, observed)');
    await expect(chart).toContainText('FOMC target rate (policy target, single rate, derived)');
    await expect(chart).toContainText('FOMC target range (policy target range, derived)');
    await expect(page.locator('#rates-compare thead')).toContainText('EFFR, market rate');
    await expect(page.locator('#rates-compare thead')).toContainText('FOMC target in effect, derived');
    for (const id of ['#rates-compare', '#rates-recent', '#rates-target']) await expect(page.locator(`${id} thead`)).toContainText('computed by RadMage Finance');
    expect(await page.locator('.rates-figures').getByText('Computed by RadMage Finance').count()).toBeGreaterThanOrEqual(5);
  });

  test('switches the chart range from the keyboard', async ({ page }) => {
    await page.goto(PAGE);
    test.skip(!(await hasData(page)), 'this build has no dataset');
    await expect(page.locator('.data-switch')).toBeVisible();
    let reached = false;
    for (let i = 0; i < 120 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name === 'rates-range');
    }
    expect(reached, 'Tab never reached the range switch').toBe(true);
    await expect(page.locator('input[name="rates-range"][value="5y"]')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('input[name="rates-range"][value="10y"]')).toBeChecked();
    await expect(page.locator('[data-range-panel="10y"]')).toBeVisible();
    await expect(page.locator('[data-range-panel="5y"]')).toBeHidden();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-range-panel="all"]')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('input[name="rates-range"][value="1y"]')).toBeChecked();
    await expect(page.locator('[data-range-panel="1y"]')).toBeVisible();
    await expect(page.locator('[data-range-panel]:visible')).toHaveCount(1);
  });

  test('describes itself as a Dataset by the New York Fed, the target labeled as derived, and links to its lesson but no calculator', async ({ page }) => {
    await page.goto(PAGE);
    const blocks = await page.locator('script[type="application/ld+json"]').evaluateAll((s) => s.map((x) => JSON.parse(x.textContent ?? '{}')));
    const main = blocks.find((b) => b['@type'] === 'Dataset');
    expect(main?.creator?.name).toBe('Federal Reserve Bank of New York');
    expect(main?.publisher?.name).toBe('RadMage Labs');
    expect(JSON.stringify(main?.variableMeasured)).toContain('Derived by RadMage Finance');
    await expect(page.locator('.rates-page a[href="/finance/learn/how-banks-create-money/"]')).toHaveCount(1);
    await expect(page.locator('.rates-page a[href*="calculators/"]')).toHaveCount(0);
    const refs = await page.locator('.rates-page a.cite-ref').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of new Set(refs)) await expect(page.locator(ref), ref).toHaveCount(1);
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`has no accessibility violations in ${theme}, for the default range and for all years`, async ({ browser }) => {
      const context = await browser.newContext();
      await storeTheme(context, theme);
      const page = await context.newPage();
      await page.goto(PAGE);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-ready'));
      const ids = (r: { violations: { id: string; nodes: { target: unknown[] }[] }[] }) => r.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(' ')).join(', ')}`);
      expect(ids(await new AxeBuilder({ page }).withTags(TAGS).analyze())).toEqual([]);
      if (await hasData(page)) {
        await page.locator('input[name="rates-range"][value="all"]').check();
        expect(ids(await new AxeBuilder({ page }).withTags(TAGS).analyze())).toEqual([]);
      }
      await context.close();
    });
  }

  test('a 320 px screen never scrolls sideways, in any range', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
    const page = await context.newPage();
    await page.goto(PAGE);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (await hasData(page)) {
      for (const r of ['1y', '10y', 'all']) {
        await page.locator(`input[name="rates-range"][value="${r}"]`).check();
        expect(await overflow(page), r).toBeLessThanOrEqual(0);
      }
    }
    await context.close();
  });

  test('reflows at 200 and 400 percent zoom, with and without JavaScript', async ({ browser }) => {
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, javaScriptEnabled });
      const page = await context.newPage();
      await page.setViewportSize({ width: 640, height: 400 });
      await page.goto(PAGE);
      expect(await overflow(page), `200 percent, JavaScript ${javaScriptEnabled}`).toBeLessThanOrEqual(0);
      await page.setViewportSize({ width: 320, height: 200 });
      await page.goto(PAGE);
      expect(await overflow(page), `400 percent, JavaScript ${javaScriptEnabled}`).toBeLessThanOrEqual(0);
      await context.close();
    }
  });

  test('makes no requests to other origins, logs no errors and sets no cookies', async ({ page, baseURL }) => {
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
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    if (await hasData(page)) await page.locator('input[name="rates-range"][value="all"]').check();
    expect([...origins]).toEqual([new URL(baseURL ?? '').origin]);
    expect(errors).toEqual([]);
    expect(violations).toEqual([]);
    expect(await page.context().cookies()).toEqual([]);
  });
});

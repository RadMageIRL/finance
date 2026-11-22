// The Money Supply Tracker (/finance/data/money-stock/) on the built site. Data tests need a
// build with the appendix B fixture root (ECON_DIR=local/econ-fixture/live, test data, never a
// publication); a build without a dataset runs only the checks of the unavailable state.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, ECON_BUILD, HELD, storeTheme, url } from './helpers';

// Held as in production (DATA_PAGES not on): the data pages are not built; tests/e2e/data-held.spec.ts
// checks that instead.
test.skip(HELD, 'the data pages are held in this build');

const PATH = 'data/money-stock/';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function hasData(page: Page): Promise<boolean> {
  return (await page.locator('[data-money-panel]').count()) > 0;
}

test.describe('money supply tracker: accessibility and layout', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`no axe violations in the ${theme} theme, for both adjustments`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: theme });
      await storeTheme(context, theme);
      const page = await context.newPage();
      await page.goto(url(PATH));
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-ready'));
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);
      expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      if (await hasData(page)) {
        await page.locator('input[name="money-adjustment"][value="nsa"]').check();
        await expect(page.locator('[data-money-panel="nsa"]')).toBeVisible();
        expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => v.id)).toEqual([]);
      }
      await context.close();
    });
  }

  // axe needs script, so the layout without JavaScript is reproduced by removing what the head
  // script adds (the js class and the theme attribute): both adjustments show, the switch hides.
  test('no axe violations in the layout without JavaScript', async ({ page }) => {
    await page.goto(url(PATH));
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-ready'));
    await page.evaluate(() => {
      document.documentElement.classList.remove('js');
      document.documentElement.removeAttribute('data-theme');
    });
    if (await hasData(page)) {
      await expect(page.locator('[data-money-panel="nsa"]')).toBeVisible();
      await expect(page.locator('.money-switch')).toBeHidden();
    }
    expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => v.id)).toEqual([]);
  });

  for (const javaScriptEnabled of [true, false]) {
    test(`no horizontal scrolling at 320 px (JavaScript ${javaScriptEnabled ? 'on' : 'off'})`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 320, height: 640 }, javaScriptEnabled });
      const page = await context.newPage();
      await page.goto(url(PATH));
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await context.close();
    });
  }

  test('reflows at 200 and 400 percent zoom', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(url(PATH));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 320, height: 200 });
    await page.goto(url(PATH));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.locator('[data-menu-open]')).toBeVisible();
    await context.close();
  });
});

test.describe('money supply tracker: privacy and integrity', () => {
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
    await page.goto(url(PATH), { waitUntil: 'networkidle' });
    if (await hasData(page)) {
      await page.locator('input[name="money-adjustment"][value="nsa"]').check();
      await page.locator('input[name="money-adjustment"][value="sa"]').check();
    }
    expect([...origins]).toEqual([new URL(baseURL ?? 'http://127.0.0.1:4329').origin]);
    expect(errors).toEqual([]);
    expect(violations).toEqual([]);
    expect(await page.context().cookies()).toEqual([]);
  });
});

test.describe('money supply tracker: content', () => {
  test('states that money supply growth is not inflation, and never equates them', async ({ page }) => {
    await page.goto(url(PATH));
    await expect(page.locator('h1')).toHaveText('Money Supply Tracker');
    await expect(page.locator('#money-inflation')).toHaveText('Money supply growth is not inflation');
    const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('A change in M1 or M2 is not a price index and is not an inflation rate.');
    expect(text).not.toMatch(/money (supply|stock) (growth )?(is|means|equals|causes|drives) (the )?inflation/i);
    expect(text).not.toMatch(/inflation (is|equals|means) (the )?(growth|increase) (of|in) (the )?money/i);
    await expect(page.locator(`a[href="${url('learn/what-is-money/')}"]`).first()).toBeVisible();
    await expect(page.locator(`a[href="${url('learn/how-banks-create-money/')}"]`).first()).toBeVisible();
    const schema = await page.locator('script[type="application/ld+json"]').first().textContent();
    const data = JSON.parse(schema ?? '{}');
    expect(data['@type']).toBe('Dataset');
    expect(data.creator?.name).toBe('Board of Governors of the Federal Reserve System');
    expect(data.publisher?.name).toBe('RadMage Labs');
  });

  test('labels every computed figure with its formula and states the May 2020 break', async ({ page }) => {
    await page.goto(url(PATH));
    test.skip(!(await hasData(page)), 'this build has no dataset');
    const sa = page.locator('[data-money-panel="sa"]');
    await expect(sa.locator('.data-headline')).toHaveCount(2);
    const figures = sa.locator('.data-computed');
    await expect(figures).toHaveCount(8);
    for (const text of await figures.allInnerTexts()) expect(text).toContain('Computed by RadMage Finance');
    // Growing or shrinking is always in words.
    const tags = await sa.locator('.money-direction__tag').allInnerTexts();
    expect(tags.length).toBe(4);
    for (const t of tags) expect(['Grew', 'Shrank', 'Unchanged', 'Not computed']).toContain(t.trim());
    // M1 ten years back crosses the May 2020 definition change in the fixture.
    await expect(page.locator('#money-compare-sa-m1 tbody tr').nth(2)).toContainText('Not computed (definition change)');
    await expect(page.locator('[data-break="2020-05"]')).toContainText('savings deposits');
    await expect(page.locator('#money-recent-sa-m1 tbody tr').first()).toContainText('(subject to revision)');
  });
});

test.describe('money supply tracker: without JavaScript', () => {
  test('shows both adjustments, the 24-month tables and the downloads, newest first', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(url(PATH));
    if (!(await hasData(page))) {
      await expect(page.locator('[data-state="unavailable"]')).toBeVisible();
      await expect(page.locator('#money-unavailable')).toBeVisible();
      await context.close();
      return;
    }
    // The stamp: test data in the fixture build, the current dataset in a release build.
    await expect(page.locator(`[data-state="${ECON_BUILD === 'release' ? 'current' : 'fixture'}"]`)).toBeVisible();
    await expect(page.locator('.money-switch')).toBeHidden();
    await expect(page.locator('.money-nojs')).toBeVisible();
    for (const adj of ['sa', 'nsa']) {
      await expect(page.locator(`[data-money-panel="${adj}"]`)).toBeVisible();
      for (const m of ['m1', 'm2']) await expect(page.locator(`#money-recent-${adj}-${m} tbody tr`)).toHaveCount(24);
    }
    const links = page.locator('.money-downloads a[download]');
    // Fixture: one segment and two change logs (CSV and JSON) for each of the four series. The
    // release rehearsal's dataset has no money changes recorded yet: one segment each.
    expect(await links.count()).toBe(ECON_BUILD === 'release' ? 4 : 12);
    const first = await links.first().getAttribute('href');
    expect(first).toMatch(/^\/finance\/data\/econ\/series\/m1-sa\/all\/[0-9a-f]{16}\.csv$/);
    await expect(page.locator('#money-revisions')).toBeVisible();
    await expect(page.locator('.data-source')).toBeVisible();
    await context.close();
  });
});

test.describe('money supply tracker: the adjustment switch', () => {
  test('works from the keyboard and shows one adjustment at a time', async ({ page }) => {
    await page.goto(url(PATH));
    test.skip(!(await hasData(page)), 'this build has no dataset');
    const sa = page.locator('[data-money-panel="sa"]');
    const nsa = page.locator('[data-money-panel="nsa"]');
    await expect(sa).toBeVisible();
    await expect(nsa).toBeHidden();
    await expect(page.locator('.money-nojs')).toBeHidden();
    const saRadio = page.locator('input[name="money-adjustment"][value="sa"]');
    const nsaRadio = page.locator('input[name="money-adjustment"][value="nsa"]');
    await expect(saRadio).toBeChecked();
    // Reach the group with Tab from the element before it, then move with the arrow keys.
    await page.locator('#money-data').evaluate((h) => {
      h.setAttribute('tabindex', '-1');
      (h as HTMLElement).focus();
    });
    let reached = false;
    for (let i = 0; i < 10 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await saRadio.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    await page.keyboard.press('ArrowDown');
    await expect(nsaRadio).toBeChecked();
    await expect(nsaRadio).toBeFocused();
    await expect(nsa).toBeVisible();
    await expect(sa).toBeHidden();
    await expect(page.locator('[data-money-status]')).toHaveText('Showing not seasonally adjusted figures.');
    await page.keyboard.press('ArrowUp');
    await expect(saRadio).toBeChecked();
    await expect(sa).toBeVisible();
    await expect(nsa).toBeHidden();
    await expect(page.locator('[data-money-status]')).toHaveText('Showing seasonally adjusted figures.');
  });
});

// The shared dashboard experience (brief Q, agent 4): the overview, the stamp and its states,
// status at view time, the newer-data check, the chart's keyboard and pointer reading, the range
// switch, navigation (decision D15) and the no-JavaScript page. Run against a build with the
// appendix B fixture root (ECON_DIR=local/econ-fixture/live; test data, never a publication), or
// with ECON_BUILD=none against a build without a dataset, where only the unavailable tests run.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { collectErrors, ECON_BUILD, HELD, storeTheme, url } from './helpers';

// Held as in production (DATA_PAGES not on): the data pages are not built; tests/e2e/data-held.spec.ts
// checks that instead.
test.skip(HELD, 'the data pages are held in this build');

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const NONE = process.env.ECON_BUILD === 'none';
const FIXTURE_MANIFEST = 'local/econ-fixture/live/manifest.json';
const MANIFEST_PATH = '/finance/data/econ/manifest.json';

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The browser's own line for a failed request (not page code): Chromium logs it for any 4xx or failed load. */
const isBrowserNetworkLine = (text: string) => /^console: Failed to load resource/.test(text);

test.describe('with the fixture dataset', () => {
  // A release build (ECON_BUILD=release) has other values; tests/e2e/data-release.spec.ts checks it.
  test.skip(ECON_BUILD !== 'fixture', 'needs a build with the fixture dataset');

  test.describe('overview', () => {
    test('shows the five indicators straight from the manifest, labeled observed or derived', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-11-21T12:00:00Z'));
      await page.goto(url('data/'));
      await expect(page.locator('h1')).toHaveText('Economic Conditions');
      const cards = page.locator('.data-card');
      await expect(cards).toHaveCount(5);
      await expect(cards.locator('.data-headline__value')).toHaveText(['3.88 percent', '3.75 to 4.00 percent', '$20,073.6 billion', '$23,413.9 billion', '$40,626,506,856,903.25']);
      await expect(page.locator('[data-indicator="fomc-target"] .data-kind')).toHaveText('Derived by RadMage Finance');
      await expect(page.locator('[data-indicator="effr"] .data-kind')).toHaveText('As published');
      await expect(page.locator('[data-indicator="effr"]')).toContainText("Publication day by the New York Fed's schedule: November 19, 2026");
      await expect(page.locator('[data-indicator="m1-sa"]')).toContainText('Released in the H.6 release of November 24, 2026');
      await expect(page.locator('[data-indicator="debt-total"]')).toContainText('First seen by RadMage Finance on November 24, 2026 (Eastern Time date)');
      // Each value with its retrieval time (conventions 16).
      await expect(page.locator('[data-indicator="debt-total"] .data-headline')).toContainText('Retrieved November 24, 2026 at 22:17 UTC');
      await expect(page.locator('[data-indicator="effr"] .data-headline')).toContainText('Retrieved November 19, 2026 at 22:17 UTC');
      // Test data is labeled as such, with the as-of stamp.
      await expect(page.locator('[data-notice="fixture"]')).toContainText('It is not a publication');
      await expect(page.locator('.data-stamp__asof')).toHaveText('As of the snapshot of November 25, 2026 at 15:17 UTC (20261125T151700Z).');
      // Links to the dashboards, the lessons and the calculators.
      for (const path of ['data/federal-funds-rate/', 'data/money-stock/', 'data/public-debt/', 'learn/what-is-money/', 'learn/how-banks-create-money/', 'learn/how-money-flows/', 'calculators/']) {
        expect(await page.locator(`main a[href="/finance/${path}"]`).count(), path).toBeGreaterThan(0);
      }
      await expect(page.locator('.data-source')).toContainText('Source: Board of Governors of the Federal Reserve System, H.6 Money Stock Measures.');
      await expect(page.locator('.data-nav a[aria-current="page"]')).toHaveText('Overview');
    });

    test('computes each status again with the device clock and shows the stale notice only then', async ({ browser }) => {
      for (const [now, fomc, debt, staleShown] of [
        ['2026-11-21T12:00:00Z', 'Up to date', 'Up to date', false],
        ['2026-11-26T09:00:00Z', 'May be out of date', 'Update pending', true],
        ['2026-12-02T00:00:00Z', 'May be out of date', 'May be out of date', true],
      ] as const) {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.clock.setFixedTime(new Date(now));
        await page.goto(url('data/'));
        await expect(page.locator('[data-status-of="fomc-target"] [data-status-label]'), now).toHaveText(fomc);
        await expect(page.locator('[data-status-of="debt-total"] [data-status-label]'), now).toHaveText(debt);
        // A rollback pauses EFFR updates whatever the clock says.
        await expect(page.locator('[data-status-of="effr"] [data-status-label]')).toHaveText('Updates paused');
        await expect(page.locator('[data-notice-stale]'), now).toBeVisible({ visible: staleShown });
        await context.close();
      }
    });

    test('words a missed deadline before the data counts as stale', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-11-27T00:00:00Z'));
      await page.goto(url('data/'));
      await expect(page.locator('[data-status-of="debt-total"] [data-status-text]')).toHaveText('Update pending: the next value was expected by November 26, 2026 at 08:15 UTC and is not in this data yet.');
    });

    test('never asks for data in a build without a verified release', async ({ page }) => {
      const asked: string[] = [];
      page.on('request', (r) => {
        if (r.url().includes('/data/econ/')) asked.push(r.url());
      });
      const errors = collectErrors(page);
      await page.goto(url('data/'), { waitUntil: 'networkidle' });
      await expect(page.locator('[data-econ-stamp]')).toHaveAttribute('data-check', 'off');
      expect(asked).toEqual([]);
      expect(errors).toEqual([]);
    });
  });

  test.describe('the newer-data check (a release build, simulated)', () => {
    // The fixture build never checks; these tests turn the check on in the served page, as a
    // build from a verified release would have it, and answer the manifest by route.
    const asRelease = async (page: Page) => {
      await page.route(/\/finance\/data\/$/, async (route) => {
        const response = await route.fetch();
        const body = (await response.text()).replace('data-check="off"', 'data-check="release"');
        await route.fulfill({ response, body });
      });
    };
    const manifest = () => JSON.parse(readFileSync(FIXTURE_MANIFEST, 'utf8')) as { snapshot: { id: string } };

    for (const [name, answer, outcome, text] of [
      ['the same snapshot', 'same', 'same', ''],
      ['a newer snapshot', 'newer', 'newer', 'Newer data is available. Reload the page to see it.'],
      ['an earlier snapshot', 'older', 'changed', 'The published data has changed since this page was built. Reload the page to see it.'],
      ['a 404', '404', 'failed', 'Could not check for newer data. This page shows the data it was built with.'],
      ['a failed request', 'abort', 'failed', 'Could not check for newer data. This page shows the data it was built with.'],
      ['a body that is not a manifest', 'junk', 'failed', 'Could not check for newer data. This page shows the data it was built with.'],
    ] as const) {
      test(`handles ${name} with no request elsewhere and no error of its own`, async ({ page, baseURL }) => {
        await asRelease(page);
        const requests: { url: string; method: string }[] = [];
        page.on('request', (r) => requests.push({ url: r.url(), method: r.method() }));
        await page.route(`**${MANIFEST_PATH}`, async (route) => {
          if (answer === 'abort') return route.abort();
          if (answer === '404') return route.fulfill({ status: 404, body: 'Not found' });
          if (answer === 'junk') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"schema":1}' });
          const m = manifest();
          if (answer === 'newer') m.snapshot.id = '20261126T001700Z';
          if (answer === 'older') m.snapshot.id = '20261124T151700Z';
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(m) });
        });
        const errors = collectErrors(page);
        await page.goto(url('data/'), { waitUntil: 'networkidle' });
        const stamp = page.locator('[data-econ-stamp]');
        await expect(stamp).toHaveAttribute('data-refresh', outcome);
        await expect(page.locator('[data-refresh-status]')).toHaveText(text);
        // The page is not redrawn: the build-time values stay.
        await expect(page.locator('[data-indicator="effr"] .data-headline__value')).toHaveText('3.88 percent');
        // One same-origin GET of the manifest, and nothing from any other origin.
        const origin = new URL(baseURL ?? page.url()).origin;
        expect(requests.filter((r) => r.url.includes('/data/econ/')).map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([`GET ${MANIFEST_PATH}`]);
        expect([...new Set(requests.map((r) => new URL(r.url).origin))]).toEqual([origin]);
        // No console error from the page's code. A failed request is logged by the browser
        // itself ("Failed to load resource"), which no page code can prevent.
        expect(errors.filter((e) => !isBrowserNetworkLine(e))).toEqual([]);
        if (outcome !== 'failed' || answer === 'junk') expect(errors).toEqual([]);
      });
    }
  });

  test.describe('chart', () => {
    test('takes focus and reads points with the arrow keys, Page Up and Page Down, Home and End', async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(url('design-system/'));
      const box = page.locator('#ds-chart-rates [data-chart-box]');
      const readout = page.locator('#ds-chart-rates [data-readout]');
      await expect(box).toHaveAttribute('tabindex', '0');
      await expect(readout).toHaveAttribute('role', 'status');
      await expect(readout).toHaveAttribute('aria-live', 'polite');
      await box.focus();
      await page.keyboard.press('End');
      await expect(readout.locator('strong')).toHaveText('November 18, 2026');
      await expect(readout).toContainText('3.88 percent Market rate (EFFR)');
      await expect(readout).toContainText('3.75 to 4.00 percent Policy target range, derived');
      await page.keyboard.press('Home');
      await expect(readout.locator('strong')).toHaveText('January 2, 2024');
      // Three years hold more points than the reading columns (rule C6): Right moves to the next
      // reading point, a few business days on.
      await page.keyboard.press('ArrowRight');
      await expect(readout.locator('strong')).toHaveText(/^January ([3-9]|[12]\d|3[01]), 2024$/);
      await page.keyboard.press('ArrowLeft');
      await expect(readout.locator('strong')).toHaveText('January 2, 2024');
      await page.keyboard.press('PageDown');
      await expect(readout.locator('strong')).toHaveText(/^February \d+, 2024$/);
      await page.keyboard.press('PageUp');
      await expect(readout.locator('strong')).toHaveText('January 2, 2024');
      const cursor = page.locator('#ds-chart-rates .dchart__cursor');
      await expect(cursor).toHaveAttribute('visibility', 'visible');
      await page.keyboard.press('Escape');
      await expect(cursor).toHaveAttribute('visibility', 'hidden');
      // No trap: Tab moves on.
      await page.keyboard.press('Tab');
      await expect(box).not.toBeFocused();
      expect(errors).toEqual([]);
    });

    test('reads the nearest point under the pointer', async ({ page }) => {
      await page.goto(url('design-system/'));
      const svg = page.locator('#ds-chart-money .dchart__svg');
      await svg.scrollIntoViewIfNeeded();
      const box = (await svg.boundingBox())!;
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
      const readout = page.locator('#ds-chart-money [data-readout]');
      await expect(readout.locator('strong')).toHaveText(/2026$/);
      await expect(readout).toContainText('M1 money stock, seasonally adjusted');
    });

    test('draws the observed and derived marks apart without color, with an HTML legend and the captions', async ({ page }) => {
      await page.goto(url('design-system/'));
      const chart = page.locator('#ds-chart-rates');
      await expect(chart.locator('.dchart-legend li')).toHaveCount(2);
      await expect(chart.locator('.dchart-legend .data-kind')).toHaveText(['As published', 'Derived by RadMage Finance']);
      const dash = async (sel: string) => chart.locator(sel).first().evaluate((el) => getComputedStyle(el).strokeDasharray);
      expect(await dash('.dchart__svg .dchart__line.is-observed')).toBe('none');
      expect(await dash('.dchart__svg .dchart__edge.is-derived')).not.toBe('none');
      await expect(chart).toContainText('Values as currently published, including later revisions.');
      await expect(chart).toContainText('Drawn at screen resolution; every value is in the table and CSV.');
      await expect(chart.locator('svg[role="img"] desc')).toContainText('Market rate (EFFR) (observed): January 2, 2024 to November 18, 2026. Latest 3.88 percent (November 18, 2026).');
      // Lone points between gaps are markers, never joined.
      await expect(page.locator('#ds-chart-debt .dchart__dot')).toHaveCount(2);
    });

    test('fits 320 px and reflows at 400 percent zoom', async ({ browser }) => {
      for (const viewport of [{ width: 320, height: 640 }, { width: 320, height: 200 }]) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        for (const path of ['data/', 'design-system/']) {
          await page.goto(url(path));
          expect(await overflow(page), `${path} at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(0);
        }
        // Tables stack into labeled lines rather than scroll.
        await page.goto(url('design-system/'));
        const cell = page.locator('#ds-chart-rates-table tbody td').first();
        expect(await cell.evaluate((el) => getComputedStyle(el, '::before').content)).toContain('Percent');
        await context.close();
      }
    });
  });

  test.describe('accessibility', () => {
    for (const theme of ['dark', 'light']) {
      test(`${theme}: the overview and the components have no axe violations, also while a chart is read`, async ({ browser }) => {
        for (const width of [1280, 390]) {
          const context = await browser.newContext({ viewport: { width, height: 900 } });
          await storeTheme(context, theme);
          const page = await context.newPage();
          for (const path of ['data/', 'design-system/']) {
            await page.goto(url(path));
            await page.waitForFunction(() => document.documentElement.hasAttribute('data-ready'));
            if (path === 'design-system/') {
              await page.locator('#ds-chart-rates [data-chart-box]').focus();
              await page.keyboard.press('End');
            }
            const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
            expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), `${path} ${width}`).toEqual([]);
          }
          await context.close();
        }
      });
    }
  });

  test.describe('without JavaScript', () => {
    test('shows every value with its status as of the snapshot, the static chart and the tables', async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(url('data/'));
      await expect(page.locator('.data-card .data-headline__value')).toHaveCount(5);
      await expect(page.locator('[data-stamp-clock]')).toHaveText("Each status is as of that snapshot. With JavaScript on, this page also checks each status against your device's clock.");
      await expect(page.locator('[data-status-of="m1-sa"] [data-status-text]')).toHaveText('Up to date. Next value expected by December 23, 2026 at 00:00 UTC.');
      await expect(page.locator('[data-notice-stale]')).toBeHidden();
      await page.goto(url('design-system/'));
      const chart = page.locator('#ds-chart-rates');
      await expect(chart.locator('.dchart__svg')).toBeVisible();
      await expect(chart.locator('[data-chart-box]')).not.toHaveAttribute('tabindex', /./);
      await expect(chart.locator('[data-readout]')).toBeHidden();
      await expect(page.locator('#ds-chart-rates-table tbody tr')).toHaveCount(10);
      // The switch needs a script, so it is hidden; the default panel shows.
      await expect(page.locator('fieldset.data-switch')).toBeHidden();
      await expect(page.locator('#ds-table-short')).toBeVisible();
      await expect(page.locator('#ds-table-long')).toBeHidden();
      await context.close();
    });
  });

  test('the range switch shows the chosen panel', async ({ page }) => {
    await page.goto(url('design-system/'));
    await expect(page.locator('#ds-table-long')).toBeHidden();
    await page.getByRole('radio', { name: 'Latest 10' }).check();
    await expect(page.locator('#ds-table-long')).toBeVisible();
    await expect(page.locator('#ds-table-short')).toBeHidden();
  });

  test('the data pages make no requests to other origins and log no errors', async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? 'http://127.0.0.1').origin;
    for (const path of ['data/', 'data/federal-funds-rate/', 'data/money-stock/', 'data/public-debt/', 'design-system/']) {
      const origins = new Set<string>();
      const listener = (r: { url: () => string }) => {
        const target = new URL(r.url());
        if (target.protocol !== 'data:') origins.add(target.origin);
      };
      page.on('request', listener);
      const errors = collectErrors(page);
      await page.goto(url(path), { waitUntil: 'networkidle' });
      expect([...origins], path).toEqual([origin]);
      expect(errors, path).toEqual([]);
      page.off('request', listener);
    }
  });
});

test.describe('navigation (decision D15)', () => {
  test('the More menu lists Economic conditions apart from the reference pages, and marks it current on data pages', async ({ page }) => {
    await page.goto(url(''));
    await page.locator('.more-menu > summary').click();
    const link = page.locator('.more-menu__data a');
    await expect(link).toHaveText('Economic conditions');
    await expect(link).toHaveAttribute('href', '/finance/data/');
    await link.click();
    await expect(page).toHaveURL(/\/finance\/data\/$/);
    await expect(page.locator('.more-menu > summary')).toHaveClass(/is-current/);
    await expect(page.locator('.more-menu__data a')).toHaveAttribute('aria-current', 'page');
    // The primary bar approved at G1a is unchanged.
    await expect(page.locator('.site-header .site-nav > ul > li > a')).toHaveText(['Home', 'News', 'Learn', 'Calculators']);
  });

  test('the phone menu has the same entry', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(url('data/'));
    await page.locator('[data-menu-open]').click();
    await expect(page.locator('#site-menu .menu-nav--data a')).toHaveText('Economic conditions');
    await expect(page.locator('#site-menu .menu-nav--data a')).toHaveAttribute('aria-current', 'page');
    await context.close();
  });

  test('Home and the lessons link to the data; no calculator does (decision D14)', async ({ page }) => {
    await page.goto(url(''));
    for (const path of ['data/', 'data/federal-funds-rate/', 'data/money-stock/', 'data/public-debt/']) {
      expect(await page.locator(`main a[href="/finance/${path}"]`).count(), path).toBeGreaterThan(0);
    }
    for (const [lesson, target] of [
      ['learn/how-banks-create-money/', 'data/federal-funds-rate/'],
      ['learn/what-is-money/', 'data/money-stock/'],
      ['learn/how-money-flows/', 'data/public-debt/'],
    ] as const) {
      await page.goto(url(lesson));
      await expect(page.locator(`#related ~ ul a[href="/finance/${target}"]`), lesson).toHaveCount(1);
    }
    for (const calculator of ['compound-interest/', 'apr-apy/', 'savings-growth/', 'amortization/', 'loan-payoff/']) {
      await page.goto(url(`calculators/${calculator}`));
      await expect(page.locator('main a[href^="/finance/data/"]'), calculator).toHaveCount(0);
    }
  });

  test('the dashboards link to each other and back to the lessons and calculators', async ({ page }) => {
    await page.goto(url('data/'));
    await expect(page.locator('.data-nav a')).toHaveText(['Overview', 'Interest rates', 'Money supply', 'National debt']);
    await expect(page.locator('.data-related a').first()).toHaveAttribute('href', '/finance/learn/what-is-money/');
    await expect(page.locator('.data-related a[href="/finance/calculators/"]')).toHaveCount(1);
  });
});

test.describe('without a dataset in the build', () => {
  test.skip(!NONE, 'needs a build without ECON_DIR (ECON_BUILD=none)');

  test('the overview shows the unavailable state, asks for no data and logs no errors', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/data/econ/')) asked.push(r.url());
    });
    const errors = collectErrors(page);
    await page.goto(url('data/'), { waitUntil: 'networkidle' });
    await expect(page.locator('[data-notice="unavailable"]')).toContainText('Data not available');
    await expect(page.locator('.data-card')).toHaveCount(0);
    await expect(page.locator('.data-stamp__asof')).toHaveCount(0);
    await expect(page.locator('.data-nav a')).toHaveCount(4);
    expect(asked).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the design-system page shows the states that need no data', async ({ page }) => {
    await page.goto(url('design-system/'));
    const section = page.locator('section[aria-labelledby="ds-data"]');
    await expect(section.locator('[data-econ-stamp] [data-notice="unavailable"]')).toBeVisible();
    await expect(section.locator('.dchart')).toHaveCount(0);
  });

  for (const theme of ['dark', 'light']) {
    test(`${theme}: the unavailable overview has no axe violations`, async ({ browser }) => {
      const context = await browser.newContext();
      await storeTheme(context, theme);
      const page = await context.newPage();
      await page.goto(url('data/'));
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-ready'));
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
      await context.close();
    });
  }
});

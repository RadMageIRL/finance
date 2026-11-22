// The economic data pages held as in production (owner brief R, option (b); rule D5 of
// src/lib/data/shell-dist.ts): built without DATA_PAGES=on and run with ECON_BUILD=held, the site
// is the live Finance site as it was. No data page exists, and no menu entry, link, section, style
// or request points at one. Every other build skips these tests.
import { expect, test } from '@playwright/test';
import { DATA_PAGE_URLS, HELD, url } from './helpers';

test.skip(!HELD, 'needs a build with the data pages held (ECON_BUILD=held)');

// The pages that link to the data pages when they are built: Home, the three lessons, the
// design-system review page, and, through the header, every page.
const LINKING = ['', 'learn/what-is-money/', 'learn/how-banks-create-money/', 'learn/how-money-flows/', 'design-system/', 'calculators/', 'calculators/apr-apy/'];

test.describe('the data pages held', () => {
  for (const path of DATA_PAGE_URLS) {
    test(`${path} is not built (404)`, async ({ page }) => {
      const response = await page.goto(url(path));
      expect(response?.status()).toBe(404);
    });
  }

  for (const path of LINKING) {
    test(`${path || 'Home'} has no menu entry, link, section or request for the data pages`, async ({ page }) => {
      const asked: string[] = [];
      page.on('request', (r) => {
        if (new URL(r.url()).pathname.startsWith(url('data/'))) asked.push(r.url());
      });
      await page.goto(url(path), { waitUntil: 'networkidle' });
      await expect(page.locator('a[href^="/finance/data/"]')).toHaveCount(0);
      await expect(page.locator('#menu-data-title, .more-menu__data, #data-title, #ds-data')).toHaveCount(0);
      for (const name of ['Economic conditions', 'Economic Conditions', 'Economic data']) await expect(page.getByText(name, { exact: true })).toHaveCount(0);
      expect(asked).toEqual([]);
    });
  }
});

// The change logs of the three dashboards (owner brief R item 6; design P28 6.4): every detection
// date is an Eastern Time date and its column says so, while technical times on the same pages
// stay in UTC and say so. Needs the pages built with the fixture dataset, whose logs have rows.
import { expect, test } from '@playwright/test';
import { ECON_BUILD, url } from './helpers';

test.skip(ECON_BUILD !== 'fixture', 'needs the data pages built with the fixture dataset');

const PAGES = ['data/federal-funds-rate/', 'data/money-stock/', 'data/public-debt/'];
const DAY = /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}$/;

test.describe('change logs', () => {
  for (const path of PAGES) {
    test(`${path} labels detection dates as Eastern Time dates and technical times as UTC`, async ({ page }) => {
      await page.goto(url(path));
      const logs = page.locator('table').filter({ has: page.locator('caption', { hasText: 'changes we observed between our collections' }) });
      expect(await logs.count()).toBeGreaterThan(0);
      for (const log of await logs.all()) {
        await expect(log.locator('caption')).toContainText('Detection dates, and the dates in the basis, are Eastern Time dates; snapshot ids are UTC times.');
        await expect(log.locator('thead th').first()).toHaveText('Detected (Eastern Time date)');
        for (const cell of await log.locator('tbody tr > :first-child').all()) expect((await cell.innerText()).trim()).toMatch(DAY);
      }
      await expect(page.locator('main')).toContainText(/\d{2}:\d{2} UTC/);
    });
  }
});

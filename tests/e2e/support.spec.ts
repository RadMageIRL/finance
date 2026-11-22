// Share, feedback and Buy Me a Coffee (SupportLinks.astro), as FFXI Timer has them: in the footer of
// every page and on About. Share copies the canonical radmagelabs.com address when the device has no
// share sheet, and is hidden without JavaScript.
import { expect, test } from '@playwright/test';
import { collectErrors, PAGES, url } from './helpers';

const COFFEE = 'https://buymeacoffee.com/radmageirl';
const ISSUES = 'https://github.com/RadMageIRL/finance/issues';

test('every page has share, feedback and buy me a coffee in the footer', async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(url(path));
    const links = page.locator('.site-footer .support-links');
    await expect(links.locator('[data-share]')).toBeVisible();
    await expect(links.getByRole('link', { name: 'Feedback' })).toHaveAttribute('href', ISSUES);
    await expect(links.getByRole('link', { name: 'Buy me a coffee' })).toHaveAttribute('href', COFFEE);
    await expect(links.getByRole('link', { name: 'Buy me a coffee' })).toHaveAttribute('rel', 'noopener');
  }
});

test('share copies the canonical address of the page and says so', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
  const errors = collectErrors(page);
  await page.goto(url('calculators/compound-interest/'));
  await page.locator('.site-footer [data-share]').click();
  const want = 'https://radmagelabs.com/finance/calculators/compound-interest/';
  await expect(page.locator('.site-footer [data-share-status]')).toHaveText(`Link copied: ${want}`);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(want);
  expect(errors).toEqual([]);
});

test('about has a share and support section with the same links', async ({ page }) => {
  await page.goto(url('about/'));
  await expect(page.getByRole('heading', { name: 'Share and support' })).toBeVisible();
  await expect(page.locator('main .support-links').getByRole('link', { name: 'Buy me a coffee' })).toHaveAttribute('href', COFFEE);
});

test('without JavaScript the share button is hidden and the links remain', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(url(''));
  await expect(page.locator('.site-footer [data-share]')).toBeHidden();
  await expect(page.locator('.site-footer').getByRole('link', { name: 'Buy me a coffee' })).toBeVisible();
  await context.close();
});

import { expect, test } from '@playwright/test';
import { appliedTheme, collectErrors, firstPaintTheme, storeTheme, url, watchFirstPaint } from './helpers';

const DARK_BG = 'rgb(16, 21, 31)';
const LIGHT_BG = 'rgb(246, 247, 249)';

const bodyBackground = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe('theme', () => {
  test('defaults to Dark with nothing stored, even when the system prefers light', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    await watchFirstPaint(context);
    const page = await context.newPage();
    const errors = collectErrors(page);
    await page.goto(url(''));
    expect(await firstPaintTheme(page)).toBe('dark');
    expect(await bodyBackground(page)).toBe(DARK_BG);
    await expect(page.locator('input[name="theme-header"][value="dark"]')).toBeChecked();
    expect(errors).toEqual([]);
    await context.close();
  });

  for (const stored of ['light', 'dark'] as const) {
    test(`a stored ${stored} choice is applied before the body paints`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: stored === 'light' ? 'dark' : 'light' });
      await storeTheme(context, stored);
      await watchFirstPaint(context);
      const page = await context.newPage();
      await page.goto(url('about/'));
      expect(await firstPaintTheme(page)).toBe(stored);
      expect(await bodyBackground(page)).toBe(stored === 'light' ? LIGHT_BG : DARK_BG);
      await context.close();
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`System resolves to ${scheme} before the body paints when the OS prefers ${scheme}`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: scheme });
      await storeTheme(context, 'system');
      await watchFirstPaint(context);
      const page = await context.newPage();
      await page.goto(url(''));
      expect(await firstPaintTheme(page)).toBe(scheme);
      await expect(page.locator('input[name="theme-header"][value="system"]')).toBeChecked();
      await context.close();
    });
  }

  test('System follows an operating system change live, without a reload', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    await storeTheme(context, 'system');
    const page = await context.newPage();
    await page.goto(url(''));
    expect(await appliedTheme(page)).toBe('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => appliedTheme(page)).toBe('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => appliedTheme(page)).toBe('light');
    await context.close();
  });

  test('leaving System stops following the operating system', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(url(''));
    await page.locator('label:has(input[name="theme-header"][value="system"])').click();
    expect(await appliedTheme(page)).toBe('light');
    await page.locator('label:has(input[name="theme-header"][value="dark"])').click();
    expect(await appliedTheme(page)).toBe('dark');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await appliedTheme(page)).toBe('dark');
  });

  test('a choice is saved and survives a reload and a new page', async ({ browser }) => {
    const context = await browser.newContext();
    await watchFirstPaint(context);
    const page = await context.newPage();
    await page.goto(url(''));
    await page.locator('label:has(input[name="theme-header"][value="light"])').click();
    expect(await appliedTheme(page)).toBe('light');
    expect(await page.evaluate(() => localStorage.getItem('rmf-theme'))).toBe('light');
    await page.reload();
    expect(await firstPaintTheme(page)).toBe('light');
    await page.goto(url('methodology/'));
    expect(await firstPaintTheme(page)).toBe('light');
    await expect(page.locator('input[name="theme-header"][value="light"]')).toBeChecked();
    await context.close();
  });

  test('an unknown stored value falls back to Dark', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    await storeTheme(context, 'sepia');
    const page = await context.newPage();
    await page.goto(url(''));
    expect(await appliedTheme(page)).toBe('dark');
    await expect(page.locator('input[name="theme-header"][value="dark"]')).toBeChecked();
    await context.close();
  });

  test('blocked storage falls back to Dark and the control still works', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('Storage is disabled', 'SecurityError');
        },
      });
    });
    const page = await context.newPage();
    const errors = collectErrors(page);
    await page.goto(url(''));
    expect(await appliedTheme(page)).toBe('dark');
    await page.locator('label:has(input[name="theme-header"][value="light"])').click();
    expect(await appliedTheme(page)).toBe('light');
    expect(errors).toEqual([]);
    await context.close();
  });

  test('the theme control works from the keyboard', async ({ page }) => {
    await page.goto(url(''));
    await page.locator('input[name="theme-header"][value="dark"]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('input[name="theme-header"][value="light"]')).toBeChecked();
    expect(await appliedTheme(page)).toBe('light');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('input[name="theme-header"][value="system"]')).toBeChecked();
  });

  test('the header and menu controls stay in step', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(url(''));
    await page.locator('[data-menu-open]').click();
    await page.locator('label:has(input[name="theme-menu"][value="light"])').click();
    expect(await appliedTheme(page)).toBe('light');
    await expect(page.locator('input[name="theme-header"][value="light"]')).toBeChecked();
    await context.close();
  });

  test('without JavaScript the site is dark and the theme control is hidden', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'light' });
    const page = await context.newPage();
    await page.goto(url(''));
    expect(await bodyBackground(page)).toBe(DARK_BG);
    await expect(page.locator('.site-header .theme-control')).toBeHidden();
    await expect(page.locator('.site-nav a', { hasText: 'Learn' })).toBeVisible();
    await context.close();
  });

  test('without JavaScript on a phone the navigation is still reachable', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 640 } });
    const page = await context.newPage();
    await page.goto(url(''));
    await expect(page.locator('.menu-button')).toBeHidden();
    for (const label of ['Learn', 'Calculators', 'About']) {
      await expect(page.locator('.site-nav a', { hasText: label })).toBeVisible();
    }
    await context.close();
  });
});

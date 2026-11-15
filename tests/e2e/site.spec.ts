import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PAGES, collectErrors, storeTheme, url } from './helpers';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// Dark, Light, and System resolved both ways.
const THEMES = [
  { name: 'Dark', stored: 'dark', scheme: 'light' },
  { name: 'Light', stored: 'light', scheme: 'dark' },
  { name: 'System (dark OS)', stored: 'system', scheme: 'dark' },
  { name: 'System (light OS)', stored: 'system', scheme: 'light' },
] as const;

test.describe('accessibility', () => {
  for (const theme of THEMES) {
    for (const path of PAGES) {
      test(`${theme.name}: /finance/${path} has no axe violations`, async ({ browser }) => {
        const context = await browser.newContext({ colorScheme: theme.scheme });
        await storeTheme(context, theme.stored);
        const page = await context.newPage();
        await page.goto(url(path));
        await page.waitForFunction(() => document.documentElement.hasAttribute('data-ready'));
        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
        await context.close();
      });
    }
  }

  test('the open mobile menu has no axe violations in either theme', async ({ browser }) => {
    for (const stored of ['dark', 'light']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await storeTheme(context, stored);
      const page = await context.newPage();
      await page.goto(url(''));
      await page.locator('[data-menu-open]').click();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).include('#site-menu').analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
      await context.close();
    }
  });
});

test.describe('layout', () => {
  for (const path of PAGES) {
    test(`/finance/${path} has no horizontal scrolling at 320 px`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
      const page = await context.newPage();
      await page.goto(url(path));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await context.close();
    });
  }

  test('every page reflows at 200 percent zoom (640 CSS px on a 1280 px screen)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 640, height: 400 } });
    const page = await context.newPage();
    for (const path of PAGES) {
      await page.goto(url(path));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
    await context.close();
  });

  test('pages reflow at 400 percent zoom (320 CSS px) with the menu available', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.setViewportSize({ width: 320, height: 200 });
    await page.goto(url('methodology/'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator('[data-menu-open]')).toBeVisible();
    await context.close();
  });

  test('desktop shows the primary navigation and marks the current section', async ({ page }) => {
    await page.goto(url('learn/'));
    const nav = page.locator('.site-header .site-nav');
    await expect(nav).toBeVisible();
    await expect(nav.locator('a[aria-current="page"]')).toHaveText('Learn');
    await expect(page.locator('[data-menu-open]')).toBeHidden();
  });

  test('the skip link moves focus to the main content', async ({ page }) => {
    await page.goto(url('about/'));
    await page.keyboard.press('Tab');
    const skip = page.locator('a.skip');
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('a missing page returns the 404 page', async ({ page }) => {
    const response = await page.goto(url('no-such-page/'));
    expect(response?.status()).toBe(404);
    await expect(page.locator('h1')).toHaveText('Page not found');
  });
});

test.describe('mobile menu', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens, traps focus, closes on Escape, and returns focus', async ({ page }) => {
    await page.goto(url(''));
    const button = page.locator('[data-menu-open]');
    const dialog = page.locator('#site-menu');
    await expect(page.locator('.site-header .site-nav')).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');

    await button.click();
    await expect(dialog).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');

    // The modal dialog makes the page behind it inert. Tab past the last item moves focus to
    // the browser's own controls (seen here as <body>), then back to the first item: focus
    // must never land on page content behind the menu, and it must come back.
    const seen: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab');
      const where = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return 'browser';
        return document.querySelector('#site-menu')?.contains(active) ? 'menu' : `page:${active.outerHTML.slice(0, 60)}`;
      });
      expect(where, `Tab ${i + 1} focused content behind the menu`).not.toMatch(/^page:/);
      seen.push(where);
    }
    const wrapped = seen.indexOf('browser');
    expect(wrapped, 'focus never wrapped').toBeGreaterThan(0);
    expect(seen.slice(wrapped + 1)).toContain('menu');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('the close button and a backdrop click both close it', async ({ page }) => {
    await page.goto(url(''));
    const dialog = page.locator('#site-menu');
    await page.locator('[data-menu-open]').click();
    await page.locator('[data-menu-close]').click();
    await expect(dialog).toBeHidden();
    await page.locator('[data-menu-open]').click();
    await page.mouse.click(10, 400);
    await expect(dialog).toBeHidden();
  });

  test('menu links navigate and mark the current page', async ({ page }) => {
    await page.goto(url(''));
    await page.locator('[data-menu-open]').click();
    await page.locator('#site-menu a', { hasText: 'Calculators' }).click();
    await expect(page).toHaveURL(/\/finance\/calculators\/$/);
    await page.locator('[data-menu-open]').click();
    await expect(page.locator('#site-menu a[aria-current="page"]')).toHaveText('Calculators');
  });
});

test.describe('privacy and integrity', () => {
  for (const path of PAGES) {
    test(`/finance/${path} makes no requests to other origins and logs no errors`, async ({ page }) => {
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
      await page.goto(url(path), { waitUntil: 'networkidle' });
      expect([...origins]).toEqual(['http://127.0.0.1:4329']);
      expect(errors).toEqual([]);
      expect(violations).toEqual([]);
      const cookies = await page.context().cookies();
      expect(cookies).toEqual([]);
    });
  }
});

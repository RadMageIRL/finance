import type { BrowserContext, Page } from '@playwright/test';

export const BASE = '/finance/';

/**
 * The build the browser suite runs against (tools/check.mjs sets ECON_BUILD): `held`, the data
 * pages held as in production until they are approved to go live (DATA_PAGES not on; owner brief
 * R, option (b)); `none`, the pages built without a dataset (their unavailable state); `release`,
 * the pages built from a verified release as production builds them (the appendix J rehearsal of
 * tools/econ-release.mjs; owner brief V item 2); otherwise the pages built with the appendix B
 * fixture dataset.
 */
export const ECON_BUILD = process.env.ECON_BUILD ?? 'fixture';
export const HELD = ECON_BUILD === 'held';

/** The economic data overview and the three dashboards (brief Q; design P28 8.10). */
export const DATA_PAGE_URLS = ['data/', 'data/federal-funds-rate/', 'data/money-stock/', 'data/public-debt/'];

/** Every built page. The 404 page is reached through a missing address. */
export const PAGES = [
  '',
  'news/',
  'learn/',
  'learn/what-is-money/',
  'learn/how-banks-create-money/',
  'learn/how-money-flows/',
  'calculators/',
  'calculators/compound-interest/',
  'calculators/apr-apy/',
  'calculators/savings-growth/',
  'calculators/amortization/',
  'calculators/loan-payoff/',
  ...(HELD ? [] : DATA_PAGE_URLS),
  'about/',
  'methodology/',
  'sources/',
  'corrections/',
  'privacy/',
  'disclaimer/',
  'design-system/',
] as const;

export const url = (path: string) => BASE + path;

/** Stores a theme choice before any page script runs. */
export async function storeTheme(context: BrowserContext, value: string): Promise<void> {
  await context.addInitScript((v) => {
    try {
      window.localStorage.setItem('rmf-theme', v);
    } catch {
      // ignored
    }
  }, value);
}

/**
 * Records the theme attribute at the moment <body> is inserted, before any body content
 * can paint. Read it with firstPaintTheme().
 */
export async function watchFirstPaint(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const record = () => {
      if (document.body && !('__firstBodyTheme' in window)) {
        (window as unknown as Record<string, unknown>).__firstBodyTheme =
          document.documentElement.getAttribute('data-theme');
        observer.disconnect();
      }
    };
    const observer = new MutationObserver(record);
    observer.observe(document, { childList: true, subtree: true });
  });
}

export async function firstPaintTheme(page: Page): Promise<unknown> {
  return page.evaluate(() => (window as unknown as Record<string, unknown>).__firstBodyTheme);
}

export async function appliedTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

/** Collects page errors, console errors and CSP violations. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

// Which News pages are indexed (v0.3.0), shared by the pages (their robots meta) and astro.config
// (the sitemap), so the two always agree (dist-check). A News page is indexed when it shows at
// least one story: /finance/news/ when the news file has any, a category page when that category
// has any. With no news file, or an empty one, every News page is noindex and out of the sitemap.
import { existsSync, readFileSync } from 'node:fs';

export interface NewsIndexing {
  /** Category ids with at least one story; empty when the index page is not indexed either. */
  categories: Set<string>;
  /** The index page has stories. */
  any: boolean;
  /** The UTC date (YYYY-MM-DD) of the last successful collection, or null. */
  lastmod: string | null;
}

export function newsIndexing(env: Record<string, string | undefined> = process.env): NewsIndexing {
  const none: NewsIndexing = { categories: new Set(), any: false, lastmod: null };
  const file = env.NEWS_FILE;
  if (!file || !existsSync(file)) return none;
  try {
    const d = JSON.parse(readFileSync(file, 'utf8')) as { schema?: unknown; items?: unknown; last_success?: unknown };
    if (d?.schema !== 'rmf.news/1' || !Array.isArray(d.items)) return none;
    const items = (d.items as { url?: unknown; title?: unknown; categories?: unknown }[]).filter((i) => i && typeof i.url === 'string' && /^https?:\/\//.test(i.url) && typeof i.title === 'string' && i.title !== '');
    const categories = new Set<string>();
    for (const i of items) if (Array.isArray(i.categories)) for (const c of i.categories) if (typeof c === 'string') categories.add(c);
    const lastmod = typeof d.last_success === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(d.last_success) ? d.last_success.slice(0, 10) : null;
    return { categories, any: items.length > 0, lastmod };
  } catch {
    return none;
  }
}

/** Whether a News page (its path under /finance/, e.g. 'news/' or 'news/crypto/') is indexed. */
export function newsPageIndexed(path: string, n: NewsIndexing): boolean {
  if (path === 'news/') return n.any;
  const m = /^news\/([a-z-]+)\/$/.exec(path);
  return Boolean(m && n.any && n.categories.has(m[1]!));
}

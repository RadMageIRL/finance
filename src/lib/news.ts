// The news file the site build reads (v0.3.0): `NEWS_FILE`, written by tools/news/collect.mjs
// before the build. Without it, or with a damaged one, the News pages show that no stories have
// been collected; a news problem never fails the build. The file came from the network (the
// previous deployment plus the feeds), so it is checked again here: only http and https links
// and plain strings pass. Pages render every value as text.
import { existsSync, readFileSync } from 'node:fs';
import { NEWS_CATEGORIES } from './site';

export interface NewsSource {
  id: string;
  name: string;
  publisher: string;
  home: string;
  terms: string;
  last_attempt: string | null;
  last_success: string | null;
  last_error: string | null;
}

export interface NewsStory {
  id: string;
  url: string;
  title: string;
  publisher: string;
  source: string;
  published: string | null;
  first_seen: string;
  categories: string[];
  excerpt: string | null;
  also: { source: string; publisher: string; url: string; title: string }[];
}

export interface NewsDoc {
  generated_at: string | null;
  last_success: string | null;
  sources: NewsSource[];
  items: NewsStory[];
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isTime = (v: unknown): v is string => isStr(v) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v);
const timeOrNull = (v: unknown) => (isTime(v) ? v : null);
const isLink = (v: unknown): v is string => {
  if (!isStr(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};
const CATEGORY_IDS = new Set(NEWS_CATEGORIES.map((c) => c.id));

/** The checked news document, or null. */
export function parseNews(raw: unknown): NewsDoc | null {
  const d = raw as Record<string, unknown> | null;
  if (!d || d.schema !== 'rmf.news/1' || !Array.isArray(d.items) || !Array.isArray(d.sources)) return null;
  const sources: NewsSource[] = (d.sources as Record<string, unknown>[]).filter((s) => s && isStr(s.id) && isStr(s.publisher) && isLink(s.home)).map((s) => ({
    id: s.id as string,
    name: isStr(s.name) ? s.name : (s.publisher as string),
    publisher: s.publisher as string,
    home: s.home as string,
    terms: isLink(s.terms) ? s.terms : (s.home as string),
    last_attempt: timeOrNull(s.last_attempt),
    last_success: timeOrNull(s.last_success),
    last_error: isStr(s.last_error) ? s.last_error : null,
  }));
  const items: NewsStory[] = (d.items as Record<string, unknown>[]).filter((i) => i && isStr(i.id) && isLink(i.url) && isStr(i.title) && i.title !== '' && isStr(i.publisher) && isTime(i.first_seen)).map((i) => ({
    id: i.id as string,
    url: i.url as string,
    title: i.title as string,
    publisher: i.publisher as string,
    source: isStr(i.source) ? i.source : '',
    published: timeOrNull(i.published),
    first_seen: i.first_seen as string,
    categories: Array.isArray(i.categories) ? (i.categories as unknown[]).filter((c): c is string => isStr(c) && CATEGORY_IDS.has(c)) : [],
    excerpt: isStr(i.excerpt) && i.excerpt !== '' ? i.excerpt : null,
    also: Array.isArray(i.also) ? (i.also as Record<string, unknown>[]).filter((a) => a && isLink(a.url) && isStr(a.publisher)).map((a) => ({ source: isStr(a.source) ? a.source : '', publisher: a.publisher as string, url: a.url as string, title: isStr(a.title) ? a.title : '' })) : [],
  }));
  return { generated_at: timeOrNull(d.generated_at), last_success: timeOrNull(d.last_success), sources, items };
}

const cache = new Map<string, NewsDoc | null>();

/** The news at `file` (default NEWS_FILE), or null when there is none or it cannot be read. */
export function loadNews(file: string | undefined = process.env.NEWS_FILE): NewsDoc | null {
  if (!file) return null;
  if (cache.has(file)) return cache.get(file)!;
  let doc: NewsDoc | null = null;
  try {
    if (existsSync(file)) doc = parseNews(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    doc = null;
  }
  cache.set(file, doc);
  return doc;
}

/** When a story was published, or, without a publication time, when it was collected. */
export const storyTime = (s: NewsStory) => s.published ?? s.first_seen;

/** Stories of one category (or all), newest first, at most `limit`. */
export function storiesIn(doc: NewsDoc | null, category: string | null, limit = 150): NewsStory[] {
  if (!doc) return [];
  return doc.items.filter((s) => category === null || s.categories.includes(category)).sort((a, b) => (storyTime(a) < storyTime(b) ? 1 : storyTime(a) > storyTime(b) ? -1 : 0)).slice(0, limit);
}

/** Stories whose headline or excerpt matches `pattern`, newest first, at most `limit`. */
export function relatedStories(doc: NewsDoc | null, pattern: RegExp, limit = 4): NewsStory[] {
  return storiesIn(doc, null, Number.MAX_SAFE_INTEGER).filter((s) => pattern.test(`${s.title} ${s.excerpt ?? ''}`)).slice(0, limit);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A stored UTC time as "November 22, 2026 at 18:05 UTC". */
export function newsTime(iso: string): string {
  const [date, clock] = iso.split('T') as [string, string];
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}, ${y} at ${clock.slice(0, 5)} UTC`;
}

/** Sources whose latest attempt failed. */
export const failedSources = (doc: NewsDoc | null) => (doc ? doc.sources.filter((s) => s.last_error !== null) : []);

/** The label of a category id. */
export const categoryLabel = (id: string) => NEWS_CATEGORIES.find((c) => c.id === id)?.label ?? id;

// The news collector's pure parts (tools/news/feed.mjs, v0.3.0) and one collection run on fixtures
// (tools/news/collect.mjs). Feeds are untrusted: markup, scripts and odd addresses must not survive.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import * as feed from '../../../tools/news/feed.mjs';
import * as collector from '../../../tools/news/collect.mjs';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
const { canonicalUrl, categorize, clip, decodeEntities, decodeFeed, LIMITS, mergeNews, normalizeHeadline, parseDate, parseFeed, plainText, previousDoc, safeUrl } = feed as unknown as Loose;
const { collect } = collector as unknown as Loose;

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Press releases</title>
<item><title>Agencies issue &amp; finalize a rule</title><link>https://www.example.gov/news/a.htm?utm_source=rss#top</link>
<pubDate>Fri, 20 Nov 2026 14:30:00 -0500</pubDate><description>&lt;p&gt;The agencies &lt;b&gt;today&lt;/b&gt; issued a rule.&lt;/p&gt;</description></item>
<item><title><![CDATA[Statement on <i>digital asset</i> custody]]></title><link>https://www.example.gov/news/b.htm</link>
<dc:date>2026-11-19T10:00:00Z</dc:date><description><![CDATA[<script>alert(1)</script>Custody of crypto assets.]]></description></item>
<item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>not a date</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>News</title>
<entry><title type="html">Bank deposit insurance update</title><link rel="self" href="https://ex.gov/self"/><link rel="alternate" href="/news/c"/>
<published>2026-11-18T15:00:00-05:00</published><summary>Summary &#8212; with a dash</summary></entry>
<entry><title>Second</title><link href="https://ex.gov/news/d"/><updated>2026-11-17T12:00:00Z</updated></entry>
</feed>`;

const SRC = [
  { id: 'a', name: 'Agency A', publisher: 'Agency A', home: 'https://www.example.gov/', feed: 'https://www.example.gov/feed.xml', terms: 'https://www.example.gov/terms', categories: ['regulation'], excerpt: true },
  { id: 'b', name: 'Agency B', publisher: 'Agency B', home: 'https://ex.gov/', feed: 'https://ex.gov/atom.xml', terms: 'https://ex.gov/terms', categories: ['banking'], excerpt: false },
];

describe('feed text', () => {
  it('decodes character references and refuses impossible code points', () => {
    expect(decodeEntities('a &amp; b &#65;&#x42; &unknown; &#xD800; &#1114112;')).toBe('a & b AB &unknown;  ');
  });
  it('turns markup into plain text without scripts, styles or control characters', () => {
    expect(plainText('&lt;p&gt;Hi &lt;script&gt;bad()&lt;/script&gt;there&lt;/p&gt;')).toBe('Hi there');
    expect(plainText('<style>x{}</style>A\u0007\u2028B', true)).toBe('A B');
  });
  it('clips at a word boundary with an ellipsis, and leaves short text alone', () => {
    expect(clip('short', 10)).toBe('short');
    const c = clip('one two three four five six', 15);
    expect(c.length).toBeLessThanOrEqual(15);
    expect(c.endsWith('\u2026')).toBe(true);
    expect(c).toBe('one two three\u2026');
  });
  it('accepts only http and https addresses, resolving relative ones against the feed', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,x')).toBeNull();
    expect(safeUrl('/news/c', 'https://ex.gov/atom.xml')).toBe('https://ex.gov/news/c');
    expect(safeUrl('not a url')).toBeNull();
  });
  it('reads RFC 822 and ISO dates as UTC, and nothing else', () => {
    expect(parseDate('Fri, 20 Nov 2026 14:30:00 -0500')).toBe('2026-11-20T19:30:00Z');
    expect(parseDate('2026-11-18T15:00:00-05:00')).toBe('2026-11-18T20:00:00Z');
    expect(parseDate('not a date')).toBeNull();
  });
});

describe('feeds', () => {
  it('parses RSS: entities, CDATA, a dc:date, and refuses a script link', () => {
    const items = parseFeed(RSS, 'https://www.example.gov/feed.xml');
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ title: 'Agencies issue & finalize a rule', url: 'https://www.example.gov/news/a.htm?utm_source=rss#top', published: '2026-11-20T19:30:00Z', summary: 'The agencies today issued a rule.', tags: [] });
    expect(items[1].title).toBe('Statement on digital asset custody');
    expect(items[1].summary).toBe('Custody of crypto assets.');
    expect(items[1].published).toBe('2026-11-19T10:00:00Z');
    expect(items[2].url).toBeNull();
    expect(items[2].published).toBeNull();
  });
  it("reads an item's own category tags, which the topic rules then use", () => {
    const xml = '<rss><channel><item><title>Agencies announce results</title><link>https://x.gov/1</link><category>Banking and Consumer Regulatory Policy</category><category><![CDATA[Enforcement Actions]]></category></item></channel></rss>';
    const [item] = parseFeed(xml);
    expect(item.tags).toEqual(['Banking and Consumer Regulatory Policy', 'Enforcement Actions']);
    const doc = mergeNews({ previous: null, sources: [SRC[1]], results: { b: { ok: true, entries: [{ ...item, published: '2026-11-21T00:00:00Z' }] } }, now: '2026-11-22T00:00:00Z' });
    expect(doc.items[0].categories).toEqual(['banking', 'regulation']);
  });

  it('parses Atom: the alternate link, published or updated, the summary', () => {
    const items = parseFeed(ATOM, 'https://ex.gov/atom.xml');
    expect(items.map((i: Loose) => i.url)).toEqual(['https://ex.gov/news/c', 'https://ex.gov/news/d']);
    expect(items[0].published).toBe('2026-11-18T20:00:00Z');
    expect(items[0].summary).toBe('Summary \u2014 with a dash');
    expect(items[1].published).toBe('2026-11-17T12:00:00Z');
  });
  it('refuses a document that is not a feed, and reads at most the per-feed limit', () => {
    expect(() => parseFeed('<html><body>Not found</body></html>')).toThrow(/not an RSS or Atom feed/);
    const many = `<rss><channel>${Array.from({ length: LIMITS.itemsPerFeed + 5 }, (_, i) => `<item><title>T${i}</title><link>https://x.gov/${i}</link></item>`).join('')}</channel></rss>`;
    expect(parseFeed(many)).toHaveLength(LIMITS.itemsPerFeed);
  });
});

describe('feed encodings', () => {
  const quote = String.fromCodePoint(0x2019);
  it('decodes in the encoding the XML declaration names, else the HTTP charset, else UTF-8', () => {
    const cp1252 = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="Windows-1252" ?><rss><channel><item><title>OCC'), Buffer.from([0x92]), Buffer.from('s plan</title></item></channel></rss>')]);
    expect(parseFeed(decodeFeed(cp1252))[0].title).toBe(`OCC${quote}s plan`);
    const latin = Buffer.concat([Buffer.from('<rss><channel><item><title>Caf'), Buffer.from([0xe9]), Buffer.from('</title></item></channel></rss>')]);
    expect(decodeFeed(latin, 'text/xml; charset=ISO-8859-1')).toContain(`Caf${String.fromCodePoint(0xe9)}`);
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`<?xml version="1.0" encoding="utf-8"?><rss><channel><item><title>A${quote}B</title></item></channel></rss>`)]);
    expect(parseFeed(decodeFeed(bom))[0].title).toBe(`A${quote}B`);
    expect(decodeFeed(Buffer.from('<rss/>'), 'text/xml; charset=not-a-charset')).toBe('<rss/>');
  });
});

describe('identity and categories', () => {
  it('removes tracking parameters and the fragment; the key ignores www, case and a trailing slash', () => {
    expect(canonicalUrl('https://www.Example.gov/News/a.htm?utm_source=rss&id=3#top')).toEqual({ url: 'https://www.example.gov/News/a.htm?id=3', key: 'example.gov/news/a.htm?id=3' });
    expect(canonicalUrl('https://example.gov/news/').key).toBe(canonicalUrl('https://www.example.gov/news').key);
  });
  it('normalizes headlines for comparison', () => {
    expect(normalizeHeadline('  Agencies Issue: Final Rule!  ')).toBe(normalizeHeadline('agencies issue final rule'));
    expect(normalizeHeadline('Caf\u00e9')).toBe('cafe');
  });
  it("takes the source's categories plus those the text names, in site order", () => {
    expect(categorize(SRC[0], 'Statement on stablecoins', '')).toEqual(['crypto', 'regulation']);
    expect(categorize(SRC[1], 'FOMC statement on monetary policy', 'inflation')).toEqual(['economy', 'federal-reserve', 'banking']);
    expect(categorize({ categories: [] }, 'Nothing matches here', '')).toEqual(['economy']);
    expect(categorize({ categories: ['federal-reserve'] }, 'Minutes of the Federal Open Market Committee', '')).toEqual(['federal-reserve']);
    expect(categorize({ categories: [] }, 'Treasury market structure report', '')).toContain('markets');
  });
});

describe('the merge with the previous file', () => {
  const now = '2026-11-22T18:00:00Z';
  const first = () => mergeNews({ previous: null, sources: SRC, results: { a: { ok: true, entries: parseFeed(RSS, SRC[0]!.feed) }, b: { ok: true, entries: parseFeed(ATOM, SRC[1]!.feed) } }, now });

  it('keeps valid stories newest first, with categories, excerpts only where allowed, and the status of each feed', () => {
    const doc = first();
    expect(doc.schema).toBe('rmf.news/1');
    expect(doc.generated_at).toBe(now);
    expect(doc.items.map((i: Loose) => i.title)).toEqual(['Agencies issue & finalize a rule', 'Statement on digital asset custody', 'Bank deposit insurance update', 'Second']);
    expect(doc.items[0].url).toBe('https://www.example.gov/news/a.htm');
    expect(doc.items[0].excerpt).toBe('The agencies today issued a rule.');
    expect(doc.items[2].excerpt).toBeNull();
    expect(doc.items[1].categories).toContain('crypto');
    expect(doc.items.every((i: Loose) => /^[0-9a-f]{16}$/.test(i.id) && i.first_seen === now)).toBe(true);
    expect(doc.sources.map((s: Loose) => [s.id, s.last_success, s.last_error, s.added])).toEqual([['a', now, null, 2], ['b', now, null, 2]]);
  });

  it('a failed feed keeps its stories and its last success; a story seen again keeps its first time', () => {
    const later = '2026-11-22T20:00:00Z';
    const doc = mergeNews({ previous: first(), sources: SRC, results: { a: { ok: true, entries: parseFeed(RSS, SRC[0]!.feed) }, b: { ok: false, error: 'HTTP 503' } }, now: later });
    expect(doc.items).toHaveLength(4);
    expect(doc.items.find((i: Loose) => i.source === 'a').first_seen).toBe(now);
    const b = doc.sources.find((s: Loose) => s.id === 'b');
    expect([b.last_success, b.last_attempt, b.last_error, b.added]).toEqual([now, later, 'HTTP 503', 0]);
    expect(doc.last_success).toBe(later);
  });

  it('without a fetch nothing changes but the file is carried forward', () => {
    const prev = first();
    const doc = mergeNews({ previous: prev, sources: SRC, results: {}, now: '2026-11-23T00:00:00Z' });
    expect(doc.generated_at).toBe(prev.generated_at);
    expect(doc.items).toEqual(prev.items);
    expect(doc.sources.map((s: Loose) => s.last_attempt)).toEqual([now, now]);
  });

  it('deduplicates by canonical URL and groups the same headline from another publisher as related coverage', () => {
    const joint = { title: 'Agencies Issue & Finalize a Rule', url: 'https://ex.gov/news/joint', published: '2026-11-20T20:00:00Z', summary: '' };
    const repeat = { title: 'Changed title, same story', url: 'https://example.gov/news/a.htm/', published: '2026-11-20T19:30:00Z', summary: '' };
    const doc = mergeNews({ previous: first(), sources: SRC, results: { a: { ok: true, entries: [repeat] }, b: { ok: true, entries: [joint] } }, now: '2026-11-22T21:00:00Z' });
    expect(doc.items).toHaveLength(4);
    const story = doc.items.find((i: Loose) => i.source === 'a' && i.title.startsWith('Agencies'));
    expect(story.also).toEqual([{ source: 'b', publisher: 'Agency B', url: 'https://ex.gov/news/joint', title: 'Agencies Issue & Finalize a Rule' }]);
  });

  it('drops stories past the retention, stories with no address or title, and caps the file', () => {
    const old = { title: 'Old', url: 'https://ex.gov/old', published: '2026-09-01T00:00:00Z', summary: '' };
    const none = { title: '', url: 'https://ex.gov/x', published: null, summary: '' };
    const doc = mergeNews({ previous: null, sources: SRC, results: { b: { ok: true, entries: [old, none, { title: 'No date', url: 'https://ex.gov/nd', published: null, summary: '' }] } }, now });
    expect(doc.items.map((i: Loose) => [i.title, i.published])).toEqual([['No date', null]]);
    const lots = Array.from({ length: LIMITS.maxItems + 20 }, (_, i) => ({ title: `Story ${i}`, url: `https://ex.gov/s/${i}`, published: '2026-11-21T00:00:00Z', summary: '' }));
    expect(mergeNews({ previous: null, sources: SRC, results: { b: { ok: true, entries: lots } }, now }).items).toHaveLength(LIMITS.maxItems);
  });

  it('ignores a previous file that is not a news file, and stories of sources no longer listed', () => {
    expect(previousDoc({ schema: 'other' }).items).toEqual([]);
    const prev = first();
    const doc = mergeNews({ previous: prev, sources: [SRC[1]], results: {}, now });
    expect(doc.items.every((i: Loose) => i.source === 'b')).toBe(true);
  });
});

describe('one collection on fixtures (the command line)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rmf-news-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it('writes a news file, reports a missing feed as failed, and exits 0', () => {
    writeFileSync(join(dir, 'sources.json'), JSON.stringify({ sources: SRC }));
    writeFileSync(join(dir, 'a.xml'), RSS);
    const out = join(dir, 'news.json');
    const r = spawnSync(process.execPath, ['tools/news/collect.mjs', '--out', out, '--previous', 'none', '--sources', join(dir, 'sources.json'), '--fixtures', dir, '--now', '2026-11-22T18:00:00Z'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/b: FAILED \(no fixture\)/);
    const doc = JSON.parse(readFileSync(out, 'utf8'));
    expect(doc.items).toHaveLength(2);
    expect(doc.sources.find((s: Loose) => s.id === 'b').last_error).toBe('no fixture');
  });
  it('still writes a file and exits 0 when the sources cannot be read', () => {
    const out = join(dir, 'empty.json');
    const r = spawnSync(process.execPath, ['tools/news/collect.mjs', '--out', out, '--sources', join(dir, 'missing.json')], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8')).items).toEqual([]);
  });
  it('collect() runs the merge without the network when told not to fetch', async () => {
    const { doc, log } = await collect({ sources: SRC, previous: null, fetchFeeds: false, now: '2026-11-22T18:00:00Z' });
    expect(log).toEqual([]);
    expect(doc.items).toEqual([]);
  });
});

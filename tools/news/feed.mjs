// The news collector's pure parts (v0.3.0): feed parsing (RSS 2.0, RSS 1.0 and Atom), text
// cleaning, canonical URLs, normalized headlines, categories, and the merge of one collection
// with the previous news file. Every feed is untrusted data: read as text, never executed, and
// nothing it names is fetched. No network or file access here; tools/news/collect.mjs does that.
import { createHash } from 'node:crypto';

export const NEWS_SCHEMA = 'rmf.news/1';
export const CATEGORY_IDS = ['markets', 'economy', 'federal-reserve', 'banking', 'crypto', 'regulation'];
export const LIMITS = Object.freeze({
  titleChars: 300,
  excerptChars: 280,
  itemsPerFeed: 40,
  keepDays: 45,
  maxItems: 300,
  groupDays: 7,
  feedBytes: 3_000_000,
});

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026', copy: '\u00a9',
  reg: '\u00ae', trade: '\u2122', eacute: '\u00e9', egrave: '\u00e8', aacute: '\u00e1', oacute: '\u00f3',
  uacute: '\u00fa', iacute: '\u00ed', ntilde: '\u00f1', ccedil: '\u00e7', uuml: '\u00fc', ouml: '\u00f6',
  auml: '\u00e4', middot: '\u00b7', bull: '\u2022', deg: '\u00b0', sect: '\u00a7', para: '\u00b6',
};

/**
 * The text of a feed's bytes in the encoding its XML declaration names, else the HTTP charset,
 * else UTF-8. An encoding the runtime does not know falls back to the next. (In a regular
 * expression \s also matches a byte order mark.)
 */
export function decodeFeed(bytes, contentType = '') {
  const head = Buffer.from(bytes.subarray(0, 300)).toString('latin1');
  const declared = /^\s*<\?xml[^>]*\sencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head.replace(/^\xEF\xBB\xBF/, ''))?.[1];
  const header = /charset\s*=\s*"?([A-Za-z0-9._-]+)/i.exec(contentType)?.[1];
  for (const label of [declared, header, 'utf-8']) {
    if (!label) continue;
    try {
      const text = new TextDecoder(label).decode(bytes);
      // The WHATWG encoding standard reads Latin-1 and ASCII labels as windows-1252, but some Node
      // builds decode it as Latin-1, leaving bytes 0x80 to 0x9F as control characters.
      return LATIN_LABELS.has(label.toLowerCase()) ? text.replace(/[\x80-\x9f]/g, (c) => String.fromCodePoint(CP1252[c.charCodeAt(0) - 0x80])) : text;
    } catch {
      // An unknown label: try the next.
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

const LATIN_LABELS = new Set(['windows-1252', 'cp1252', 'x-cp1252', 'iso-8859-1', 'iso8859-1', 'iso_8859-1', 'latin1', 'l1', 'us-ascii', 'ascii']);
// windows-1252 bytes 0x80 to 0x9F (undefined ones keep their code point).
const CP1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

/** Decodes the XML and common HTML character references; unknown names are left as written. */
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,10});/g, (m, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    }
    return Object.hasOwn(NAMED, ref) ? NAMED[ref] : m;
  });
}

/** Plain text from feed text that may hold markup: no tags, scripts or styles, one space between words. */
export function plainText(raw, isCdata = false) {
  let s = isCdata ? String(raw) : decodeEntities(raw);
  s = s.replace(/<(script|style|iframe|object|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  // Control characters and the Unicode line and paragraph separators become spaces.
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Cuts text at a word boundary to at most `max` characters, marking a cut with an ellipsis. */
export function clip(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.-]+$/, '')}\u2026`;
}

const tagRx = (name) => new RegExp(`<${name.replace(':', '\\:')}(?:\\s[^>]*)?>([\\s\\S]*?)</${name.replace(':', '\\:')}\\s*>`, 'i');

/** The text content of the first element `name` in `block` ({ text, cdata }), or null. */
function element(block, name) {
  const m = tagRx(name).exec(block);
  if (!m) return null;
  const inner = m[1].trim();
  const cd = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
  if (cd) return { text: cd[1], cdata: true };
  // Text with CDATA sections inside it: join them as raw text.
  if (inner.includes('<![CDATA[')) return { text: inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'), cdata: true };
  return { text: inner, cdata: false };
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : null;
};

/** A UTC ISO time from an RFC 822 or ISO 8601 date, or null. */
export function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(String(s).trim().replace(/\s+/g, ' '));
  return Number.isFinite(t) ? new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
}

/** Only an absolute http or https address, else null. */
export function safeUrl(s, base) {
  if (!s) return null;
  try {
    const u = new URL(String(s).trim(), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The entries of an RSS 2.0, RSS 1.0 (RDF) or Atom document: [{ title, url, published, summary }]
 * in document order, at most LIMITS.itemsPerFeed. Throws when the text is not such a feed.
 */
export function parseFeed(xml, feedUrl) {
  const text = String(xml).replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, '');
  const isAtom = /<feed[\s>]/i.test(text) && !/<rss[\s>]/i.test(text);
  const isRss = /<(rss|rdf:RDF)[\s>]/i.test(text) || /<channel[\s>]/i.test(text);
  if (!isAtom && !isRss) throw new Error('not an RSS or Atom feed');
  const blocks = text.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry\s*>/gi : /<item[\s>][\s\S]*?<\/item\s*>/gi) ?? [];
  const out = [];
  for (const block of blocks.slice(0, LIMITS.itemsPerFeed)) {
    const title = element(block, 'title');
    let link = null;
    if (isAtom) {
      const links = block.match(/<link\b[^>]*>/gi) ?? [];
      const alt = links.find((l) => (attr(l, 'rel') ?? 'alternate') === 'alternate') ?? links[0];
      link = alt ? attr(alt, 'href') : null;
    } else {
      const l = element(block, 'link');
      link = l ? plainText(l.text, l.cdata) : null;
      if (!link) {
        const guid = /<guid(\s[^>]*)?>([\s\S]*?)<\/guid>/i.exec(block);
        if (guid && !/isPermaLink\s*=\s*["']false/i.test(guid[1] ?? '')) link = plainText(guid[2]);
      }
    }
    const date = isAtom ? (element(block, 'published') ?? element(block, 'updated')) : (element(block, 'pubDate') ?? element(block, 'dc:date'));
    const summary = isAtom ? element(block, 'summary') : element(block, 'description');
    const tags = (block.match(/<category(?:\s[^>]*)?>[\s\S]*?<\/category\s*>/gi) ?? []).map((c) => plainText(c.replace(/^<category[^>]*>|<\/category\s*>$/gi, '').replace(/^<!\[CDATA\[|\]\]>$/g, ''))).filter(Boolean);
    out.push({
      title: title ? plainText(title.text, title.cdata) : '',
      url: safeUrl(link, feedUrl),
      published: date ? parseDate(plainText(date.text, date.cdata)) : null,
      summary: summary ? plainText(summary.text, summary.cdata) : '',
      tags,
    });
  }
  return out;
}

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|mc_cid|mc_eid|cmpid|_hsenc|_hsmi|mkt_tok)$/i;

/** The address to link to (tracking parameters and the fragment removed) and its comparison key. */
export function canonicalUrl(s) {
  const u = new URL(s);
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  const url = u.toString();
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
  const key = `${u.host.replace(/^www\./, '')}${path}${u.search}`.toLowerCase();
  return { url, key };
}

/** A headline reduced for comparison: lower case, no accents or punctuation, single spaces. */
export function normalizeHeadline(s) {
  return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const RULES = [
  ['crypto', /\b(crypto|cryptocurrenc|digital assets?|bitcoin|ether(eum)?|stablecoins?|blockchain|tokeniz|virtual currenc)/i],
  ['federal-reserve', /\b(federal reserve|fomc|federal open market|monetary policy|discount rate|beige book)\b/i],
  ['banking', /\b(banks?|banking|deposit insurance|depositor|credit unions?|community bank|bank holding)\b/i],
  ['regulation', /\b(rules?|rulemaking|regulat\w*|enforcement|charges|charged|settle\w*|penalt\w*|cease and desist|sanction\w*|guidance|proposal)\b/i],
  ['markets', /\b((?<!open )markets?|securities|stock markets?|equit(y|ies)|bonds?|treasury (auction|bills|notes|bonds)|exchanges?|trading|futures|swaps|derivatives)\b/i],
  ['economy', /\b(economy|economic|inflation|employment|jobs|gdp|budget|deficit|public debt|tax|consumer prices?|spending)\b/i],
];

/** The categories of a story: its source's, plus those its headline and excerpt name, in site order. */
export function categorize(source, title, summary) {
  const set = new Set(source.categories ?? []);
  const text = `${title} ${summary}`;
  for (const [id, rx] of RULES) if (rx.test(text)) set.add(id);
  const list = CATEGORY_IDS.filter((c) => set.has(c));
  return list.length ? list : ['economy'];
}

const hex16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** A previous news file, if it is one; otherwise an empty one. */
export function previousDoc(doc) {
  if (!doc || typeof doc !== 'object' || doc.schema !== NEWS_SCHEMA || !Array.isArray(doc.items) || !Array.isArray(doc.sources)) return { schema: NEWS_SCHEMA, generated_at: null, last_success: null, sources: [], items: [] };
  return doc;
}

const day = 86_400_000;
const storyTime = (it) => it.published ?? it.first_seen;

/**
 * The news file after one collection. `previous`: the last file (or null); `sources`: the
 * registry; `results`: { [source id]: { ok: true, entries } | { ok: false, error } } for the
 * sources fetched this time (a source absent from `results` was not attempted); `now`: UTC ISO.
 * A failed or unattempted source keeps its stories and its last success. Stories are keyed by
 * canonical URL; a later story whose normalized headline equals a kept one within
 * LIMITS.groupDays joins it as related coverage instead of standing alone.
 */
export function mergeNews({ previous, sources, results, now }) {
  const prev = previousDoc(previous);
  const nowMs = Date.parse(now);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const items = [];
  const byKey = new Map();
  const byHeadline = new Map();
  const keep = (it) => {
    items.push(it);
    byKey.set(it.key, it);
    for (const a of it.also) byKey.set(a.key, it);
    byHeadline.set(normalizeHeadline(it.title), it);
  };
  for (const it of prev.items) {
    if (!it || typeof it.url !== 'string' || typeof it.title !== 'string' || !byId.has(it.source)) continue;
    if (nowMs - Date.parse(storyTime(it)) > LIMITS.keepDays * day) continue;
    let key;
    try {
      key = canonicalUrl(it.url).key;
    } catch {
      continue;
    }
    keep({ ...it, key, also: (Array.isArray(it.also) ? it.also : []).flatMap((a) => {
      try {
        return [{ ...a, key: canonicalUrl(a.url).key }];
      } catch {
        return [];
      }
    }) });
  }
  const status = [];
  for (const s of sources) {
    const old = prev.sources.find((x) => x.id === s.id) ?? {};
    const r = results[s.id];
    let added = 0;
    if (r?.ok) {
      for (const e of r.entries) {
        if (!e.url || !e.title) continue;
        const { url, key } = canonicalUrl(e.url);
        if (byKey.has(key)) continue;
        const published = e.published && Date.parse(e.published) <= nowMs + 12 * 3_600_000 ? e.published : null;
        if (published && nowMs - Date.parse(published) > LIMITS.keepDays * day) continue;
        const title = clip(e.title, LIMITS.titleChars);
        const twin = byHeadline.get(normalizeHeadline(title));
        if (twin && Math.abs(Date.parse(storyTime(twin)) - Date.parse(published ?? now)) <= LIMITS.groupDays * day) {
          if (twin.source !== s.id && !twin.also.some((a) => a.source === s.id)) twin.also.push({ source: s.id, publisher: s.publisher, url, title, key });
          byKey.set(key, twin);
          continue;
        }
        keep({
          id: hex16(key),
          key,
          url,
          title,
          publisher: s.publisher,
          source: s.id,
          published,
          first_seen: now,
          categories: categorize(s, title, `${e.summary ?? ''} ${(e.tags ?? []).join(' ')}`),
          excerpt: s.excerpt && e.summary ? clip(e.summary, LIMITS.excerptChars) : null,
          also: [],
        });
        added += 1;
      }
    }
    status.push({
      id: s.id,
      name: s.name,
      publisher: s.publisher,
      home: s.home,
      terms: s.terms,
      last_attempt: r ? now : (old.last_attempt ?? null),
      last_success: r?.ok ? now : (old.last_success ?? null),
      last_error: r ? (r.ok ? null : String(r.error).slice(0, 200)) : (old.last_error ?? null),
      added,
    });
  }
  items.sort((a, b) => (storyTime(a) < storyTime(b) ? 1 : storyTime(a) > storyTime(b) ? -1 : a.id < b.id ? -1 : 1));
  const kept = items.slice(0, LIMITS.maxItems).map(({ key, also, ...rest }) => ({ ...rest, also: also.map(({ key: _k, ...a }) => a) }));
  const successes = status.map((s) => s.last_success).filter(Boolean).sort();
  const anyFetched = Object.keys(results).length > 0;
  return {
    schema: NEWS_SCHEMA,
    generated_at: anyFetched ? now : prev.generated_at,
    last_success: successes.at(-1) ?? null,
    sources: status,
    items: kept,
  };
}

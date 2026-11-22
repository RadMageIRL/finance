#!/usr/bin/env node
// The news collection (v0.3.0). Reads the previous news file (the deployed
// https://radmageirl.github.io/finance/news/news.json, a local file, or none), fetches each
// source's feed unless --no-fetch, and writes the merged file for the site build (NEWS_FILE).
// A failed feed keeps its stories and its last success; a failed previous file starts empty.
// It never makes the site build fail: on any error it still writes a file when it can, and exits 0.
//
//   node tools/news/collect.mjs --out <file> [--previous <url|file|none>] [--no-fetch]
//                               [--sources tools/news/sources.json] [--fixtures <dir>] [--now <UTC ISO>]
//
// --fixtures <dir> reads <dir>/<source id>.xml instead of the network (tests); a missing file is a
// failed feed. Feeds are untrusted data: size-capped, parsed as text, nothing they name is fetched.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFeed, LIMITS, mergeNews, parseFeed, previousDoc } from './feed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const UA = 'RadMage Finance news';

/**
 * The User-Agent for a source: its own `user_agent` where the publisher asks automated clients to
 * identify themselves with a contact (the SEC), else the generic one. Only printable ASCII, at
 * most 200 characters; anything else falls back to the generic one.
 */
export const userAgentFor = (source) => (typeof source?.user_agent === 'string' && /^[\x20-\x7e]{1,200}$/.test(source.user_agent) ? source.user_agent : UA);

async function fetchText(url, { timeoutMs = 20_000, maxBytes = LIMITS.feedBytes, userAgent = UA, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': userAgent, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const len = Number(r.headers.get('content-length') ?? 0);
    if (len > maxBytes) throw new Error(`${len} bytes, over the ${maxBytes} byte limit`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`${buf.length} bytes, over the ${maxBytes} byte limit`);
    return decodeFeed(buf, r.headers.get('content-type') ?? '');
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `no answer within ${timeoutMs / 1000} s` : e.message);
  } finally {
    clearTimeout(timer);
  }
}

/** The previous news file from a URL or a path; an empty one when it cannot be read. */
async function readPrevious(where) {
  if (!where || where === 'none') return { doc: previousDoc(null), note: 'none given' };
  try {
    const text = /^https:\/\//.test(where) ? await fetchText(`${where}${where.includes('?') ? '&' : '?'}t=${Date.now()}`, { maxBytes: 5_000_000 }) : readFileSync(where, 'utf8');
    const doc = previousDoc(JSON.parse(text));
    return { doc, note: `${doc.items.length} stories` };
  } catch (e) {
    return { doc: previousDoc(null), note: `unreadable (${e.message}); starting empty` };
  }
}

/** One collection: { doc, log }. Never throws for a feed. */
export async function collect({ sources, previous, fetchFeeds, now, fixtures = null, fetchImpl = fetch }) {
  const results = {};
  const log = [];
  if (fetchFeeds) {
    await Promise.all(sources.map(async (s) => {
      try {
        const xml = fixtures ? decodeFeed(readFileSync(join(fixtures, `${s.id}.xml`))) : await fetchText(s.feed, { userAgent: userAgentFor(s), fetchImpl });
        const entries = parseFeed(xml, s.feed);
        results[s.id] = { ok: true, entries };
        log.push(`${s.id}: ${entries.length} entries`);
      } catch (e) {
        results[s.id] = { ok: false, error: e.code === 'ENOENT' ? 'no fixture' : e.message };
        log.push(`${s.id}: FAILED (${results[s.id].error})`);
      }
    }));
  }
  const doc = mergeNews({ previous, sources, results, now });
  return { doc, log: log.sort() };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const out = arg('--out');
  if (!out) {
    console.error('usage: node tools/news/collect.mjs --out <file> [--previous <url|file|none>] [--no-fetch] [--sources <file>] [--fixtures <dir>] [--now <UTC ISO>]');
    process.exit(2);
  }
  const now = arg('--now') ?? `${new Date().toISOString().slice(0, 19)}Z`;
  let doc = previousDoc(null);
  try {
    const sources = JSON.parse(readFileSync(arg('--sources') ?? join(HERE, 'sources.json'), 'utf8')).sources;
    const prev = await readPrevious(arg('--previous'));
    console.log(`news: previous file ${prev.note}`);
    const fetchFeeds = !process.argv.includes('--no-fetch');
    const fixtures = arg('--fixtures');
    if (fixtures && !existsSync(fixtures)) throw new Error(`no fixtures folder ${fixtures}`);
    const r = await collect({ sources, previous: prev.doc, fetchFeeds, now, fixtures });
    doc = r.doc;
    for (const line of r.log) console.log(`news: ${line}`);
    console.log(`news: ${doc.items.length} stories, ${doc.sources.filter((s) => s.last_error).length} failed feed(s); ${fetchFeeds ? 'collected' : 'carried forward, not fetched'} at ${now}`);
  } catch (e) {
    console.log(`::warning::news collection: ${e.message}; writing what is known`);
  }
  try {
    writeFileSync(out, `${JSON.stringify(doc)}\n`);
  } catch (e) {
    console.error(`news: cannot write ${out}: ${e.message}`);
    process.exit(1);
  }
}

#!/usr/bin/env node
// Checks on the built site in dist/: internal links resolve, nothing loads from another
// origin, every page carries its metadata and CSP, the sitemap lists exactly the indexable
// pages, and page weights stay within budget.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'dist';
const BASE = '/finance/';
const ORIGIN = 'https://radmagelabs.com';

// Budgets (SEO_STRATEGY.md section 9). The site chrome script (theme control and menu) is
// the only JavaScript on text pages.
const BUDGET = {
  htmlCssGzip: 50 * 1024,
  chromeJsGzip: 4 * 1024,
  interactiveJsGzip: 60 * 1024,
};
// Calculator and lesson pages load their own island on top of the site chrome.
const isInteractive = (page) => /^\/finance\/(calculators|learn)\/[^/]+\/$/.test(page);

const problems = [];
const fail = (page, message) => problems.push(`${page}: ${message}`);

function htmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(path, out);
    else if (entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

function urlForFile(file) {
  const rel = relative(DIST, file).split(sep).join('/');
  if (rel === 'index.html') return BASE;
  if (rel.endsWith('/index.html')) return BASE + rel.slice(0, -'index.html'.length);
  return BASE + rel;
}

function fileForPath(pathname) {
  if (!pathname.startsWith(BASE)) return null;
  const rest = decodeURIComponent(pathname.slice(BASE.length));
  const candidate = rest === '' || rest.endsWith('/') ? join(DIST, rest, 'index.html') : join(DIST, rest);
  return existsSync(candidate) ? candidate : null;
}

const gz = (text) => gzipSync(Buffer.from(text)).length;
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1];

const pages = htmlFiles(DIST);
const indexable = new Set();
const cssSizes = new Map();
const report = [];

for (const file of pages) {
  const page = urlForFile(file);
  const html = readFileSync(file, 'utf8');
  const is404 = page === `${BASE}404.html`;

  // Metadata
  if (!/<html[^>]*\slang="en-US"/.test(html)) fail(page, 'missing lang="en-US"');
  if (!/<title>[^<]+<\/title>/.test(html)) fail(page, 'missing <title>');
  if (!/<meta name="description" content="[^"]{40,}"/.test(html)) fail(page, 'missing or short meta description');
  if (!/<meta http-equiv="content-security-policy"/.test(html)) fail(page, 'missing CSP meta');
  const h1s = html.match(/<h1[\s>]/g) ?? [];
  if (h1s.length !== 1) fail(page, `expected one <h1>, found ${h1s.length}`);
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  if (!is404) {
    if (canonical !== ORIGIN + page) fail(page, `canonical is ${canonical ?? 'missing'}, expected ${ORIGIN + page}`);
  }
  const noindex = /<meta name="robots" content="noindex/.test(html);
  if (!noindex && !is404) indexable.add(ORIGIN + page);

  // Open Graph image: present, the right size, and the file is in the build.
  const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  if (!ogImage) fail(page, 'missing og:image');
  else if (!ogImage.startsWith(`${ORIGIN}${BASE}og/`) || !existsSync(join(DIST, ogImage.slice(`${ORIGIN}${BASE}`.length)))) fail(page, `og:image ${ogImage} is not a built file under og/`);
  if (!/<meta property="og:image:width" content="1200"/.test(html) || !/<meta property="og:image:height" content="630"/.test(html)) fail(page, 'og:image is not declared as 1200 x 630');

  // Structured data: every JSON-LD block parses; lessons, calculators and pages below a hub
  // carry the types SEO_STRATEGY section 4 asks for, with RadMage Labs as publisher.
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => {
    try {
      return JSON.parse(m[1]);
    } catch {
      fail(page, 'a JSON-LD block does not parse');
      return {};
    }
  });
  const types = blocks.map((b) => b['@type']);
  const main = blocks.find((b) => b['@type'] !== 'BreadcrumbList') ?? {};
  if (!is404 && main.publisher?.name !== 'RadMage Labs') fail(page, 'structured data does not name RadMage Labs as publisher');
  if (/^\/finance\/learn\/[^/]+\/$/.test(page) && !(main['@type'] === 'LearningResource' && main.dateModified && main.author?.name === 'RadMage Labs')) fail(page, 'a lesson needs LearningResource with dateModified and author');
  if (/^\/finance\/calculators\/[^/]+\/$/.test(page) && !(main['@type'] === 'WebApplication' && main.applicationCategory === 'FinanceApplication' && main.offers?.price === '0')) fail(page, 'a calculator needs WebApplication with FinanceApplication and a free offer');
  if (html.includes('class="breadcrumbs"') && !types.includes('BreadcrumbList')) fail(page, 'breadcrumbs without BreadcrumbList data');

  // The theme bootstrap must be the first script, before any stylesheet.
  const firstScript = html.indexOf('<script');
  const firstStylesheet = html.indexOf('rel="stylesheet"');
  if (firstScript === -1 || (firstStylesheet !== -1 && firstScript > firstStylesheet)) {
    fail(page, 'theme script is not ahead of the stylesheet');
  }
  if (/\sstyle="/.test(html)) fail(page, 'inline style attribute (blocked by the CSP)');

  // A word run into a link ("and<a") means a source line break was compressed away.
  for (const match of html.matchAll(/[A-Za-z0-9,;]<a\s/g)) {
    fail(page, `missing space before a link: "${html.slice(match.index - 20, match.index + 3)}"`);
  }
  // The same after a link or a citation ("calculator</a>for", "(c)</span>Behind"). An empty
  // span (a legend key) is a mark, not a word, and may touch its label; text that already
  // ends in a space before the tag closes is fine.
  for (const match of html.matchAll(/(?:[^>\s]<\/(?:a|span)>|<\/a><\/span>)[A-Za-z]/g)) {
    fail(page, `missing space after an inline element: "${html.slice(match.index - 20, match.index + 12)}"`);
  }

  // Every tag that references a URL.
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  let cssGzip = 0;
  let jsGzip = 0;
  for (const tag of html.match(/<(a|link|script|img|source|iframe|video|audio|embed|object|form)\b[^>]*>/gi) ?? []) {
    const name = tag.match(/^<(\w+)/)[1].toLowerCase();
    const urls = [];
    for (const key of ['href', 'src', 'data', 'action', 'poster']) {
      const value = attr(tag, key);
      if (value !== undefined) urls.push(value);
    }
    const srcset = attr(tag, 'srcset');
    if (srcset) urls.push(...srcset.split(',').map((s) => s.trim().split(/\s+/)[0]));

    for (const url of urls) {
      if (url.startsWith('mailto:')) continue;
      const loadsResource = name !== 'a' && !(name === 'link' && /rel="canonical"/.test(tag)) && name !== 'form';
      if (/^(https?:)?\/\//i.test(url)) {
        if (loadsResource) fail(page, `loads a resource from another origin: ${url}`);
        continue;
      }
      if (url.startsWith('#')) {
        if (url.length > 1 && !ids.has(url.slice(1))) fail(page, `fragment ${url} has no matching id`);
        continue;
      }
      if (/^[a-z]+:/i.test(url)) {
        if (url.startsWith('data:') && loadsResource) continue;
        fail(page, `unexpected URL scheme: ${url}`);
        continue;
      }
      const resolved = new URL(url, `http://x${page}`);
      const target = fileForPath(resolved.pathname);
      if (!resolved.pathname.startsWith(BASE)) {
        fail(page, `internal link outside ${BASE}: ${url}`);
      } else if (!target) {
        fail(page, `broken internal link: ${url}`);
      } else if (name === 'link' && /rel="stylesheet"/.test(tag)) {
        if (!cssSizes.has(target)) cssSizes.set(target, gz(readFileSync(target, 'utf8')));
        cssGzip += cssSizes.get(target);
      } else if (name === 'script') {
        jsGzip += gz(readFileSync(target, 'utf8'));
      }
    }
  }

  // Inline scripts count toward JavaScript weight, except JSON-LD data.
  for (const match of html.matchAll(/<script(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)) {
    jsGzip += gz(match[1]);
  }

  // CSS url() references must stay on this origin.
  const htmlGzip = gz(html);
  if (htmlGzip + cssGzip > BUDGET.htmlCssGzip) {
    fail(page, `HTML + CSS ${(htmlGzip + cssGzip) / 1024} KB gzip exceeds ${BUDGET.htmlCssGzip / 1024} KB`);
  }
  const jsBudget = isInteractive(page) ? BUDGET.interactiveJsGzip : BUDGET.chromeJsGzip;
  if (jsGzip > jsBudget) {
    fail(page, `JavaScript ${jsGzip} B gzip exceeds the ${jsBudget} B budget for this page`);
  }
  report.push({ page, htmlGzip, cssGzip, jsGzip });
}

for (const [file] of cssSizes) {
  for (const match of readFileSync(file, 'utf8').matchAll(/url\(\s*['"]?([^'")]+)/g)) {
    if (/^(https?:)?\/\//i.test(match[1])) fail(relative(DIST, file), `CSS loads from another origin: ${match[1]}`);
  }
}

// Sitemap lists exactly the indexable pages.
const sitemapFiles = readdirSync(DIST).filter((f) => /^sitemap-\d+\.xml$/.test(f));
const listed = new Set(
  sitemapFiles.flatMap((f) => [...readFileSync(join(DIST, f), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])),
);
for (const url of indexable) if (!listed.has(url)) fail('sitemap', `missing indexable page ${url}`);
for (const url of listed) if (!indexable.has(url)) fail('sitemap', `lists a page that is not indexable: ${url}`);
for (const f of sitemapFiles) {
  const xml = readFileSync(join(DIST, f), 'utf8');
  const urls = (xml.match(/<url>/g) ?? []).length;
  const dated = (xml.match(/<lastmod>\d{4}-\d{2}-\d{2}/g) ?? []).length;
  if (dated !== urls) fail('sitemap', `${urls - dated} URL(s) in ${f} have no lastmod`);
}

const kb = (n) => (n / 1024).toFixed(1).padStart(5);
console.log('page                                   HTML gz  CSS gz   JS gz (KB)');
for (const row of report.sort((a, b) => a.page.localeCompare(b.page))) {
  console.log(`${row.page.padEnd(38)} ${kb(row.htmlGzip)}   ${kb(row.cssGzip)}   ${kb(row.jsGzip)}`);
}
console.log(`sitemap: ${listed.size} URL(s), indexable pages: ${indexable.size}`);

if (problems.length) {
  for (const p of problems) console.log(`FAIL ${p}`);
  console.log(`dist check: ${problems.length} problem(s) in ${pages.length} page(s)`);
  process.exit(1);
}
console.log(`dist check: clean (${pages.length} pages)`);

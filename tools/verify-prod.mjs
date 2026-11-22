// Production verification for RadMage Finance. Read-only HTTP checks; run after `npm run build`.
//   node tools/verify-prod.mjs                       # https://radmagelabs.com (behind the Labs rewrite)
//   node tools/verify-prod.mjs https://radmageirl.github.io --origin-only   # the Pages origin before Labs routes to it
// Checks every page in the built sitemap plus the non-indexed pages, the 404 behavior, the
// trailing-slash redirect, security headers (Labs only), canonicals, the sitemap and robots.txt,
// sharing images, and that the other Labs apps still answer.
import { readFileSync } from 'node:fs';

const ORIGIN = (process.argv[2] ?? 'https://radmagelabs.com').replace(/\/$/, '');
const ORIGIN_ONLY = process.argv.includes('--origin-only');
const CANON = 'https://radmagelabs.com';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; release verification)' };
let failures = 0;
const ok = (msg) => console.log('PASS ' + msg);
const bad = (msg) => { failures++; console.log('FAIL ' + msg); };

const sitemap = readFileSync(new URL('../dist/sitemap-0.xml', import.meta.url), 'utf8');
const pages = [...sitemap.matchAll(/<loc>https:\/\/radmagelabs\.com(\/finance\/[^<]*)<\/loc>/g)].map((m) => m[1]);
const inSitemap = new Set(pages);
if (!inSitemap.has('/finance/news/')) pages.push('/finance/news/');

async function get(path, opts = {}) {
  return fetch(ORIGIN + path, { redirect: 'manual', headers: UA, ...opts });
}

for (const p of pages) {
  const r = await get(p);
  const html = await r.text();
  if (r.status !== 200) { bad(`${p} status ${r.status}`); continue; }
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  if (canonical !== CANON + p) bad(`${p} canonical ${canonical}`);
  if (!/http-equiv="content-security-policy"/i.test(html)) bad(`${p} has no CSP meta`);
  // A page the sitemap lists is indexable; a News page without stories is noindex and out of it (v0.3.0).
  const noindex = /<meta name="robots" content="noindex/.test(html);
  if (inSitemap.has(p) === noindex) bad(`${p} ${noindex ? 'is noindex but in the sitemap' : 'is not in the sitemap but indexable'}`);
  if (!ORIGIN_ONLY) {
    for (const h of ['content-security-policy', 'x-content-type-options', 'referrer-policy']) if (!r.headers.get(h)) bad(`${p} missing header ${h}`);
    if (r.headers.get('content-security-policy') && !/frame-ancestors 'none'/.test(r.headers.get('content-security-policy'))) bad(`${p} header CSP lacks frame-ancestors`);
  }
  const og = html.match(/<meta property="og:image" content="https:\/\/radmagelabs\.com([^"]+)"/)?.[1];
  if (og) { const i = await get(og); if (i.status !== 200 || !/image\/png/.test(i.headers.get('content-type') ?? '')) bad(`${p} og:image ${og} ${i.status}`); }
}
ok(`${pages.length} pages checked`);

// Assets referenced by the home page load.
const home = await (await get('/finance/')).text();
for (const m of new Set([...home.matchAll(/(?:href|src)="(\/finance\/_astro\/[^"]+)"/g)].map((m) => m[1]))) {
  const r = await get(m);
  if (r.status !== 200) bad(`asset ${m} ${r.status}`);
}
ok('home page assets');

// Missing page: Finance's own 404 page with status 404.
{
  const r = await get('/finance/no-such-page/');
  const t = await r.text();
  if (r.status !== 404) bad(`missing page status ${r.status}`);
  else if (!/RadMage Finance/.test(t)) bad('missing page is not the Finance 404 page');
  else ok('missing page returns the Finance 404 with status 404');
}

// Slash handling: never redirect to github.io.
for (const p of ['/finance', '/finance/learn', '/finance/calculators/apr-apy']) {
  const r = await get(p);
  const loc = r.headers.get('location') ?? '';
  if (ORIGIN_ONLY) { console.log(`INFO ${p} ${r.status} ${loc}`); continue; }
  if (/github\.io/.test(loc)) bad(`${p} redirects to ${loc}`);
  else if (r.status >= 300 && r.status < 400 && loc.replace(ORIGIN, '').startsWith(p + '/')) ok(`${p} ${r.status} -> ${loc}`);
  else console.log(`INFO ${p} ${r.status} ${loc} (only /finance has a required redirect)`);
}

if (!ORIGIN_ONLY) {
  const idx = await get('/finance/sitemap-index.xml');
  if (idx.status !== 200) bad(`sitemap index ${idx.status}`); else ok('sitemap index');
  const robots = await (await get('/robots.txt')).text();
  if (!/Sitemap:\s*https:\/\/radmagelabs\.com\/finance\/sitemap-index\.xml/i.test(robots)) bad('robots.txt does not list the Finance sitemap');
  else ok('robots.txt lists the Finance sitemap');
  // Other Labs apps still answer as before.
  for (const p of ['/', '/ffxi/', '/ffxiv/', '/d4/', '/password/', '/mailforge/', '/gw2-timer/', '/wow/', '/pagesmith/', '/d2looter/']) {
    const r = await get(p);
    if (r.status !== 200) bad(`Labs ${p} ${r.status}`); else ok(`Labs ${p} 200`);
  }
}

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
// Exit at once: responses whose bodies were not read can keep the process alive.
process.exit(failures ? 1 : 0);

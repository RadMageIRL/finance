// The two balance-sheet lessons cite only their own listed sources, use every one, and cite
// only official publications (US agencies, the Federal Reserve System, the Bank of England).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BANK_SOURCES, FLOW_SOURCES, numberer } from '../../../src/lib/learn/lesson-sources';

const OFFICIAL = /(\.gov|^www\.newyorkfed\.org|^www\.stlouisfed\.org|^www\.bankofengland\.co\.uk)$/;

const cited = (page: string) =>
  new Set([...readFileSync(page, 'utf8').matchAll(/ids=\{\[([^\]]*)\]\}/g)].flatMap((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!)));

describe('lesson sources', () => {
  for (const [page, sources] of [
    ['src/pages/learn/how-banks-create-money.astro', BANK_SOURCES],
    ['src/pages/learn/how-money-flows.astro', FLOW_SOURCES],
  ] as const) {
    it(`cites every listed source and nothing else: ${page}`, () => {
      const ids = new Set(sources.map((s) => s.id));
      expect(ids.size).toBe(sources.length);
      const used = cited(page);
      for (const id of used) expect(ids.has(id), id).toBe(true);
      for (const id of ids) expect(used.has(id), `${id} is never cited`).toBe(true);
    });

    it(`cites only official publications over https: ${page}`, () => {
      for (const s of sources) {
        expect(s.url.startsWith('https://'), s.id).toBe(true);
        expect(new URL(s.url).hostname, s.id).toMatch(OFFICIAL);
      }
    });
  }

  it('numbers each list in order and refuses an unknown source', () => {
    const n = numberer(BANK_SOURCES);
    expect(n(BANK_SOURCES[0]!.id)).toBe(1);
    expect(n(BANK_SOURCES.at(-1)!.id)).toBe(BANK_SOURCES.length);
    expect(() => n('nope')).toThrow();
  });
});

// What Is Money?: the comparison data is complete, every citation resolves, every source is
// used, and every source is a government or Federal Reserve System publication.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ANSWER_KEYS, INSTRUMENTS, QUESTIONS, SOURCES, sourceNumber } from '../../../src/lib/learn/money';

const PAGE = readFileSync('src/pages/learn/what-is-money.astro', 'utf8');
const pageCitations = [...PAGE.matchAll(/ids=\{\[([^\]]*)\]\}/g)].flatMap((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!));

describe('What Is Money? data', () => {
  it('compares the eight instruments the brief names, each answering all six questions', () => {
    expect(INSTRUMENTS.map((i) => i.id)).toEqual(['cash', 'deposits', 'reserves', 't-bills', 'mmf', 'stablecoins', 'bitcoin', 'gold']);
    expect(QUESTIONS).toHaveLength(6);
    for (const i of INSTRUMENTS) {
      for (const key of ANSWER_KEYS) expect(i.answers[key].text.length, `${i.id} ${key}`).toBeGreaterThan(5);
    }
  });

  it('cites only sources that exist, and uses every source somewhere on the page', () => {
    const ids = new Set(SOURCES.map((s) => s.id));
    expect(ids.size).toBe(SOURCES.length);
    const cited = new Set([...INSTRUMENTS.flatMap((i) => ANSWER_KEYS.flatMap((k) => i.answers[k].sources)), ...pageCitations]);
    for (const id of cited) expect(ids.has(id), id).toBe(true);
    for (const id of ids) expect(cited.has(id), `${id} is never cited`).toBe(true);
  });

  it('numbers sources in list order and refuses an unknown one', () => {
    SOURCES.forEach((s, i) => expect(sourceNumber(s.id)).toBe(i + 1));
    expect(() => sourceNumber('nope')).toThrow();
  });

  it('cites only official publications over https', () => {
    for (const s of SOURCES) {
      const host = new URL(s.url).hostname;
      expect(s.url.startsWith('https://'), s.id).toBe(true);
      expect(/\.gov$/.test(host) || host === 'www.federalreserveeducation.org', `${s.id} ${host}`).toBe(true);
      expect(s.date.length, s.id).toBeGreaterThan(3);
    }
  });

  it('cites a source for every answer except plain descriptions of how a thing is used', () => {
    const uncited = INSTRUMENTS.flatMap((i) => ANSWER_KEYS.filter((k) => i.answers[k].sources.length === 0).map((k) => `${i.id}.${k}`));
    // Who can hold cash, or how cash changes hands, needs no citation; anything legal,
    // regulatory or about backing always has one.
    for (const entry of uncited) expect(entry, entry).toMatch(/\.(holders|settlement|price)$/);
    for (const i of INSTRUMENTS) for (const k of ['promise', 'legal', 'backing'] as const) expect(i.answers[k].sources.length, `${i.id}.${k}`).toBeGreaterThan(0);
  });

  it('keeps quotation marks paired in every answer', () => {
    for (const i of INSTRUMENTS) for (const k of ANSWER_KEYS) expect((i.answers[k].text.match(/"/g) ?? []).length % 2, `${i.id}.${k}`).toBe(0);
  });

  it('states time-sensitive facts with their date', () => {
    expect(INSTRUMENTS.find((i) => i.id === 'reserves')!.answers.backing.text).toMatch(/3\.90 percent as of October 29, 2026/);
    expect(INSTRUMENTS.find((i) => i.id === 'stablecoins')!.answers.legal.text).toMatch(/as of November 15, 2026/);
  });
});

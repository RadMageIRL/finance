import { describe, expect, it } from 'vitest';
import { centsToCsv, csvCell, toCsv } from '../../../src/lib/calc/csv';
import { formatRate, formatUSD, formatUSDCompact, intlUSD } from '../../../src/lib/calc/format';
import { parseMoney, parsePercent, parseWhole } from '../../../src/lib/calc/parse';
import { AMOUNTS_FIELD, decodeShare, encodeShare, roundForShare, shareAmounts, type Schema } from '../../../src/lib/calc/share';

describe('formatUSD', () => {
  it('formats whole cents exactly, with separators and two decimals', () => {
    expect(formatUSD(123456)).toBe('$1,234.56');
    expect(formatUSD(5)).toBe('$0.05');
    expect(formatUSD(0)).toBe('$0.00');
    expect(formatUSD(-119910)).toBe('-$1,199.10');
  });

  it('stays exact above the range where dividing by 100 in floating point drifts', () => {
    expect(formatUSD(9_007_199_254_740_991)).toBe('$90,071,992,547,409.91');
  });

  it('agrees with the platform currency formatter for ordinary amounts', () => {
    for (const cents of [1, 99, 100, 119910, 23167704, 43167704, 1_000_000_000]) expect(formatUSD(cents)).toBe(intlUSD(cents));
  });

  it('refuses a fractional cent amount', () => {
    expect(() => formatUSD(1.5)).toThrow(RangeError);
  });
});

describe('compact and rate formatting', () => {
  it('abbreviates axis values', () => {
    expect(formatUSDCompact(95_000)).toBe('$950');
    expect(formatUSDCompact(1_250_000)).toBe('$12.5K');
    expect(formatUSDCompact(120_000_000)).toBe('$1.2M');
  });

  it('shows rates as percents without trailing zeros', () => {
    expect(formatRate(0.0525)).toBe('5.25%');
    expect(formatRate(0.05)).toBe('5%');
    expect(formatRate(0)).toBe('0%');
  });
});

describe('parseMoney: exact cents from what people type', () => {
  it('accepts dollar signs, commas, spaces and one or two decimals', () => {
    expect(parseMoney('$1,234.56')).toEqual({ ok: true, value: 123456 });
    expect(parseMoney(' 1234.5 ')).toEqual({ ok: true, value: 123450 });
    expect(parseMoney('1234')).toEqual({ ok: true, value: 123400 });
    expect(parseMoney('.75')).toEqual({ ok: true, value: 75 });
    expect(parseMoney('1.005'.slice(0, 4))).toEqual({ ok: true, value: 100 });
  });

  it('rejects empty, non-numeric and sub-cent input with a reason', () => {
    expect(parseMoney('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseMoney('12a')).toEqual({ ok: false, reason: 'not-a-number' });
    expect(parseMoney('1.005')).toEqual({ ok: false, reason: 'too-many-decimals' });
  });
});

describe('parsePercent: a percent to an exact rate fraction', () => {
  it('reads percents as their decimal value', () => {
    expect(parsePercent('5.25')).toEqual({ ok: true, value: 0.0525 });
    expect(parsePercent('5.25%')).toEqual({ ok: true, value: 0.0525 });
    expect(parsePercent('100')).toEqual({ ok: true, value: 1 });
    expect(parsePercent('0')).toEqual({ ok: true, value: 0 });
    expect(parsePercent('.5')).toEqual({ ok: true, value: 0.005 });
    expect(parsePercent('7.1234')).toEqual({ ok: true, value: 0.071234 });
  });

  it('rejects empty, non-numeric and over-precise input with a reason', () => {
    expect(parsePercent('')).toEqual({ ok: false, reason: 'empty' });
    expect(parsePercent('abc')).toEqual({ ok: false, reason: 'not-a-number' });
    expect(parsePercent('5.12345')).toEqual({ ok: false, reason: 'too-many-decimals' });
  });
});

describe('parseWhole', () => {
  it('reads whole numbers and rejects decimals with a reason', () => {
    expect(parseWhole('30')).toEqual({ ok: true, value: 30 });
    expect(parseWhole('2.5')).toEqual({ ok: false, reason: 'too-many-decimals' });
    expect(parseWhole('ten')).toEqual({ ok: false, reason: 'not-a-number' });
  });
});

describe('CSV export (RFC 4180, formula-injection safe)', () => {
  it('writes a header row, CRLF line breaks, and unformatted numbers', () => {
    expect(toCsv(['year', 'interest_usd'], [[1, centsToCsv(105000)], [2, centsToCsv(147350)]])).toBe(
      'year,interest_usd\r\n1,1050.00\r\n2,1473.50\r\n',
    );
  });

  it('quotes cells with commas, quotes or line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('prefixes text that a spreadsheet would read as a formula', () => {
    for (const text of ['=SUM(A1)', '+1', '-2', '@cmd']) expect(csvCell(text)).toBe(`'${text}`);
  });

  it('rejects a row with the wrong number of cells', () => {
    expect(() => toCsv(['a', 'b'], [[1]])).toThrow(RangeError);
  });

  it('writes cents as dollars with two decimals, including negatives', () => {
    expect(centsToCsv(5)).toBe('0.05');
    expect(centsToCsv(-123456)).toBe('-1234.56');
  });
});

describe('share links (URL fragment, validated on load)', () => {
  const schema: Schema = {
    p: { kind: 'int', min: 0, max: 10_000_000_000 },
    r: { kind: 'decimal', min: 0, max: 100, decimals: 4 },
    n: { kind: 'choice', values: ['1', '2', '4', '12', '365'] },
  };

  it('round-trips every field', () => {
    const state = { p: 1000000, r: 5.25, n: '12' };
    expect(decodeShare(schema, `#${encodeShare(schema, state)}`)).toEqual(state);
  });

  it('drops unknown, malformed and out-of-range fields and keeps the rest', () => {
    const fragment = `#s=${encodeURIComponent('v=1&p=-5&r=5.25&n=3&x=evil&r2=<script>')}`;
    expect(decodeShare(schema, fragment)).toEqual({ r: 5.25 });
  });

  it('rejects a link from another schema version or with broken encoding', () => {
    expect(decodeShare(schema, `#s=${encodeURIComponent('v=2&p=100')}`)).toEqual({});
    expect(decodeShare(schema, '#s=%E0%A4%A')).toEqual({});
    expect(decodeShare(schema, '')).toEqual({});
  });
});

describe('share link amounts: exact, rounded or left out', () => {
  it('rounds each amount on its own scale to its first two digits: $12,345.67 to $12,000 and $137.50 to $140', () => {
    expect(roundForShare(1_234_567)).toBe(1_200_000);
    expect(roundForShare(13_750)).toBe(14_000);
    expect(roundForShare(13_749)).toBe(14_000); // $137.49 rounds to $140 too: the step is $10
    expect(roundForShare(13_499)).toBe(13_000);
    expect(roundForShare(725)).toBe(700); // $7.25 to $7: never finer than a whole dollar
    expect(roundForShare(99_999)).toBe(100_000); // $999.99 to $1,000
    expect(roundForShare(0)).toBe(0);
    expect(roundForShare(10_000_000_000)).toBe(10_000_000_000);
  });

  it('rejects an amount that is not whole cents', () => {
    expect(() => roundForShare(10.5)).toThrow(RangeError);
    expect(() => roundForShare(-100)).toThrow(RangeError);
  });

  it('keeps, rounds or removes only the money fields, and records the mode', () => {
    const state = { p: 1_234_567, r: '5.25', c: 13_750, y: 10 };
    expect(shareAmounts(state, ['p', 'c'], 'exact')).toEqual({ ...state, a: 'exact' });
    expect(shareAmounts(state, ['p', 'c'], 'rounded')).toEqual({ p: 1_200_000, r: '5.25', c: 14_000, y: 10, a: 'rounded' });
    expect(shareAmounts(state, ['p', 'c'], 'none')).toEqual({ r: '5.25', y: 10, a: 'none' });
  });

  it('a No amounts link contains no dollar amount at all', () => {
    const schema: Schema = { p: { kind: 'int', min: 0, max: 10_000_000_000 }, y: { kind: 'int', min: 1, max: 100 }, a: AMOUNTS_FIELD };
    const fragment = encodeShare(schema, shareAmounts({ p: 1_234_567, y: 10 }, ['p'], 'none'));
    expect(decodeURIComponent(fragment)).toBe('s=v=1&y=10&a=none');
    expect(decodeShare(schema, `#${fragment}`)).toEqual({ y: 10, a: 'none' });
  });
});

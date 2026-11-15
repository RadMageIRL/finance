import { describe, expect, it } from 'vitest';
import { scanText } from '../../tools/text-scan.mjs';

const scan = (text: string) => scanText(text);

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

describe('house-style text scan', () => {
  it('passes clean text, including ordinary hyphens and the word "said"', () => {
    expect(scan('A well-known rate - quoted as 4.00% - is fine.\nShe said so.')).toEqual([]);
  });

  it('catches a planted em dash with its line number', () => {
    expect(scan(`first line\nsecond ${EM_DASH} line`)).toEqual([{ line: 2, rule: 'em dash' }]);
  });

  it('catches a planted en dash', () => {
    expect(scan(`pages 4${EN_DASH}5`)).toEqual([{ line: 1, rule: 'en dash' }]);
  });

  it('catches a co-author trailer and assistant attribution', () => {
    const trailer = ['Co', 'Authored', 'By'].join('-') + ': Someone <a@b.c>';
    const credit = 'Built with ' + ['Clau', 'de'].join('');
    expect(scan(trailer)).toEqual([{ line: 1, rule: 'attribution text' }]);
    expect(scan(credit)).toEqual([{ line: 1, rule: 'attribution text' }]);
    expect(scan('This text is ' + ['AI', 'generated'].join('-'))).toEqual([{ line: 1, rule: 'attribution text' }]);
  });
});

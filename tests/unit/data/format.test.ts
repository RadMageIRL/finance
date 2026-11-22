// Exact decimal-string formatting for the dashboards (src/lib/data/format.ts).
import { describe, expect, it } from 'vitest';
import { DETECTED_LABEL, easternDate, formatDay, formatMonth, formatPeriod, groupDigits, roundHalfUp, shiftLeft } from '../../../src/lib/data/format';

describe('decimal strings', () => {
  it('rounds half up, away from zero, exactly, including carries', () => {
    expect(roundHalfUp('40.61050685690325', 2)).toBe('40.61');
    expect(roundHalfUp('2.345', 2)).toBe('2.35');
    expect(roundHalfUp('2.344', 2)).toBe('2.34');
    expect(roundHalfUp('9.995', 2)).toBe('10.00');
    expect(roundHalfUp('-0.004', 2)).toBe('0.00');
    expect(roundHalfUp('-1.005', 2)).toBe('-1.01');
    expect(roundHalfUp('3.88', 0)).toBe('4');
    expect(roundHalfUp('7', 3)).toBe('7.000');
  });
  it('groups the integer part only', () => {
    expect(groupDigits('38422818570606.72')).toBe('38,422,818,570,606.72');
    expect(groupDigits('-1234')).toBe('-1,234');
    expect(groupDigits('999')).toBe('999');
  });
  it('moves the decimal point left exactly and trims zeros', () => {
    expect(shiftLeft('40610506856903.25', 12)).toBe('40.61050685690325');
    expect(shiftLeft('23426.3', 3)).toBe('23.4263');
    expect(shiftLeft('5', 2)).toBe('0.05');
    expect(shiftLeft('1000', 3)).toBe('1');
    expect(shiftLeft('-250', 2)).toBe('-2.5');
    expect(shiftLeft('12.5', 0)).toBe('12.5');
  });
  it('throws on anything that is not a decimal string', () => {
    expect(() => roundHalfUp('1e3', 2)).toThrow(/decimal/);
    expect(() => groupDigits('')).toThrow(/decimal/);
    expect(() => shiftLeft('1.2.3', 1)).toThrow(/decimal/);
  });
});

describe('dates', () => {
  it('writes days and months as words', () => {
    expect(formatDay('2026-11-17')).toBe('November 17, 2026');
    expect(formatDay('2008-12-16')).toBe('December 16, 2008');
    expect(formatMonth('2026-10')).toBe('October 2026');
    expect(formatPeriod('1959-01')).toBe('January 1959');
    expect(formatPeriod('2026-01-02')).toBe('January 2, 2026');
    expect(() => formatDay('2026-13-01')).toThrow(/date/);
    expect(() => formatMonth('2026-1')).toThrow(/month/);
  });
});

describe('Eastern Time dates of UTC times (owner brief R item 6)', () => {
  it('gives the America/New_York date in standard time, UTC minus 5 hours', () => {
    expect(easternDate('2026-11-21T03:00:00Z')).toBe('2026-11-20');
    expect(easternDate('2026-11-21T04:59:59Z')).toBe('2026-11-20');
    expect(easternDate('2026-11-21T05:00:00Z')).toBe('2026-11-21');
    expect(easternDate('2027-01-01T04:59:59Z')).toBe('2026-12-31');
  });
  it('gives the America/New_York date in daylight time, UTC minus 4 hours', () => {
    expect(easternDate('2026-07-04T03:59:59Z')).toBe('2026-07-03');
    expect(easternDate('2026-07-04T04:00:00Z')).toBe('2026-07-04');
  });
  it('changes offset at 2:00 a.m. local time on the second Sunday in March and the first Sunday in November', () => {
    // 2026-03-08: standard time until 07:00 UTC, so 04:30 UTC is still the evening of March 7.
    expect(easternDate('2026-03-08T04:30:00Z')).toBe('2026-03-07');
    expect(easternDate('2026-03-08T05:00:00Z')).toBe('2026-03-08');
    // 2026-11-01: daylight time until 06:00 UTC; on November 2, 04:30 UTC is 11:30 p.m. on November 1 in standard time.
    expect(easternDate('2026-11-01T03:30:00Z')).toBe('2026-10-31');
    expect(easternDate('2026-11-02T04:30:00Z')).toBe('2026-11-01');
    expect(easternDate('2026-11-02T05:00:00Z')).toBe('2026-11-02');
  });
  it('refuses anything but a stored UTC time', () => {
    expect(() => easternDate('2026-11-21')).toThrow(/stored UTC time/);
    expect(() => easternDate('2026-11-21T03:00:00+00:00')).toThrow(/stored UTC time/);
  });
  it('labels the detection date of every change log as an Eastern Time date', () => {
    expect(DETECTED_LABEL).toBe('Detected (Eastern Time date)');
  });
});

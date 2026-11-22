// Display rules of the shared dashboard shell (brief Q, agent 4) that go beyond
// src/lib/data/format.ts. Pure and dependency free (format.ts aside), so the build and the
// browser scripts use the same code. Every number shown comes from the dataset's decimal
// strings; nothing here rounds, converts or computes a value.
//
// RULES (the independent oracle tests/oracle/econ_shell.py is written from these):
//
// T1 Value with its unit. The unit label decides the words:
//    - "Percent": the value, a space, "percent" ("3.88 percent").
//    - "U.S. dollars": a dollar sign and the value with its whole part grouped by commas
//      ("$40,626,506,856,903.25"); a negative value puts the minus sign before the dollar
//      sign ("-$12.50").
//    - a unit label that starts with "Billions of U.S. dollars": as for dollars, then a
//      space and "billion" ("$20,073.6 billion").
//    - any other unit label: the grouped value, a space, and the unit label in parentheses.
//    The digits after the decimal point are never changed: "4.00" stays "4.00".
// T2 A range: "<lower> to <upper> percent" when the unit is "Percent", otherwise both ends
//    worded by T1 and joined by " to ".
// T3 A reference period by the series frequency: "business-day" gives "Business day of
//    <Month D, YYYY>", "month" gives "<Month YYYY>", "change-point" gives "In effect from
//    <Month D, YYYY>"; any other frequency gives the period in words (a day or a month).
// T4 A stored UTC time YYYY-MM-DDTHH:MM:SSZ is shown as "<Month D, YYYY> at HH:MM UTC",
//    with ":SS" after the minutes only when the seconds are not 00. Times stay in UTC: no
//    zone conversion is made, so no rule about daylight saving time is needed.
// T5 A snapshot id YYYYMMDDTHHMMSSZ is the UTC time it names, worded by T4.
// T6 A release date by its basis (design P28 6.1): "rule" gives "Publication day by the
//    New York Fed's schedule: <date>"; "calendar" gives "Released in the H.6 release of
//    <date>"; "first-seen" gives "First seen by RadMage Finance on <date> (Eastern Time
//    date)"; "not-recorded", a missing date or an unknown basis gives "Release date not
//    recorded". <date> is "<Month D, YYYY>". A first-seen date is the Eastern Time date of
//    the snapshot that first held the value (conventions 6.3), shown next to UTC times, so it
//    is labeled (owner briefs R item 6 and T).
// T7 Two decimal strings compare by their exact values ("4.00" equals "4"; "-0" equals "0").
import { formatDay, formatMonth, formatPeriod, groupDigits } from './format';

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** T1: a decimal string with its unit in words. */
export function valueText(value: string, unitLabel: string): string {
  if (!DECIMAL.test(value)) throw new Error(`not a decimal string: ${value}`);
  const neg = value.startsWith('-') && /[1-9]/.test(value);
  const abs = value.replace(/^-/, '');
  if (unitLabel === 'Percent') return `${neg ? '-' : ''}${abs} percent`;
  if (unitLabel === 'U.S. dollars') return `${neg ? '-' : ''}$${groupDigits(abs)}`;
  if (unitLabel.startsWith('Billions of U.S. dollars')) return `${neg ? '-' : ''}$${groupDigits(abs)} billion`;
  return `${neg ? '-' : ''}${groupDigits(abs)} (${unitLabel})`;
}

/** T2: a range of two decimal strings in one unit. */
export function rangeText(lower: string, upper: string, unitLabel: string): string {
  if (unitLabel === 'Percent') {
    if (!DECIMAL.test(lower) || !DECIMAL.test(upper)) throw new Error('not a decimal range');
    return `${lower} to ${upper} percent`;
  }
  return `${valueText(lower, unitLabel)} to ${valueText(upper, unitLabel)}`;
}

/** T3: a reference period in words, by the series frequency. */
export function periodText(frequency: string, period: string): string {
  if (frequency === 'business-day') return `Business day of ${formatDay(period)}`;
  if (frequency === 'month') return formatMonth(period);
  if (frequency === 'change-point') return `In effect from ${formatDay(period)}`;
  return formatPeriod(period);
}

const UTC = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

/** True for a stored time in the form YYYY-MM-DDTHH:MM:SSZ. */
export function isUtcTime(t: unknown): t is string {
  return typeof t === 'string' && UTC.test(t);
}

/** T4: a stored UTC time in words. */
export function timeText(t: string): string {
  const m = UTC.exec(t);
  if (!m) throw new Error(`not a stored UTC time: ${t}`);
  return `${formatDay(m[1] ?? '')} at ${m[2]}:${m[3]}${m[4] === '00' ? '' : `:${m[4]}`} UTC`;
}

/** The stored UTC time a snapshot id names, or null for anything else. */
export function snapshotTime(id: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(id);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

/** T5: a snapshot id in words (the id itself when it is not in the snapshot form). */
export function snapshotText(id: string): string {
  const t = snapshotTime(id);
  return t ? timeText(t) : id;
}

/** The manifest's `last_released` (an object { basis, date } or null), read defensively. */
export function releasedOf(raw: unknown): { basis: string; date: string | null } {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    return { basis: typeof r.basis === 'string' ? r.basis : 'not-recorded', date: typeof r.date === 'string' ? r.date : null };
  }
  return { basis: 'not-recorded', date: null };
}

/** T6: a release date worded by its basis. */
export function releaseText(basis: string, date: string | null): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Release date not recorded';
  if (basis === 'rule') return `Publication day by the New York Fed's schedule: ${formatDay(date)}`;
  if (basis === 'calendar') return `Released in the H.6 release of ${formatDay(date)}`;
  if (basis === 'first-seen') return `First seen by RadMage Finance on ${formatDay(date)} (Eastern Time date)`;
  return 'Release date not recorded';
}

/** T7: compares two decimal strings exactly; negative, zero or positive like a sort comparator. */
export function compareDecimal(a: string, b: string): number {
  if (!DECIMAL.test(a) || !DECIMAL.test(b)) throw new Error(`not decimal strings: ${a}, ${b}`);
  const norm = (s: string) => {
    const neg = s.startsWith('-');
    const [i = '0', f = ''] = (neg ? s.slice(1) : s).split('.');
    const int = i.replace(/^0+(?=\d)/, '');
    const frac = f.replace(/0+$/, '');
    const zero = /^0*$/.test(int) && frac === '';
    return { neg: neg && !zero, int, frac };
  };
  const x = norm(a);
  const y = norm(b);
  if (x.neg !== y.neg) return x.neg ? -1 : 1;
  const sign = x.neg ? -1 : 1;
  if (x.int.length !== y.int.length) return sign * (x.int.length < y.int.length ? -1 : 1);
  if (x.int !== y.int) return sign * (x.int < y.int ? -1 : 1);
  const n = Math.max(x.frac.length, y.frac.length);
  const fx = x.frac.padEnd(n, '0');
  const fy = y.frac.padEnd(n, '0');
  return fx === fy ? 0 : sign * (fx < fy ? -1 : 1);
}

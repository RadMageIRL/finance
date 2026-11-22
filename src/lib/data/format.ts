// Exact display formatting of the decimal strings a dataset holds (brief Q shared interface).
// Every function takes and returns strings; nothing goes through floating point, so a displayed
// number is always the published string, grouped, or rounded half up from it (design P28 8.2).
//
// SHARED FILE (brief Q): owned by the integrator; dashboard agents use it and never change it.

const DECIMAL = /^-?\d+(\.\d+)?$/;

function parts(s: string): { neg: boolean; int: string; frac: string } {
  if (!DECIMAL.test(s)) throw new Error(`not a decimal string: ${s}`);
  const neg = s.startsWith('-');
  const [int = '0', frac = ''] = (neg ? s.slice(1) : s).split('.');
  return { neg, int, frac };
}

/** Rounds a decimal string half up (away from zero at .5) to `places` decimals, exactly. */
export function roundHalfUp(s: string, places: number): string {
  if (!Number.isInteger(places) || places < 0) throw new Error('places must be a whole number');
  const { neg, int, frac } = parts(s);
  const padded = (frac + '0'.repeat(places + 1)).slice(0, places + 1);
  let n = BigInt(int + padded.slice(0, places));
  if (Number(padded.charAt(places)) >= 5) n += 1n;
  const digits = n.toString().padStart(places + 1, '0');
  const out = places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits;
  return neg && /[1-9]/.test(out) ? `-${out}` : out;
}

/** Groups the integer part with commas: "38422818570606.72" gives "38,422,818,570,606.72". */
export function groupDigits(s: string): string {
  const { neg, int, frac } = parts(s);
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** Moves the decimal point left by `digits` places, exactly: shiftLeft("40610506856903.25", 12) gives "40.61050685690325". */
export function shiftLeft(s: string, digits: number): string {
  if (!Number.isInteger(digits) || digits < 0) throw new Error('digits must be a whole number');
  const { neg, int, frac } = parts(s);
  const whole = int.padStart(digits + 1, '0');
  const point = whole.length - digits;
  const intPart = whole.slice(0, point).replace(/^0+(?=\d)/, '');
  const fracPart = (whole.slice(point) + frac).replace(/0+$/, '');
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;
  return neg && /[1-9]/.test(out) ? `-${out}` : out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-11-17" gives "November 17, 2026". */
export function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month) throw new Error(`not a date: ${iso}`);
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

/** "2026-10" gives "October 2026". */
export function formatMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !month) throw new Error(`not a month: ${iso}`);
  return `${month} ${m[1]}`;
}

/** A reference period as words: a day or a month. */
export function formatPeriod(period: string): string {
  return /^\d{4}-\d{2}$/.test(period) ? formatMonth(period) : formatDay(period);
}

const EASTERN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * The Eastern Time date (America/New_York, YYYY-MM-DD) of a stored UTC time YYYY-MM-DDTHH:MM:SSZ:
 * Eastern daylight time (UTC minus 4 hours) from 2:00 a.m. local time on the second Sunday in March
 * to 2:00 a.m. local time on the first Sunday in November, Eastern standard time (UTC minus 5 hours)
 * otherwise. Visitor-facing change logs show this date, labeled as an Eastern Time date (owner brief
 * R item 6; design P28 6.4; DATA_CONVENTIONS 1: dates derived from times are ET dates); technical
 * timestamps stay in UTC and say so.
 */
export function easternDate(utc: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(utc)) throw new Error(`not a stored UTC time: ${utc}`);
  return EASTERN_DATE.format(new Date(utc));
}

/** The column label of a change log's detection date (owner brief R item 6). */
export const DETECTED_LABEL = 'Detected (Eastern Time date)';

// Money and rounding (ENGINE_CONVENTIONS section 2). Pure: no DOM, no I/O.

/** An integer number of cents. */
export type Cents = number;

/** Largest money input any engine accepts: $100,000,000.00. */
export const MAX_CENTS = 10_000_000_000;

/**
 * Tolerance for treating a float as an exact half: a few units of double precision
 * relative to the value, and never more than 2^-20 of a cent, so it can never swallow a
 * real fraction (ENGINE_CONVENTIONS section 2, v1.1). Used only where a value is not a
 * ratio of decimals (payment formula, daily-growth credits, percents); interest postings
 * are exact (periodicInterest).
 */
const HALF_TOLERANCE_RELATIVE = 2 ** -50;
const HALF_TOLERANCE_MAX = 2 ** -20;

/**
 * Rounds a nonnegative value to a whole number, halves up. A value within the tolerance of
 * a half is treated as an exact half, so a value that is mathematically a half but arrives
 * as x.4999999999999998 rounds the way exact decimal arithmetic rounds it.
 */
function roundHalfUp(magnitude: number): number {
  const whole = Math.floor(magnitude);
  const fraction = magnitude - whole;
  const tolerance = Math.min(Math.max(magnitude, 1) * HALF_TOLERANCE_RELATIVE, HALF_TOLERANCE_MAX);
  if (Math.abs(fraction - 0.5) <= tolerance) return whole + 1;
  return fraction > 0.5 ? whole + 1 : whole;
}

/**
 * A nonnegative finite number as an exact decimal fraction digits / 10^scale, using the
 * shortest decimal text that round-trips the float (0.0525 is 525 / 10^4).
 */
function exactDecimal(value: number): { digits: bigint; scale: bigint } {
  const [mantissa = '0', exponentText] = value.toString().split('e');
  const [whole = '0', fraction = ''] = mantissa.split('.');
  let digits = BigInt(whole + fraction);
  let scale = fraction.length - Number(exponentText ?? 0);
  if (scale < 0) {
    digits *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { digits, scale: 10n ** BigInt(scale) };
}

/**
 * Interest for one period, posted to the cent: balance x annualRate / periodsPerYear,
 * rounded half away from zero, computed exactly in integers so ties round exactly as
 * decimal arithmetic rounds them at any magnitude (ENGINE_CONVENTIONS section 2).
 */
export function periodicInterest(balance: Cents, annualRate: number, periodsPerYear: number): Cents {
  if (!Number.isSafeInteger(balance) || balance < 0) throw new RangeError(`periodicInterest: balance ${balance} must be whole cents, 0 or more`);
  if (!Number.isFinite(annualRate) || annualRate < 0) throw new RangeError(`periodicInterest: rate ${annualRate} must be 0 or more`);
  if (!Number.isInteger(periodsPerYear) || periodsPerYear < 1) throw new RangeError(`periodicInterest: ${periodsPerYear} periods per year`);
  const rate = exactDecimal(annualRate);
  const numerator = BigInt(balance) * rate.digits;
  const denominator = rate.scale * BigInt(periodsPerYear);
  // floor(numerator / denominator + 1/2): half up, which is away from zero for a nonnegative value.
  return Number((2n * numerator + denominator) / (2n * denominator));
}

/**
 * Rounds an amount in cents, possibly fractional, to a whole cent, half away from zero.
 * The single money rounding rule; applied only at posting points.
 */
export function roundCents(value: number): Cents {
  if (!Number.isFinite(value)) throw new RangeError(`roundCents: ${value} is not finite`);
  const rounded = roundHalfUp(Math.abs(value));
  if (rounded === 0) return 0;
  return value < 0 ? -rounded : rounded;
}

/**
 * Rounds a percent to two decimals, half away from zero (12 CFR 1030.3(f)(1): "rounded to
 * the nearest one-hundredth of one percentage point").
 */
export function roundPercent2(percent: number): number {
  if (!Number.isFinite(percent)) throw new RangeError(`roundPercent2: ${percent} is not finite`);
  const hundredths = roundHalfUp(Math.abs(percent) * 100);
  if (hundredths === 0) return 0;
  return (percent < 0 ? -hundredths : hundredths) / 100;
}

/** A percent rounded to two decimals, as text: 5.645 gives "5.65". */
export function percent2Text(percent: number): string {
  return roundPercent2(percent).toFixed(2);
}

export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Sum of whole-cent amounts. Throws if any amount is not a whole cent. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) {
    if (!isCents(value)) throw new RangeError(`sumCents: ${value} is not a whole cent amount`);
    total += value;
  }
  return total;
}

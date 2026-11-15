// Input validation shared by the engines (ENGINE_CONVENTIONS section 7).
// Invalid input is reported with every problem at once, never computed.

export type IssueCode =
  | 'not-a-number'
  | 'not-an-integer'
  | 'below-minimum'
  | 'above-maximum'
  | 'unsupported-value'
  | 'payment-does-not-cover-interest'
  | 'result-too-large';

export interface Issue {
  /** The input field the problem belongs to, for example `annualRate` or `oneTime[2].month`. */
  field: string;
  code: IssueCode;
  /** The bound that was crossed, or the allowed values, when there is one. */
  limit?: number | readonly number[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

interface NumberRule {
  min: number;
  max: number;
  integer?: boolean;
}

/** Collects problems across all fields of one input object. */
export class Checker {
  readonly issues: Issue[] = [];

  /** Checks a number against its range; returns true when it is valid. */
  number(field: string, value: unknown, rule: NumberRule): boolean {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.issues.push({ field, code: 'not-a-number' });
      return false;
    }
    if (rule.integer && !Number.isInteger(value)) {
      this.issues.push({ field, code: 'not-an-integer' });
      return false;
    }
    if (value < rule.min) {
      this.issues.push({ field, code: 'below-minimum', limit: rule.min });
      return false;
    }
    if (value > rule.max) {
      this.issues.push({ field, code: 'above-maximum', limit: rule.max });
      return false;
    }
    return true;
  }

  /** Checks that a value is one of an allowed set; returns true when it is. */
  oneOf<T extends number | string>(field: string, value: unknown, allowed: readonly T[]): value is T {
    if (!(allowed as readonly unknown[]).includes(value)) {
      const numeric = allowed.every((a) => typeof a === 'number');
      this.issues.push(
        numeric
          ? { field, code: 'unsupported-value', limit: allowed as readonly number[] }
          : { field, code: 'unsupported-value' },
      );
      return false;
    }
    return true;
  }

  add(issue: Issue): void {
    this.issues.push(issue);
  }

  get ok(): boolean {
    return this.issues.length === 0;
  }

  fail<T>(): Result<T> {
    return { ok: false, issues: [...this.issues] };
  }
}

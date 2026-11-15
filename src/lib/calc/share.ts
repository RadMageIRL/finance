// Share links (FINANCIAL_MODEL_REQUIREMENTS 6.3). Scenario state lives in the URL fragment
// (#s=...), which browsers never send to a server. The schema is versioned, values are
// validated on load, unknown or invalid fields are dropped, and there is never free text.

export type FieldSpec =
  | { kind: 'int'; min: number; max: number }
  | { kind: 'decimal'; min: number; max: number; decimals: number }
  | { kind: 'choice'; values: readonly string[] };

export type Schema = Readonly<Record<string, FieldSpec>>;
export type ShareState = Record<string, number | string>;

export const SHARE_VERSION = 1;

/** Encodes state as `v=1&key=value...` in schema order, for the fragment `#s=`. */
export function encodeShare(schema: Schema, state: ShareState): string {
  const parts = [`v=${SHARE_VERSION}`];
  for (const key of Object.keys(schema)) {
    if (key in state) parts.push(`${key}=${encodeURIComponent(String(state[key]))}`);
  }
  return `s=${encodeURIComponent(parts.join('&'))}`;
}

/**
 * Reads state from a fragment. Returns only fields that pass the schema; anything unknown,
 * malformed, out of range or from another version is dropped.
 */
export function decodeShare(schema: Schema, fragment: string): ShareState {
  const out: ShareState = {};
  const raw = fragment.replace(/^#/, '');
  const match = /(?:^|&)s=([^&]*)/.exec(raw);
  if (!match) return out;
  let inner: string;
  try {
    inner = decodeURIComponent(match[1]!);
  } catch {
    return out;
  }
  const params = new Map<string, string>();
  for (const pair of inner.split('&')) {
    const [k, v = ''] = pair.split('=');
    if (!k) continue;
    try {
      params.set(k, decodeURIComponent(v));
    } catch {
      // drop malformed values
    }
  }
  if (params.get('v') !== String(SHARE_VERSION)) return out;
  for (const [key, spec] of Object.entries(schema)) {
    const text = params.get(key);
    if (text === undefined || text.length > 32) continue;
    if (spec.kind === 'choice') {
      if (spec.values.includes(text)) out[key] = text;
      continue;
    }
    const pattern = spec.kind === 'int' ? /^-?\d+$/ : new RegExp(`^-?\\d+(\\.\\d{1,${spec.decimals}})?$`);
    if (!pattern.test(text)) continue;
    const value = Number(text);
    if (Number.isFinite(value) && value >= spec.min && value <= spec.max) out[key] = value;
  }
  return out;
}

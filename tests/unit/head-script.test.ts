// Runs the exact theme bootstrap string that ships in every page head against simulated
// browser conditions.
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { HEAD_SCRIPT, THEME_STORAGE_KEY } from '../../src/lib/theme/head-script.mjs';

interface Env {
  stored?: string | null;
  storageThrows?: boolean;
  prefersLight?: boolean;
  matchMediaThrows?: boolean;
}

function run(env: Env) {
  const attributes: Record<string, string> = {};
  const classes = new Set<string>();
  const window = {
    get localStorage() {
      if (env.storageThrows) throw new Error('SecurityError: storage blocked');
      return {
        getItem: (key: string) => (key === THEME_STORAGE_KEY ? env.stored ?? null : null),
      };
    },
    matchMedia: (query: string) => {
      if (env.matchMediaThrows) throw new Error('matchMedia unavailable');
      return { matches: query === '(prefers-color-scheme: light)' && Boolean(env.prefersLight) };
    },
  };
  const document = {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        attributes[name] = value;
      },
      classList: { add: (name: string) => classes.add(name) },
    },
  };
  runInNewContext(HEAD_SCRIPT, { window, document });
  return { theme: attributes['data-theme'], choice: attributes['data-theme-choice'], js: classes.has('js') };
}

describe('theme head script', () => {
  it('defaults to dark when nothing is stored', () => {
    expect(run({})).toEqual({ theme: 'dark', choice: 'dark', js: true });
  });

  it('defaults to dark even when the system prefers light', () => {
    expect(run({ prefersLight: true })).toEqual({ theme: 'dark', choice: 'dark', js: true });
  });

  it('applies a stored light choice', () => {
    expect(run({ stored: 'light' })).toEqual({ theme: 'light', choice: 'light', js: true });
  });

  it('applies a stored dark choice', () => {
    expect(run({ stored: 'dark', prefersLight: true })).toEqual({ theme: 'dark', choice: 'dark', js: true });
  });

  it('resolves System to light when the system prefers light', () => {
    expect(run({ stored: 'system', prefersLight: true })).toEqual({ theme: 'light', choice: 'system', js: true });
  });

  it('resolves System to dark when the system prefers dark or states no preference', () => {
    expect(run({ stored: 'system', prefersLight: false })).toEqual({ theme: 'dark', choice: 'system', js: true });
  });

  it('ignores unknown stored values', () => {
    expect(run({ stored: 'sepia', prefersLight: true })).toEqual({ theme: 'dark', choice: 'dark', js: true });
    expect(run({ stored: 'LIGHT' })).toEqual({ theme: 'dark', choice: 'dark', js: true });
  });

  it('falls back to dark when storage access throws', () => {
    expect(run({ storageThrows: true, prefersLight: true })).toEqual({ theme: 'dark', choice: 'dark', js: true });
  });

  it('falls back to dark when System is stored but matchMedia throws', () => {
    expect(run({ stored: 'system', matchMediaThrows: true })).toEqual({ theme: 'dark', choice: 'system', js: true });
  });
});

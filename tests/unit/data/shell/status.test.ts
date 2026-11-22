// The freshness status (src/lib/data/status.ts) beyond the oracle cases: the build-time status
// as of the snapshot (S2), the device clock in the stored form, and the refusals.
import { describe, expect, it } from 'vitest';
import { deviceNow, pageState, refreshOutcome, refreshText, statusLabel, statusSentence, viewStatus } from '../../../../src/lib/data/status';

const fresh = { status: 'fresh', status_reason: null, deadline: '2026-11-26T08:15:00Z', stale_at: '2026-12-01T08:15:00Z' };

describe('status at the snapshot and at view time', () => {
  it('keeps the manifest status at its own generated_at (S2) and turns stale only at stale_at (S1)', () => {
    expect(viewStatus(fresh, '2026-11-25T15:17:00Z')).toBe('fresh');
    expect(viewStatus(fresh, '2026-11-26T08:15:00Z')).toBe('fresh');
    expect(viewStatus(fresh, '2026-11-26T08:15:01Z')).toBe('due');
    expect(viewStatus(fresh, '2026-12-01T08:14:59Z')).toBe('due');
    expect(viewStatus(fresh, '2026-12-01T08:15:00Z')).toBe('stale');
  });

  it('never makes data newer: stale, held and frozen stay as published whatever the clock', () => {
    for (const status of ['stale', 'held', 'frozen', 'not-yet-published'] as const) {
      expect(viewStatus({ ...fresh, status }, '2000-01-01T00:00:00Z')).toBe(status);
    }
  });

  it('throws on a clock that is not a stored UTC time', () => {
    expect(() => viewStatus(fresh, '2026-11-25T15:17:00.000Z')).toThrow();
    expect(() => viewStatus(fresh, '2026-11-25')).toThrow();
  });

  it('reads the device clock in the stored form, to the second', () => {
    expect(deviceNow(new Date(Date.UTC(2026, 10, 21, 9, 5, 7, 999)))).toBe('2026-11-21T09:05:07Z');
  });

  it('words a due series with the deadline it missed, and labels it apart from fresh', () => {
    expect(statusSentence('due', fresh)).toBe('Update pending: the next value was expected by November 26, 2026 at 08:15 UTC and is not in this data yet.');
    expect(statusSentence('due', { ...fresh, deadline: null })).toBe('Update pending: the next expected value is not in this data yet.');
    expect(statusLabel('due')).toBe('Update pending');
    expect(statusLabel('fresh')).toBe('Up to date');
  });
});

describe('page state and the newer-data check', () => {
  it('says unavailable without data and fixture for test data, whatever the statuses (S4)', () => {
    expect(pageState(null, ['stale'])).toBe('unavailable');
    expect(pageState('fixture', ['stale'])).toBe('fixture');
    expect(pageState('release', ['fresh', 'due', 'held'])).toBe('current');
    expect(pageState('release', ['due', 'stale'])).toBe('stale');
  });

  it('treats any answer but a 200 with a snapshot id as failed, and says nothing for the same snapshot (S5)', () => {
    const build = '20261125T151700Z';
    expect(refreshOutcome(build, 304, { snapshot: { id: build } })).toBe('failed');
    expect(refreshOutcome(build, 200, { snapshot: { id: '20261125T151700' } })).toBe('failed');
    expect(refreshOutcome(build, 200, { snapshot: { id: build } })).toBe('same');
    expect(refreshText('same')).toBe('');
    expect(refreshOutcome(build, 200, { snapshot: { id: '20261126T001700Z' } })).toBe('newer');
    expect(refreshOutcome(build, 200, { snapshot: { id: '20261124T001700Z' } })).toBe('changed');
  });
});

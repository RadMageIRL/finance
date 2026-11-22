// The freshness status of a series and of a page (design P28 7.1 to 7.5, decision D7), for
// the shared dashboard shell (brief Q, agent 4). Pure: the build computes the status as of
// the snapshot and the browser computes it again with the device clock, with the same code.
//
// RULES (the independent oracle tests/oracle/econ_shell.py is written from these):
//
// S1 The status of a series at a time `now` (a stored UTC time YYYY-MM-DDTHH:MM:SSZ; times
//    compare as instants, which for this fixed form is the order of the strings):
//    - the manifest's `held`, `frozen` and `not-yet-published` stay as they are, whatever
//      the time: a review or a rollback decides them, not the clock (they take precedence
//      over staleness, conventions 9);
//    - `stale` stays `stale`: a clock can only make data older, never newer;
//    - `fresh` becomes `stale` when `stale_at` is set and `now` is at or after it (the same
//      comparison as the collector's freshness, 21.4);
//    - otherwise `fresh` becomes `due` when `deadline` is set and `now` is after it: the next
//      value was expected and is not in this data, but the staleness rule has not run out;
//    - otherwise `fresh` stays `fresh`;
//    - any other manifest status is `unknown`.
//    A `deadline` or `stale_at` that is not a stored UTC time counts as not set.
// S2 Without JavaScript the page cannot read the clock, so the build uses `now` =
//    the manifest's `generated_at`: the status as of the snapshot (7.5).
// S3 The wording of each status (7.1, with the dates worded by T4 of shell-text.ts):
//    fresh:   "Up to date. Next value expected by <deadline>." ("Up to date." with no deadline)
//    due:     "Update pending: the next value was expected by <deadline> and is not in this
//             data yet." ("Update pending: the next expected value is not in this data yet."
//             with no deadline) (owner brief T: correct the freshness labels; the earlier
//             "Up to date when last checked" could be false, since a snapshot can already be
//             past its deadline when it is made)
//    stale:   "May be out of date: the next value was expected by <deadline>."
//             ("May be out of date." with no deadline)
//    held:    "New data from the source is waiting for review; the values shown are the last
//             accepted ones."
//    frozen:  "Updates are paused after a rollback: <reason>" when the reason starts with
//             "rolled back", otherwise "Updates are paused after a review decision: <reason>";
//             the reason ends with a period (one is added when it has none). With no reason:
//             "Updates are paused after a review decision."
//    not-yet-published: "No data published yet."
//    unknown: "The status of this series is not recognized."
//    Each status also has a short label that says it in words, so color is never the only
//    signal: "Up to date" (fresh), "Update pending" (due), "May be out of date" (stale),
//    "Held for review", "Updates paused", "No data yet", "Status unknown".
// S4 The state of a page: `unavailable` when the build had no dataset; otherwise `fixture`
//    for the appendix B test data; otherwise `stale` when any series the page shows is stale
//    by S1; otherwise `current`.
// S5 The check for newer data (design 8.7, scoped for v0.2.0). The page knows the snapshot it
//    was built from. The answer to its fetch of the manifest is:
//    - `failed` when the request failed, the answer was not 200, or the body is not a JSON
//      object whose `snapshot.id` is a snapshot id (YYYYMMDDTHHMMSSZ);
//    - `same` when that id is the build's;
//    - `newer` when it is later than the build's (ids compare in time order as strings);
//    - `changed` when it is earlier (a rollback, for example).
//    Wording: same says nothing; newer "Newer data is available. Reload the page to see it.";
//    changed "The published data has changed since this page was built. Reload the page to
//    see it."; failed "Could not check for newer data. This page shows the data it was built
//    with."
import { isUtcTime, timeText } from './shell-text';
import type { DataState } from './ui';

export type SeriesStatusKind = 'fresh' | 'due' | 'stale' | 'held' | 'frozen' | 'not-yet-published' | 'unknown';

/** The manifest fields a status needs. */
export interface StatusFields {
  status: string;
  status_reason: string | null;
  deadline: string | null;
  stale_at: string | null;
}

/** The device clock as a stored UTC time (YYYY-MM-DDTHH:MM:SSZ), to the second, for S1 at view time. */
export function deviceNow(date: Date = new Date()): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

/** S1: the status of a series at `now`. */
export function viewStatus(s: StatusFields, now: string): SeriesStatusKind {
  if (!isUtcTime(now)) throw new Error(`not a stored UTC time: ${now}`);
  if (s.status === 'held' || s.status === 'frozen' || s.status === 'not-yet-published' || s.status === 'stale') return s.status;
  if (s.status !== 'fresh') return 'unknown';
  if (isUtcTime(s.stale_at) && now >= s.stale_at) return 'stale';
  if (isUtcTime(s.deadline) && now > s.deadline) return 'due';
  return 'fresh';
}

const LABELS: Record<SeriesStatusKind, string> = {
  fresh: 'Up to date',
  due: 'Update pending',
  stale: 'May be out of date',
  held: 'Held for review',
  frozen: 'Updates paused',
  'not-yet-published': 'No data yet',
  unknown: 'Status unknown',
};

/** S3: the short label of a status. */
export function statusLabel(kind: SeriesStatusKind): string {
  return LABELS[kind];
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** S3: the wording of a status. */
export function statusSentence(kind: SeriesStatusKind, s: StatusFields): string {
  const deadline = isUtcTime(s.deadline) ? timeText(s.deadline) : null;
  const reason = s.status_reason?.trim() || null;
  switch (kind) {
    case 'fresh':
      return deadline ? `Up to date. Next value expected by ${deadline}.` : 'Up to date.';
    case 'due':
      return deadline ? `Update pending: the next value was expected by ${deadline} and is not in this data yet.` : 'Update pending: the next expected value is not in this data yet.';
    case 'stale':
      return deadline ? `May be out of date: the next value was expected by ${deadline}.` : 'May be out of date.';
    case 'held':
      return 'New data from the source is waiting for review; the values shown are the last accepted ones.';
    case 'frozen':
      if (!reason) return 'Updates are paused after a review decision.';
      return reason.startsWith('rolled back') ? `Updates are paused after a rollback: ${sentence(reason)}` : `Updates are paused after a review decision: ${sentence(reason)}`;
    case 'not-yet-published':
      return 'No data published yet.';
    default:
      return 'The status of this series is not recognized.';
  }
}

/** S4: the state of a page from its dataset and the statuses of the series it shows. */
export function pageState(source: 'fixture' | 'release' | null, kinds: readonly SeriesStatusKind[]): DataState {
  if (source === null) return 'unavailable';
  if (source === 'fixture') return 'fixture';
  return kinds.includes('stale') ? 'stale' : 'current';
}

export type RefreshOutcome = 'same' | 'newer' | 'changed' | 'failed';

const SNAPSHOT_ID = /^\d{8}T\d{6}Z$/;

/**
 * S5: what the answer to the manifest fetch means for a page built from `buildSnapshot`.
 * `status` is the HTTP status (0 when the request failed) and `body` the parsed JSON (or
 * undefined when it did not parse).
 */
export function refreshOutcome(buildSnapshot: string, status: number, body: unknown): RefreshOutcome {
  if (status !== 200 || !body || typeof body !== 'object' || Array.isArray(body)) return 'failed';
  const snapshot = (body as Record<string, unknown>).snapshot;
  const id = snapshot && typeof snapshot === 'object' ? (snapshot as Record<string, unknown>).id : undefined;
  if (typeof id !== 'string' || !SNAPSHOT_ID.test(id)) return 'failed';
  if (id === buildSnapshot) return 'same';
  return id > buildSnapshot ? 'newer' : 'changed';
}

/** S5: the notice for an outcome; empty for `same`. */
export function refreshText(outcome: RefreshOutcome): string {
  if (outcome === 'newer') return 'Newer data is available. Reload the page to see it.';
  if (outcome === 'changed') return 'The published data has changed since this page was built. Reload the page to see it.';
  if (outcome === 'failed') return 'Could not check for newer data. This page shows the data it was built with.';
  return '';
}

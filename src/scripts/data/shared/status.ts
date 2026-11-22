// The status of each series at view time (decision D7; design P28 7.2): the build wrote the
// status as of the snapshot; this computes it again with the device clock from the same
// attributes and the same rules (src/lib/data/status.ts S1 and S3). A page's stale notice shows
// through CSS once any series on it reads stale. Nothing is announced: this runs on load, not
// in answer to the reader.
import { deviceNow, statusLabel, statusSentence, viewStatus } from '../../../lib/data/status';

export function refreshStatuses(now: string = deviceNow()): void {
  document.querySelectorAll<HTMLElement>('[data-status-of]').forEach((el) => {
    const fields = {
      status: el.dataset.status ?? '',
      status_reason: el.dataset.reason ?? null,
      deadline: el.dataset.deadline ?? null,
      stale_at: el.dataset.staleAt ?? null,
    };
    const kind = viewStatus(fields, now);
    el.dataset.viewStatus = kind;
    const label = el.querySelector('[data-status-label]');
    const text = el.querySelector('[data-status-text]');
    if (label) label.textContent = statusLabel(kind);
    if (text) text.textContent = statusSentence(kind, fields);
  });
  document.querySelectorAll<HTMLElement>('[data-stamp-clock]').forEach((el) => {
    el.textContent = "Each status is checked against your device's clock. The values are those of the snapshot above.";
  });
}

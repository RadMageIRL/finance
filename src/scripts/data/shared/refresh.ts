// The check for newer data (design P28 8.7, scoped for v0.2.0). Only a build from a verified
// release checks (data-check="release" on the stamp), because only there is the manifest part
// of the same deployment; the browser itself logs any request that fails, which no page code
// can prevent, so a build without data never asks. One same-origin request, cache "no-cache"
// (Pages sends max-age=600). The same snapshot changes nothing; a newer or a different one
// shows a notice asking for a reload (the page is not redrawn); a failure keeps the build-time
// data with a quiet notice. Nothing is logged to the console.
import { refreshOutcome, refreshText } from '../../../lib/data/status';

export async function checkForNewerData(fetchImpl: typeof fetch = fetch): Promise<void> {
  const stamp = document.querySelector<HTMLElement>('[data-econ-stamp]');
  if (!stamp || stamp.dataset.check !== 'release' || !stamp.dataset.snapshot || !stamp.dataset.manifestUrl) return;
  const live = stamp.querySelector<HTMLElement>('[data-refresh-status]');
  const loading = stamp.querySelector<HTMLElement>('[data-notice="loading"]');
  if (loading) loading.hidden = false;
  stamp.dataset.refresh = 'loading';
  let status = 0;
  let body: unknown;
  try {
    const answer = await fetchImpl(stamp.dataset.manifestUrl, { cache: 'no-cache', credentials: 'same-origin' });
    status = answer.status;
    body = status === 200 ? await answer.json() : undefined;
  } catch {
    body = undefined;
  }
  const outcome = refreshOutcome(stamp.dataset.snapshot, status, body);
  if (loading) loading.hidden = true;
  stamp.dataset.refresh = outcome;
  if (live) {
    live.textContent = refreshText(outcome);
    live.dataset.outcome = outcome;
  }
}

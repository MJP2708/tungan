/**
 * How many requests the person is waiting on (2026-10-09), for the thin
 * progress bar at the top of the app. Background checks — the 12-second
 * change probe, the announcement check — are not counted: a bar that blinks
 * on its own every few seconds teaches people to ignore it.
 */

let pending = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Count a request while it runs. */
export function track<T>(work: Promise<T>): Promise<T> {
  pending += 1;
  emit();
  return work.finally(() => {
    pending = Math.max(0, pending - 1);
    emit();
  });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function pendingRequests(): number {
  return pending;
}

/** Requests the app makes by itself, which never show the bar. */
export function isBackgroundRequest(path: string, method = 'GET'): boolean {
  if (method.toUpperCase() !== 'GET') return false;
  return /\/changes(\?|$)/.test(path) || /^\/api\/announcements(\?|$)/.test(path);
}

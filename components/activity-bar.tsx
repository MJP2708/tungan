'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { pendingRequests, subscribe } from '@/lib/api/activity';
import { t } from '@/lib/i18n';

/** Waits shorter than this never show the bar, so a quick tap does not
 *  flicker it. */
const SHOW_AFTER_MS = 200;

/**
 * A thin brand-blue line across the top while the person is waiting on the
 * server (2026-10-09). It runs while requests are out and finishes with a
 * short sweep to the end when they are back. Requests the app makes by
 * itself never show it (lib/api/activity.ts).
 */
export function ActivityBar() {
  const pending = useSyncExternalStore(subscribe, pendingRequests, () => 0);
  const [state, setState] = useState<'idle' | 'active' | 'done'>('idle');

  useEffect(() => {
    if (pending > 0) {
      if (state === 'active') return;
      const id = window.setTimeout(() => setState('active'), SHOW_AFTER_MS);
      return () => window.clearTimeout(id);
    }
    if (state !== 'active') {
      if (state !== 'idle') setState('idle');
      return;
    }
    setState('done');
    const id = window.setTimeout(() => setState('idle'), 320);
    return () => window.clearTimeout(id);
  }, [pending, state]);

  return (
    <div
      className="activity-bar"
      data-state={state}
      role="progressbar"
      aria-hidden={state === 'idle'}
      aria-label={t('กำลังโหลด')}
      aria-busy={state === 'active'}
    >
      <span />
    </div>
  );
}

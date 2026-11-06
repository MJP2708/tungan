/**
 * Which scheduler is calling, and is the system keeping up (2026-11-06).
 *
 * cron-job.org is the primary: every 15 minutes, 08:00–21:45 Bangkok.
 * GitHub Actions (.github/workflows/reminders.yml) is the backup, and also
 * the alarm: it fails — and GitHub emails the owner — when the primary has
 * gone quiet or reminders are not going out. Vercel's own cron runs once a
 * day as a last resort.
 *
 * Pure, so the rules are tested without a clock or a database.
 */

export type Scheduler = 'github' | 'vercel' | 'primary';

/** GitHub says so in a header; Vercel's cron by its user agent; anything
 *  else with the secret is the primary (cron-job.org). */
export function schedulerOf(headers: { get(name: string): string | null }): Scheduler {
  if ((headers.get('x-scheduler') ?? '').toLowerCase() === 'github') return 'github';
  if (/vercel-cron/i.test(headers.get('user-agent') ?? '')) return 'vercel';
  return 'primary';
}

/** The primary's window, Bangkok wall clock, as minutes after midnight. */
const WINDOW = { start: 8 * 60, end: 21 * 60 + 45 };
/** Quiet this long inside the window means the primary has stopped. */
export const PRIMARY_SILENT_MINUTES = 90;
/** Nothing sent this long while reminders are overdue means they are stuck. */
export const STALE_HOURS = 26;

export function schedulerHealth(input: {
  now: Date;
  /** Bangkok minutes after midnight for `now`. */
  bangkokMinutes: number;
  primaryLastSeenAt: Date | null;
  remindersLastSentAt: Date | null;
  /** Pending reminders more than an hour past their time. */
  overdueReminders: number;
}) {
  const inWindow = input.bangkokMinutes >= WINDOW.start + PRIMARY_SILENT_MINUTES && input.bangkokMinutes <= WINDOW.end;
  const primarySilent =
    inWindow &&
    (!input.primaryLastSeenAt ||
      input.now.getTime() - input.primaryLastSeenAt.getTime() > PRIMARY_SILENT_MINUTES * 60_000);
  const stale =
    input.overdueReminders > 0 &&
    (!input.remindersLastSentAt ||
      input.now.getTime() - input.remindersLastSentAt.getTime() > STALE_HOURS * 3600_000);
  return { primarySilent, stale };
}

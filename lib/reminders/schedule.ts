import { fromZonedWallClock, zonedDateParts, PRODUCT_TIME_ZONE } from '../deadline.ts';

export type QuietHours = { start: string; end: string };

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** Is a Bangkok wall-clock instant inside the workspace's quiet window? */
export function inQuietHours(
  at: Date,
  quiet: QuietHours,
  timeZone: string = PRODUCT_TIME_ZONE,
): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  const now = minutesOfDay(parts);
  const start = minutesOfDay(quiet.start);
  const end = minutesOfDay(quiet.end);
  if (start === end) return false; // window disabled
  // A window like 21:00 -> 08:00 wraps past midnight.
  return start > end ? now >= start || now < end : now >= start && now < end;
}

export type ScheduleDecision = {
  /** When the reminder should actually be sent. */
  sendAt: Date;
  /** The intended time before any quiet-hours shift. Stored alongside so a
   *  shift can never schedule a second reminder for the same deadline. */
  originalSendAt: Date;
  shifted: 'none' | 'earlier' | 'later';
  reason: string;
};

/**
 * Decide when to send the reminder for a deadline.
 *
 * The rule that matters, and the one worth arguing about: a reminder that
 * arrives *after* its deadline is not a reminder, it is a notification of
 * failure. So the two cases are handled differently.
 *
 *  - Deadline falls INSIDE quiet hours (e.g. due 22:00, quiet 21:00-08:00):
 *    pull the reminder EARLIER, to the last allowed minute before the window
 *    opens (20:59). Deferring to 08:00 would land after the work was due.
 *
 *  - Deadline falls after quiet hours but the reminder would land inside them
 *    (e.g. due 09:00, remind 1h before = 08:00 is fine; due 08:30, remind at
 *    07:30 is inside): push the reminder LATER, to the moment the window
 *    closes (08:00), which is still before the deadline.
 *
 *  - If even the window close is after the deadline, send at the window close
 *    anyway and let it read as late rather than dropping it entirely.
 *
 * `originalSendAt` is always the unshifted time, and the reminder table has a
 * unique index on (task, recipient, originalSendAt). That is what stops a
 * shift, a retry, or a re-run creating a duplicate.
 */
export function scheduleReminder(
  params: {
    dueAt: Date;
    /** How long before the deadline we would like to remind. */
    leadMinutes?: number;
    quiet: QuietHours;
    timeZone?: string;
  },
): ScheduleDecision {
  const timeZone = params.timeZone ?? PRODUCT_TIME_ZONE;
  const lead = params.leadMinutes ?? 60;
  const originalSendAt = new Date(params.dueAt.getTime() - lead * 60000);

  const dueInQuiet = inQuietHours(params.dueAt, params.quiet, timeZone);
  const sendInQuiet = inQuietHours(originalSendAt, params.quiet, timeZone);

  if (!sendInQuiet && !dueInQuiet) {
    return {
      sendAt: originalSendAt,
      originalSendAt,
      shifted: 'none',
      reason: 'ส่งได้ตามเวลาปกติ',
    };
  }

  if (dueInQuiet) {
    // Pull back to one minute before the quiet window opens, on the day the
    // window opens relative to the deadline.
    const before = lastMomentBeforeQuiet(params.dueAt, params.quiet, timeZone);
    return {
      sendAt: before,
      originalSendAt,
      shifted: 'earlier',
      reason: 'กำหนดส่งอยู่ในช่วงเวลาเงียบ จึงเตือนก่อนเข้าช่วงเงียบ',
    };
  }

  const after = firstMomentAfterQuiet(originalSendAt, params.quiet, timeZone);
  return {
    sendAt: after,
    originalSendAt,
    shifted: 'later',
    reason: 'เวลาเตือนตกในช่วงเงียบ จึงเลื่อนไปหลังช่วงเงียบ',
  };
}

function lastMomentBeforeQuiet(at: Date, quiet: QuietHours, timeZone: string): Date {
  const start = minutesOfDay(quiet.start);
  const p = zonedDateParts(at, timeZone);
  const atMinutes = minutesOfDay(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at),
  );
  // If the deadline is in the early-morning tail of a wrapping window
  // (e.g. 02:00 with quiet 21:00-08:00), the window opened the previous day.
  const dayOffset = minutesOfDay(quiet.start) > minutesOfDay(quiet.end) && atMinutes < start ? -1 : 0;
  const target = start - 1;
  return fromZonedWallClock(
    p.year,
    p.month,
    p.day + dayOffset,
    Math.floor(target / 60),
    target % 60,
    timeZone,
  );
}

function firstMomentAfterQuiet(at: Date, quiet: QuietHours, timeZone: string): Date {
  const end = minutesOfDay(quiet.end);
  const start = minutesOfDay(quiet.start);
  const p = zonedDateParts(at, timeZone);
  const atMinutes = minutesOfDay(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at),
  );
  // In a wrapping window, a time at or after `start` belongs to the night that
  // ends on the following day.
  const dayOffset = start > end && atMinutes >= start ? 1 : 0;
  return fromZonedWallClock(
    p.year,
    p.month,
    p.day + dayOffset,
    Math.floor(end / 60),
    end % 60,
    timeZone,
  );
}

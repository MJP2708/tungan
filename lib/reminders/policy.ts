export { PRODUCT_TIME_ZONE };
import {
  fromZonedWallClock,
  zonedDateParts,
  PRODUCT_TIME_ZONE,
} from '../deadline.ts';

/**
 * When to remind, and when to stop.
 *
 * The rule this encodes: a reminder path must END. Repetition is what makes
 * people mute a bot, and a muted bot fails silently forever — which is worse
 * than not reminding at all, because everyone still believes it is working.
 *
 * So each task gets at most one nudge to the person doing it, before the
 * deadline, plus at most one escalation to the person who asked for it,
 * after. Nothing recurs.
 */

export type WorkingHours = {
  /** "HH:MM" in Asia/Bangkok. */
  startsAt: string;
  endsAt: string;
};

export const DEFAULT_WORKING_HOURS: WorkingHours = { startsAt: '09:00', endsAt: '18:00' };

/** Minutes before the deadline we would like to nudge. */
export const DEFAULT_LEAD_MINUTES = 120;

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function wallClockMinutes(at: Date, timeZone: string) {
  return minutesOf(
    new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(at),
  );
}

/** 1 = Monday … 7 = Sunday, in the product timezone. */
function isoWeekday(at: Date, timeZone: string) {
  const day = zonedDateParts(at, timeZone).weekday; // 0 = Sunday
  return day === 0 ? 7 : day;
}

export function isWorkingDay(at: Date, timeZone: string = PRODUCT_TIME_ZONE) {
  return isoWeekday(at, timeZone) <= 5;
}

/** Start of the next working day at or after `from`. */
export function nextWorkingMorning(
  from: Date,
  hours: WorkingHours = DEFAULT_WORKING_HOURS,
  timeZone: string = PRODUCT_TIME_ZONE,
): Date {
  const start = minutesOf(hours.startsAt);
  let cursor = from;
  for (let i = 0; i < 8; i++) {
    const p = zonedDateParts(cursor, timeZone);
    const candidate = fromZonedWallClock(
      p.year, p.month, p.day, Math.floor(start / 60), start % 60, timeZone,
    );
    if (candidate.getTime() > from.getTime() && isWorkingDay(candidate, timeZone)) {
      return candidate;
    }
    cursor = new Date(candidate.getTime() + 24 * 3600000);
  }
  return new Date(from.getTime() + 24 * 3600000);
}

export type AssigneeNudge = {
  /** Null when the task should never nudge the assignee. */
  sendAt: Date | null;
  reason: string;
};

/**
 * The single pre-deadline nudge for the person doing the work.
 *
 * Deliberately never after the deadline: once it has passed, another message
 * to the assignee tells them something they already know, and it is the
 * repetition that gets the bot muted. After the deadline the task shows in
 * their digest and escalates to the owner instead.
 */
export function planAssigneeNudge(
  params: {
    dueAt: Date;
    now?: Date;
    leadMinutes?: number;
    hours?: WorkingHours;
    /** ติดปัญหา: the assignee is already blocked, so nudging them is noise. */
    blocked?: boolean;
    timeZone?: string;
  },
): AssigneeNudge {
  const now = params.now ?? new Date();
  const timeZone = params.timeZone ?? PRODUCT_TIME_ZONE;
  const hours = params.hours ?? DEFAULT_WORKING_HOURS;

  if (params.blocked) {
    return { sendAt: null, reason: 'งานติดปัญหาอยู่ ไม่เตือนผู้รับ แต่แจ้งผู้สั่งงานแทน' };
  }
  if (params.dueAt.getTime() <= now.getTime()) {
    return { sendAt: null, reason: 'เลยกำหนดแล้ว ไม่เตือนผู้รับซ้ำ' };
  }

  const lead = params.leadMinutes ?? DEFAULT_LEAD_MINUTES;
  let sendAt = new Date(params.dueAt.getTime() - lead * 60000);

  // A deadline early in the day would put the nudge before anyone is working,
  // where it is buried by morning. Move it to the start of the working day
  // instead — still before the deadline, and actually read.
  const startMin = minutesOf(hours.startsAt);
  if (wallClockMinutes(sendAt, timeZone) < startMin) {
    const p = zonedDateParts(sendAt, timeZone);
    const atStart = fromZonedWallClock(
      p.year, p.month, p.day, Math.floor(startMin / 60), startMin % 60, timeZone,
    );
    // Only if that is still before the deadline; otherwise keep the original.
    if (atStart.getTime() < params.dueAt.getTime()) sendAt = atStart;
  }

  if (sendAt.getTime() <= now.getTime()) {
    return { sendAt: null, reason: 'ใกล้กำหนดเกินกว่าจะเตือนล่วงหน้าได้' };
  }
  return { sendAt, reason: 'เตือนล่วงหน้าก่อนถึงกำหนด' };
}

/**
 * The single escalation to the person who asked for the work.
 *
 * One message per owner per morning, merged across everything of theirs that
 * is late — never per task, and never into the group. Posting someone's
 * overdue work publicly is blame, and it costs per recipient.
 */
export function planOwnerEscalation(
  params: { dueAt: Date; now?: Date; hours?: WorkingHours; timeZone?: string },
): Date {
  const now = params.now ?? new Date();
  const hours = params.hours ?? DEFAULT_WORKING_HOURS;
  const timeZone = params.timeZone ?? PRODUCT_TIME_ZONE;
  const after = params.dueAt.getTime() > now.getTime() ? params.dueAt : now;
  return nextWorkingMorning(after, hours, timeZone);
}

/**
 * When to nudge the reviewer about a submission nobody has looked at.
 *
 * Measured from the moment of submission, not the deadline: work handed in
 * three days early should not be chased three days early. One nudge only —
 * and never an auto-approval, because an approval nobody made is a record
 * that proves nothing, which defeats the point of collecting evidence.
 *
 * The result is moved to the reviewer's working hours, so a submission at
 * 22:00 does not produce a nudge at 22:00 the next night.
 */
export function planReviewNudge(
  params: {
    submittedAt: Date;
    afterHours: number;
    now?: Date;
    hours?: WorkingHours;
    timeZone?: string;
  },
): Date {
  const hours = params.hours ?? DEFAULT_WORKING_HOURS;
  const timeZone = params.timeZone ?? PRODUCT_TIME_ZONE;
  const target = new Date(params.submittedAt.getTime() + params.afterHours * 3600000);
  const startMinutes = minutesOf(hours.startsAt);
  const endMinutes = minutesOf(hours.endsAt);
  const atMinutes = wallClockMinutes(target, timeZone);
  // Inside working hours on a working day, the raw time is already right.
  if (isWorkingDay(target, timeZone) && atMinutes >= startMinutes && atMinutes < endMinutes) {
    return target;
  }
  return nextWorkingMorning(target, hours, timeZone);
}

/**
 * Messages to the same person close together are one message.
 *
 * Push is billed per recipient, so two nudges five minutes apart cost twice
 * as much as one listing both tasks — and read as nagging besides.
 */
export const MERGE_WINDOW_MINUTES = 15;

export function mergeKey(recipientUserId: string, sendAt: Date): string {
  const bucket = Math.floor(sendAt.getTime() / (MERGE_WINDOW_MINUTES * 60000));
  return `${recipientUserId}:${bucket}`;
}

import { zonedDateParts, PRODUCT_TIME_ZONE } from './deadline.ts';

/**
 * The month view on กำหนดส่ง (2026-10-09): deadlines laid out by Bangkok
 * calendar day. A view of what is already stored, not a calendar of its own —
 * no events, no sync. Calendar sync stays out of scope.
 *
 * Days are keyed "YYYY-MM-DD" in Asia/Bangkok, because a task due at 23:30
 * Bangkok is due that day, even though it is the next day nowhere near UTC.
 * Pure: the caller passes `now`.
 */

export type DayKey = string;

export type CalendarDay = {
  key: DayKey;
  day: number;
  /** False for the leading and trailing days of the neighbouring months. */
  inMonth: boolean;
};

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKeyOf(year: number, month: number, day: number): DayKey {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The Bangkok calendar day an instant falls on, or null for no deadline. */
export function dayKey(
  at: Date | string | null | undefined,
  timeZone: string = PRODUCT_TIME_ZONE,
): DayKey | null {
  if (!at) return null;
  const instant = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(instant.getTime())) return null;
  const p = zonedDateParts(instant, timeZone);
  return dayKeyOf(p.year, p.month, p.day);
}

/** Month arithmetic on {year, month (1-12)}, for the ‹ › buttons. */
export function shiftMonth(
  at: { year: number; month: number },
  by: number,
): { year: number; month: number } {
  const index = at.year * 12 + (at.month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * Whole weeks, Sunday first as Thai wall calendars are, covering the month.
 * Always 6 rows, so the page does not jump in height between months.
 */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  // Calendar arithmetic only — UTC here is a neutral grid, not a time zone.
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < 6; w += 1) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + w * 7 + d);
      week.push({
        key: dayKeyOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()),
        day: date.getUTCDate(),
        inMonth: date.getUTCMonth() === month - 1,
      });
    }
    weeks.push(week);
  }
  return weeks;
}

type Dated = { dueAt: string | null; status: string };

export type DayLoad<T extends Dated> = {
  tasks: T[];
  /** Still open and already past due. */
  late: number;
};

/** Tasks grouped by the day they are due. Undated tasks are left out. */
export function tasksByDay<T extends Dated>(
  tasks: readonly T[],
  now: Date,
  opts: { includeDone?: boolean } = {},
): Map<DayKey, DayLoad<T>> {
  const map = new Map<DayKey, DayLoad<T>>();
  for (const task of tasks) {
    if (task.status === 'done' && !opts.includeDone) continue;
    const key = dayKey(task.dueAt);
    if (!key) continue;
    const entry = map.get(key) ?? { tasks: [], late: 0 };
    entry.tasks.push(task);
    // Handed-in work waits on the reviewer, so it is not late (as elsewhere).
    const open = task.status !== 'done' && task.status !== 'review';
    if (open && Date.parse(task.dueAt!) < now.getTime()) entry.late += 1;
    map.set(key, entry);
  }
  for (const entry of map.values()) {
    entry.tasks.sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!));
  }
  return map;
}

export const THAI_WEEKDAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const;
export const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
] as const;

/** "ตุลาคม 2569": Thai month, Buddhist-era year, as Thai calendars print it. */
export function monthTitle(year: number, month: number): string {
  return `${THAI_MONTHS[month - 1]} ${year + 543}`;
}

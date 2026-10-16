import { zonedDateParts, fromZonedWallClock, PRODUCT_TIME_ZONE } from '../deadline.ts';

/**
 * งานฉัน: every task assigned to me, across all my groups, plus my personal
 * tasks (2026-10-17). Pure — the app page and the LINE card both use these
 * sections, in this order, so "most urgent" means the same thing everywhere.
 *
 * Each open task lands in exactly one section:
 *   revision  ส่งกลับแก้ไข — sent back to me; needs action, so it goes FIRST
 *   overdue   เลยกำหนด
 *   today     วันนี้ (Asia/Bangkok calendar day)
 *   week      สัปดาห์นี้ — after today, up to the end of Sunday (Bangkok)
 *   later     ภายหลัง — after this week, or no deadline
 *   review    รอตรวจ — I handed it in; waiting for a Manager
 * Closed (done) tasks are not listed.
 */

export type MyTask = {
  id: string;
  title: string;
  dueAt: Date | string | null;
  status: string;
  reviewState: string;
  blockedReason: string | null;
  workspaceId: string;
  /** The group's name, or null for a personal task (shown as ส่วนตัว). */
  groupName: string | null;
  personal: boolean;
};

export type MySectionKey = 'revision' | 'overdue' | 'today' | 'week' | 'later' | 'review';

/** Display order. ส่งกลับแก้ไข leads whenever it has anything in it. */
export const MY_SECTION_ORDER: readonly MySectionKey[] = ['revision', 'overdue', 'today', 'week', 'later', 'review'];

export const MY_SECTION_TITLES: Record<MySectionKey, string> = {
  revision: 'ส่งกลับแก้ไข',
  overdue: 'เลยกำหนด',
  today: 'วันนี้',
  week: 'สัปดาห์นี้',
  later: 'ภายหลัง',
  review: 'รอตรวจ',
};

const instant = (value: Date | string | null): Date | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
};

/** Start of the next Bangkok day after `now`, and of the next Monday. */
function bangkokBounds(now: Date) {
  const p = zonedDateParts(now, PRODUCT_TIME_ZONE);
  const tomorrow = fromZonedWallClock(p.year, p.month, p.day + 1, 0, 0, PRODUCT_TIME_ZONE);
  // weekday: 0 Sunday … 6 Saturday. The week ends with Sunday.
  const daysToMonday = p.weekday === 0 ? 1 : 8 - p.weekday;
  const nextMonday = fromZonedWallClock(p.year, p.month, p.day + daysToMonday, 0, 0, PRODUCT_TIME_ZONE);
  return { tomorrow, nextMonday };
}

/** Which section, or null for a task that is not listed (closed). */
export function mySectionOf(task: MyTask, now: Date): MySectionKey | null {
  if (task.status === 'done') return null;
  if (task.status === 'review') return 'review';
  if (task.reviewState === 'revision') return 'revision';
  const due = instant(task.dueAt);
  if (!due) return 'later';
  if (due.getTime() < now.getTime()) return 'overdue';
  const { tomorrow, nextMonday } = bangkokBounds(now);
  if (due.getTime() < tomorrow.getTime()) return 'today';
  if (due.getTime() < nextMonday.getTime()) return 'week';
  return 'later';
}

export type MySection = { key: MySectionKey; title: string; items: MyTask[]; total: number };

/**
 * Sections in order, empty ones left out, soonest deadline first inside each
 * (no deadline last). `cap` limits each section's rows; `total` keeps the
 * real count so the page can say how many more there are.
 */
export function mySections(tasks: readonly MyTask[], now: Date, cap = Infinity): MySection[] {
  const groups = new Map<MySectionKey, MyTask[]>();
  for (const task of tasks) {
    const key = mySectionOf(task, now);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  const at = (t: MyTask) => instant(t.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  return MY_SECTION_ORDER.filter((key) => groups.has(key)).map((key) => {
    const items = groups.get(key)!.sort((a, b) => at(a) - at(b));
    return { key, title: MY_SECTION_TITLES[key], items: items.slice(0, cap), total: items.length };
  });
}

/** The n most urgent, by the same section order — for the LINE card. */
export function mostUrgent(tasks: readonly MyTask[], now: Date, n = 5): Array<MyTask & { section: MySectionKey }> {
  return mySections(tasks, now)
    .flatMap((s) => s.items.map((t) => ({ ...t, section: s.key })))
    .slice(0, n);
}

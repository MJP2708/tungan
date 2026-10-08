import { t } from '../i18n/index.ts';
/**
 * The manager overview: what in a workspace needs someone's attention now.
 *
 * A list of every task tells a manager nothing they can act on; these lists
 * do. Each open task lands in at most one of them, by the first reason that
 * applies, so the same task is never counted twice and the totals add up:
 *
 *   late        past its deadline and still with the worker
 *   blocked     ติดปัญหา — someone is waiting on something
 *   review      handed in, waiting for whoever asked to sign it off
 *   unassigned  nobody is responsible for it
 *   unaccepted  assigned, but nobody has said "รับงาน" for a day, or it is
 *               due within a day and still not accepted
 *   quiet       accepted, not late, but no change of status for 3+ days
 *
 * Deterministic and explainable: every item carries how long it has been in
 * that state, which is the number a manager can actually say out loud
 * ("รอตรวจมา 2 วัน"). Pure: no I/O, no clock of its own, so it is tested
 * with a fixed `now`.
 */

export type OverviewTask = {
  id: string;
  title: string;
  status: 'todo' | 'progress' | 'blocked' | 'review' | 'done';
  dueAt: string | null;
  assigneeId: string;
  acceptedAt?: string | null;
  pendingAssigneeId?: string | null;
  submittedAt?: string | null;
  closedAt?: string | null;
  /** When the status last changed. Absent on old clients; treated as unknown. */
  statusChangedAt?: string | null;
};

export type AttentionKind =
  | 'late'
  | 'blocked'
  | 'review'
  | 'unassigned'
  | 'unaccepted'
  | 'quiet';

export const ATTENTION_ORDER: readonly AttentionKind[] = [
  'late',
  'blocked',
  'review',
  'unassigned',
  'unaccepted',
  'quiet',
];

export type AttentionItem<T extends OverviewTask = OverviewTask> = {
  task: T;
  kind: AttentionKind;
  /** How long it has been in this state, in ms. For `late`, time past due. */
  forMs: number;
};

export type PersonLoad = {
  memberId: string;
  /** Still with this person: ต้องทำ, กำลังทำ, ติดปัญหา. */
  open: number;
  late: number;
  /** Handed in, waiting for sign-off. Not this person's move. */
  inReview: number;
  /** Open and due within the next 7 days (late ones not included). */
  dueThisWeek: number;
  /** Clearly more than everyone else: at least 5 open and at least twice the
   *  team's average. Two numbers, so a team of two with 2 and 1 tasks never
   *  calls anyone overloaded. */
  heavy: boolean;
};

export type TeamOverview<T extends OverviewTask = OverviewTask> = {
  attention: Record<AttentionKind, AttentionItem<T>[]>;
  /** Sum of every attention list. */
  attentionTotal: number;
  people: PersonLoad[];
  open: number;
  closedLast7Days: number;
  closedPrevious7Days: number;
};

const HOUR = 3600000;
const DAY = 24 * HOUR;
export const QUIET_AFTER_MS = 3 * DAY;
export const UNACCEPTED_AFTER_MS = DAY;

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

const withWorker = (s: OverviewTask['status']) =>
  s === 'todo' || s === 'progress' || s === 'blocked';

/** The first reason this task needs attention, or null when it is fine. */
export function attentionFor(
  task: OverviewTask,
  now: Date,
): { kind: AttentionKind; forMs: number } | null {
  if (task.status === 'done') return null;
  const t = now.getTime();
  const due = ms(task.dueAt);
  const since = ms(task.statusChangedAt);
  const age = (from: number | null) => (from === null ? 0 : Math.max(0, t - from));

  // Handed-in work is not late: the time is spent in the reviewer's queue.
  if (withWorker(task.status) && due !== null && due < t) {
    return { kind: 'late', forMs: t - due };
  }
  if (task.status === 'blocked') return { kind: 'blocked', forMs: age(since) };
  if (task.status === 'review') {
    return { kind: 'review', forMs: age(ms(task.submittedAt) ?? since) };
  }
  if (!task.assigneeId) return { kind: 'unassigned', forMs: age(since) };
  if (!task.acceptedAt || task.pendingAssigneeId) {
    const waited = age(since);
    const dueSoon = due !== null && due - t <= DAY;
    if (waited >= UNACCEPTED_AFTER_MS || dueSoon) return { kind: 'unaccepted', forMs: waited };
    return null;
  }
  if (since !== null && t - since >= QUIET_AFTER_MS) {
    return { kind: 'quiet', forMs: t - since };
  }
  return null;
}

export function teamOverview<T extends OverviewTask>(
  tasks: readonly T[],
  memberIds: readonly string[],
  now: Date,
): TeamOverview<T> {
  const t = now.getTime();
  const attention = Object.fromEntries(
    ATTENTION_ORDER.map((k) => [k, [] as AttentionItem<T>[]]),
  ) as Record<AttentionKind, AttentionItem<T>[]>;

  for (const task of tasks) {
    const hit = attentionFor(task, now);
    if (hit) attention[hit.kind].push({ task, ...hit });
  }
  // Longest-waiting first: that is the one to chase.
  for (const kind of ATTENTION_ORDER) attention[kind].sort((a, b) => b.forMs - a.forMs);

  const people: PersonLoad[] = memberIds.map((memberId) => {
    const mine = tasks.filter((task) => task.assigneeId === memberId);
    const open = mine.filter((task) => withWorker(task.status));
    const isLate = (task: T) => {
      const due = ms(task.dueAt);
      return due !== null && due < t;
    };
    return {
      memberId,
      open: open.length,
      late: open.filter(isLate).length,
      inReview: mine.filter((task) => task.status === 'review').length,
      dueThisWeek: open.filter((task) => {
        const due = ms(task.dueAt);
        return due !== null && due >= t && due - t <= 7 * DAY;
      }).length,
      heavy: false,
    };
  });
  const average = people.length
    ? people.reduce((sum, p) => sum + p.open, 0) / people.length
    : 0;
  for (const person of people) person.heavy = person.open >= 5 && person.open >= 2 * average;
  people.sort((a, b) => b.late - a.late || b.open - a.open);

  const closedWithin = (from: number, to: number) =>
    tasks.filter((task) => {
      if (task.status !== 'done') return false;
      const closed = ms(task.closedAt);
      return closed !== null && closed > t - from && closed <= t - to;
    }).length;

  return {
    attention,
    attentionTotal: ATTENTION_ORDER.reduce((sum, k) => sum + attention[k].length, 0),
    people,
    open: tasks.filter((task) => task.status !== 'done').length,
    closedLast7Days: closedWithin(7 * DAY, 0),
    closedPrevious7Days: closedWithin(14 * DAY, 7 * DAY),
  };
}

/** "3 วัน", "5 ชม.", "ไม่ถึงชั่วโมง" — how long, for a person to read. */
export function formatSpan(forMs: number): string {
  if (forMs >= DAY) return t('{0} วัน', Math.floor(forMs / DAY));
  if (forMs >= HOUR) return t('{0} ชม.', Math.floor(forMs / HOUR));
  return t('ไม่ถึงชั่วโมง');
}

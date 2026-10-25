import 'server-only';
import { and, eq, gte, inArray, ne } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { lineUser, task, workspace, workspaceMember } from '../db/schema.ts';
import { listTaskEvents } from '../db/events.ts';
import type { Audience } from '../events/visibility.ts';
import { formatDeadline, fromZonedWallClock, zonedDateParts } from '../deadline.ts';

/**
 * What the summaries are given (2026-10-25). Gathered here so the routes do
 * not reach into the database, and so what a model may see is decided in one
 * place: a task's history comes through listTaskEvents with the reader's own
 * audience, and a group summary carries titles, names and the public blocked
 * preset — never a private note.
 */

const STATUS_TH: Record<string, string> = {
  todo: 'ยังไม่เริ่ม',
  progress: 'กำลังทำ',
  blocked: 'ติดปัญหา',
  review: 'รอตรวจ',
  done: 'ปิดแล้ว',
};

export async function findTask(id: string) {
  const [found] = await db().select().from(task).where(eq(task.id, id)).limit(1);
  return found ?? null;
}

/** Workspace nickname first, LINE display name otherwise. */
async function namesIn(workspaceId: string, userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  const rows = await db()
    .select({ id: lineUser.id, displayName: lineUser.displayName, nickname: workspaceMember.nickname })
    .from(lineUser)
    .leftJoin(
      workspaceMember,
      and(eq(workspaceMember.userId, lineUser.id), eq(workspaceMember.workspaceId, workspaceId)),
    )
    .where(inArray(lineUser.id, ids));
  return new Map(rows.map((r) => [r.id, r.nickname || r.displayName || 'สมาชิก']));
}

export async function taskSummaryInput(
  found: typeof task.$inferSelect,
  audience: Audience,
  now = new Date(),
) {
  const history = await listTaskEvents(found.id, audience);
  const names = await namesIn(found.workspaceId, found.assigneeUserId ? [found.assigneeUserId] : []);
  return {
    title: found.title,
    status: STATUS_TH[found.status] ?? found.status,
    due: found.dueAt ? formatDeadline(found.dueAt, { now }) : 'ไม่มีกำหนด',
    assignee: found.assigneeUserId ? (names.get(found.assigneeUserId) ?? 'สมาชิก') : 'ยังไม่มีคนรับผิดชอบ',
    history: history.map((e) => ({
      at: formatDeadline(e.at, { now }),
      who: e.actorName || 'ระบบ',
      what: e.detail || e.kind,
    })),
  };
}

/** Start of today, or of this week (Monday), in Bangkok. */
export function periodStart(range: 'day' | 'week', now: Date): Date {
  const { year, month, day, weekday } = zonedDateParts(now); // weekday 0 = Sunday
  const today = fromZonedWallClock(year, month, day, 0, 0);
  if (range === 'day') return today;
  const back = (weekday + 6) % 7;
  return new Date(today.getTime() - back * 86400000);
}

export async function periodSummaryInput(workspaceId: string, range: 'day' | 'week', now = new Date()) {
  const since = periodStart(range, now);
  const [ws] = await db().select({ name: workspace.name }).from(workspace).where(eq(workspace.id, workspaceId)).limit(1);
  const cols = {
    title: task.title,
    assigneeUserId: task.assigneeUserId,
    status: task.status,
    dueAt: task.dueAt,
    blockedReason: task.blockedReason,
  };
  const [closed, created, open] = await Promise.all([
    db().select(cols).from(task).where(and(eq(task.workspaceId, workspaceId), eq(task.status, 'done'), gte(task.closedAt, since))),
    db().select(cols).from(task).where(and(eq(task.workspaceId, workspaceId), gte(task.createdAt, since))),
    db().select(cols).from(task).where(and(eq(task.workspaceId, workspaceId), ne(task.status, 'done'))),
  ]);
  const names = await namesIn(
    workspaceId,
    open.map((t) => t.assigneeUserId).filter((u): u is string => Boolean(u)),
  );
  const who = (id: string | null) => (id ? (names.get(id) ?? 'สมาชิก') : 'ยังไม่มีคนรับผิดชอบ');
  return {
    group: ws?.name ?? 'ทีม',
    range,
    closed: closed.map((t) => t.title),
    created: created.map((t) => t.title),
    // Handed-in work is never late (lib/tasks/overview.ts).
    overdue: open
      .filter((t) => t.status !== 'review' && t.dueAt && t.dueAt.getTime() < now.getTime())
      .map((t) => ({ title: t.title, who: who(t.assigneeUserId) })),
    blocked: open
      .filter((t) => t.status === 'blocked')
      .map((t) => ({ title: t.title, who: who(t.assigneeUserId), reason: t.blockedReason ?? 'ติดปัญหา' })),
    inReview: open.filter((t) => t.status === 'review').map((t) => t.title),
  };
}

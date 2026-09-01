import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { reminder, task, workspace } from '../db/schema.ts';
import {
  planAssigneeNudge,
  planOwnerEscalation,
  type WorkingHours,
} from './policy.ts';
import { inQuietHours, scheduleReminder } from './schedule.ts';

/**
 * Put a task's reminders in place, replacing whatever was there.
 *
 * Called whenever something that changes the answer changes: the deadline, the
 * assignee, or the status. Pending rows are deleted first so a task can never
 * accumulate reminders from its own history — the old assignee's nudge after a
 * handover, or yesterday's plan after the deadline moved.
 *
 * Sent rows are never touched: they are the record of what actually went out.
 */
export async function planRemindersForTask(taskId: string, now = new Date()) {
  const rows = await db()
    .select({
      id: task.id,
      workspaceId: task.workspaceId,
      dueAt: task.dueAt,
      status: task.status,
      assigneeUserId: task.assigneeUserId,
      createdByUserId: task.createdByUserId,
      quietStart: workspace.quietHoursStart,
      quietEnd: workspace.quietHoursEnd,
      workStart: workspace.workingHoursStart,
      workEnd: workspace.workingHoursEnd,
    })
    .from(task)
    .innerJoin(workspace, eq(workspace.id, task.workspaceId))
    .where(eq(task.id, taskId))
    .limit(1);
  const t = rows[0];
  if (!t) return { assignee: null as Date | null, owner: null as Date | null };

  // Clear the plan, keep the history.
  await db()
    .delete(reminder)
    .where(and(eq(reminder.taskId, taskId), eq(reminder.state, 'pending')));

  // A finished task reminds nobody.
  if (!t.dueAt || t.status === 'done') return { assignee: null, owner: null };

  const hours: WorkingHours = { startsAt: t.workStart, endsAt: t.workEnd };
  const quiet = { start: t.quietStart, end: t.quietEnd };
  const planned: { assignee: Date | null; owner: Date | null } = { assignee: null, owner: null };

  // One nudge to the person doing it, before the deadline.
  if (t.assigneeUserId) {
    const nudge = planAssigneeNudge({
      dueAt: t.dueAt,
      now,
      hours,
      blocked: t.status === 'blocked',
    });
    if (nudge.sendAt) {
      const shifted = inQuietHours(nudge.sendAt, quiet)
        ? scheduleReminder({ dueAt: t.dueAt, leadMinutes: 0, quiet }).sendAt
        : nudge.sendAt;
      await insertPending(t.id, t.workspaceId, t.assigneeUserId, shifted, nudge.sendAt, 'task_due');
      planned.assignee = shifted;
    }
  }

  // One escalation to whoever asked for it, after — and only to them. An
  // overdue message in the group is public blame and is billed per member.
  if (t.createdByUserId && t.createdByUserId !== t.assigneeUserId) {
    const at = planOwnerEscalation({ dueAt: t.dueAt, now, hours });
    await insertPending(t.id, t.workspaceId, t.createdByUserId, at, at, 'owner_overdue');
    planned.owner = at;
  }

  return planned;
}

async function insertPending(
  taskId: string,
  workspaceId: string,
  recipientUserId: string,
  sendAt: Date,
  originalSendAt: Date,
  kind: string,
) {
  try {
    await db().insert(reminder).values({
      id: crypto.randomUUID(),
      workspaceId,
      taskId,
      recipientUserId,
      sendAt,
      originalSendAt,
      kind,
    });
  } catch {
    // The dedup index already holds one for this task, person and intended
    // time. That is the correct outcome, not an error.
  }
}

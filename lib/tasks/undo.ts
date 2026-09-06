import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { task, taskEvent, workspaceMember } from '../db/schema.ts';
import { findEventForUndo } from '../db/events.ts';
import { HttpError } from '../auth/session.ts';
import { planRemindersForTask } from '../reminders/plan.ts';

/**
 * Take one change back.
 *
 * Restores the snapshot the event carried rather than computing an inverse:
 * there is no reliable inverse of "blocked" without knowing what the task was
 * before it.
 *
 * Shared by the app and by LINE postbacks, for the same reason the transitions
 * are — a second copy would drift, and the half that drifted would be the
 * check that you are undoing your own action.
 */

/** Long enough to catch a mistap, short enough that it is not an edit tool. */
export const UNDO_WINDOW_MS = 30_000;

/**
 * Timestamp columns that can appear in a snapshot.
 *
 * jsonb gives them back as strings, so each has to be turned into a Date or
 * the write puts a string into a timestamp column. Anything added to the task
 * table that a transition patches belongs in this list.
 */
const DATE_FIELDS = [
  'dueAt',
  'acceptedAt',
  'statusChangedAt',
  'handoffOfferedAt',
  'submittedAt',
  'closedAt',
] as const;

export async function undoTaskEvent(params: {
  taskId: string;
  eventId: string;
  actorUserId: string;
}): Promise<{ ok: true; alreadyUndone?: boolean }> {
  const { taskId, eventId, actorUserId } = params;

  // Deliberately reads past the visibility rule: you are undoing your own
  // action, and the check below is that you are its actor. Going through the
  // audience filter would mean a worker could not take back the private note
  // they just wrote.
  const event = await findEventForUndo(eventId);
  if (!event || event.taskId !== taskId) throw new HttpError(404, 'ไม่พบการกระทำนี้');

  // Membership against the event's own workspace, resolved here rather than
  // trusted from the caller.
  const [membership] = await db()
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, event.workspaceId),
        eq(workspaceMember.userId, actorUserId),
      ),
    )
    .limit(1);
  if (!membership) throw new HttpError(404, 'ไม่พบการกระทำนี้');

  // Only the person who did it may take it back. Undoing someone else's action
  // is an ordinary edit and goes through the normal permission path.
  if (event.actorUserId && event.actorUserId !== actorUserId) {
    throw new HttpError(403, 'ยกเลิกได้เฉพาะการกระทำของคุณเอง');
  }
  if (Date.now() - event.at.getTime() > UNDO_WINDOW_MS) {
    throw new HttpError(409, 'เลยเวลายกเลิกแล้ว');
  }
  if (!event.previousState) {
    throw new HttpError(400, 'การกระทำนี้ยกเลิกไม่ได้');
  }

  // Claim it. Losing this race means someone already undid it, which is the
  // correct outcome for a double tap rather than an error.
  const claimed = await db()
    .update(taskEvent)
    .set({ undoneAt: new Date() })
    .where(and(eq(taskEvent.id, eventId), isNull(taskEvent.undoneAt)))
    .returning({ id: taskEvent.id });
  if (!claimed.length) return { ok: true, alreadyUndone: true };

  const restore = { ...(event.previousState as Record<string, unknown>) };
  for (const key of DATE_FIELDS) {
    if (typeof restore[key] === 'string') restore[key] = new Date(restore[key] as string);
  }
  await db()
    .update(task)
    .set({ ...restore, updatedAt: new Date() })
    .where(eq(task.id, taskId));

  await db().insert(taskEvent).values({
    id: crypto.randomUUID(),
    taskId,
    workspaceId: event.workspaceId,
    actorUserId,
    kind: 'undone',
    detail: `ยกเลิก: ${event.detail}`,
  });

  // Undoing a submit puts the task back in front of its assignee, so the
  // answer to "who should be reminded" changed again.
  await planRemindersForTask(taskId);
  return { ok: true };
}

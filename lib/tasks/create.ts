import 'server-only';
import { inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { task, taskEvent } from '../db/schema.ts';
import { planRemindersForTask } from '../reminders/plan.ts';

/**
 * The one way a task comes into being — from the app, from a LINE draft
 * confirmed in the app, from "ยืนยันทั้งหมด", or from a tap in LINE.
 *
 * One assignee makes one task. Several (an @All / ทุกคน task) make one copy
 * per person, linked by a batch id: each person ticks off their own, and
 * whoever asked can see how many are done. If any insert fails, the copies
 * already written are removed, so a batch is never half there.
 */
export async function createTasks(params: {
  workspaceId: string;
  title: string;
  note?: string;
  dueAt: Date | null;
  priority?: string;
  source: string;
  createdByUserId: string;
  /** One entry per task; null is "nobody yet". */
  assignees: Array<string | null>;
  /** What the history says about how it was made. */
  eventDetail: string;
}): Promise<{ ids: string[]; batchId: string | null }> {
  const assignees = params.assignees.length ? params.assignees : [null];
  const batchId = assignees.length > 1 ? crypto.randomUUID() : null;
  const ids: string[] = [];
  try {
    for (const assigneeUserId of assignees) {
      const id = crypto.randomUUID();
      await db().insert(task).values({
        id,
        workspaceId: params.workspaceId,
        title: params.title,
        note: params.note ?? '',
        assigneeUserId,
        primaryAssigneeUserId: assigneeUserId,
        source: params.source,
        dueAt: params.dueAt,
        priority: params.priority ?? 'normal',
        createdByUserId: params.createdByUserId,
        batchId,
      });
      ids.push(id);
      await db().insert(taskEvent).values({
        id: crypto.randomUUID(),
        taskId: id,
        workspaceId: params.workspaceId,
        actorUserId: params.createdByUserId,
        kind: 'created',
        detail: batchId ? `${params.eventDetail} · งานของทุกคน` : params.eventDetail,
      });
    }
  } catch (error) {
    if (ids.length) await db().delete(task).where(inArray(task.id, ids));
    throw error;
  }
  for (const id of ids) await planRemindersForTask(id);
  return { ids, batchId };
}

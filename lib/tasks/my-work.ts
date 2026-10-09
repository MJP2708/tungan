import 'server-only';
import { and, eq, ne, or, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { task, workspace } from '../db/schema.ts';
import type { MyWorkItem } from '../line/my-work.ts';

/**
 * Everything waiting on one person, for "@ทันงาน งานของฉัน" in LINE.
 *
 * Their open tasks, hand-offs waiting for them to accept, and work handed in
 * to them for review. `workspaceIds` limits it — a group only ever hears about
 * its own workspace; null means every workspace (a private chat with the bot).
 * Assignment, not membership, decides "mine": someone seen in a group can be
 * given work before they ever open the app.
 */
export async function myWorkFor(userId: string, workspaceIds: string[] | null): Promise<MyWorkItem[]> {
  if (workspaceIds && workspaceIds.length === 0) return [];
  const scope = workspaceIds ? inArray(task.workspaceId, workspaceIds) : undefined;
  const rows = await db()
    .select({
      id: task.id,
      title: task.title,
      dueAt: task.dueAt,
      status: task.status,
      assigneeUserId: task.assigneeUserId,
      pendingAssigneeUserId: task.pendingAssigneeUserId,
      createdByUserId: task.createdByUserId,
      workspaceName: workspace.name,
    })
    .from(task)
    .innerJoin(workspace, eq(workspace.id, task.workspaceId))
    .where(
      and(
        ne(task.status, 'done'),
        scope,
        or(
          eq(task.assigneeUserId, userId),
          eq(task.pendingAssigneeUserId, userId),
          and(eq(task.createdByUserId, userId), eq(task.status, 'review')),
        ),
      ),
    )
    .limit(200);

  const items: MyWorkItem[] = [];
  for (const r of rows) {
    const base = { id: r.id, title: r.title, dueAt: r.dueAt, status: r.status, workspaceName: r.workspaceName };
    if (r.pendingAssigneeUserId === userId) items.push({ ...base, role: 'handoff' });
    else if (r.assigneeUserId === userId) items.push({ ...base, role: 'mine' });
    // Asked for it and it is handed in: theirs to check. Someone reviewing
    // their own task is not asked twice.
    if (r.createdByUserId === userId && r.status === 'review' && r.assigneeUserId !== userId) {
      items.push({ ...base, role: 'review' });
    }
  }
  return items;
}

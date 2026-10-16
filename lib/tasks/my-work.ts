import 'server-only';
import { and, eq, ne, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { task, workspace, workspaceMember } from '../db/schema.ts';
import type { MyTask } from './my-tasks.ts';

/** The most งานฉัน returns; sections cap what they draw (lib/tasks/my-tasks.ts). */
export const MY_TASKS_LIMIT = 300;

/**
 * งานฉัน (2026-10-17): open tasks assigned to me in every group I belong
 * to, plus my personal tasks. Joined on MY membership, so a workspace I am
 * not in — even one where someone once assigned me work — never appears. A
 * personal task is only ever its maker's: it is matched by maker as well as
 * by assignee, and a personal workspace has no other member to see it.
 * Served by the (assignee, due date, status) index.
 */
export async function myTasksFor(userId: string): Promise<MyTask[]> {
  const rows = await db()
    .select({
      id: task.id,
      title: task.title,
      dueAt: task.dueAt,
      status: task.status,
      reviewState: task.reviewState,
      blockedReason: task.blockedReason,
      workspaceId: task.workspaceId,
      workspaceName: workspace.name,
      kind: workspace.kind,
    })
    .from(task)
    .innerJoin(
      workspaceMember,
      and(eq(workspaceMember.workspaceId, task.workspaceId), eq(workspaceMember.userId, userId)),
    )
    .innerJoin(workspace, eq(workspace.id, task.workspaceId))
    .where(
      and(
        ne(task.status, 'done'),
        or(
          eq(task.assigneeUserId, userId),
          and(eq(workspace.kind, 'personal'), eq(task.createdByUserId, userId)),
        ),
      ),
    )
    .orderBy(task.dueAt)
    .limit(MY_TASKS_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    dueAt: r.dueAt,
    status: r.status,
    reviewState: r.reviewState,
    blockedReason: r.blockedReason,
    workspaceId: r.workspaceId,
    personal: r.kind === 'personal',
    groupName: r.kind === 'personal' ? null : r.workspaceName,
  }));
}

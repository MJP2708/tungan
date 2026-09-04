import { NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { task, lineUser } from '@/lib/db/schema.ts';
import { latestEventPerTask } from '@/lib/db/events.ts';
import { canReadPrivate } from '@/lib/events/visibility.ts';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What needs unblocking — "ต้องช่วยตรงไหน".
 *
 * Deliberately keyed on the task and what it is waiting for, not on the
 * person. It never counts how many times someone was late or ranks members,
 * because a tool that shames a slow teammate stops being used honestly: people
 * hide problems instead of flagging them, which is the opposite of the point.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const membership = await requireMembership(id);

    const stuck = await db()
      .select({
        id: task.id,
        title: task.title,
        status: task.status,
        dueAt: task.dueAt,
        assigneeUserId: task.assigneeUserId,
        primaryAssigneeUserId: task.primaryAssigneeUserId,
        createdByUserId: task.createdByUserId,
        reviewerUserId: task.reviewerUserId,
        assigneeName: lineUser.displayName,
      })
      .from(task)
      .leftJoin(lineUser, eq(lineUser.id, task.assigneeUserId))
      .where(and(eq(task.workspaceId, id), eq(task.status, 'blocked')))
      .orderBy(desc(task.updatedAt));

    if (!stuck.length) return NextResponse.json({ items: [] });

    // The note from the most recent ขอข้อมูล / ติดปัญหา is what someone
    // actually needs, so the reader can help rather than just chase.
    //
    // Entitlement is per task, not per person: this viewer may be the manager
    // on one blocked task and a bystander on the next. The two groups are
    // queried separately so the filtering happens in SQL — pulling every
    // private note into memory and trusting a later filter is how one bad
    // line of code turns a private note into a public one.
    const insider = stuck.filter((t) =>
      canReadPrivate({ viewerUserId: membership.userId, role: membership.role, task: t }),
    );
    const outsider = stuck.filter((t) => !insider.includes(t));
    const [privateLatest, publicLatest] = await Promise.all([
      latestEventPerTask(insider.map((t) => t.id), ['blocked', 'info'], 'private'),
      latestEventPerTask(outsider.map((t) => t.id), ['blocked', 'info'], 'workspace'),
    ]);
    const latest = new Map([...privateLatest, ...publicLatest]);

    return NextResponse.json({
      items: stuck.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        dueAt: s.dueAt,
        assigneeUserId: s.assigneeUserId,
        assigneeName: s.assigneeName,
        // No reason reaches someone the note was not written for. They still
        // see the task is stuck and who to ask, which is what a manager needs
        // to act; the reason belongs to the person who wrote it.
        needs: latest.get(s.id)?.detail ?? 'ติดปัญหาอยู่ · ถามผู้รับผิดชอบได้',
        since: latest.get(s.id)?.at ?? null,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

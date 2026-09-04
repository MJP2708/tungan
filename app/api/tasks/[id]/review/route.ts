import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { task, taskQuestion, lineUser } from '@/lib/db/schema.ts';
import { listTaskEvents } from '@/lib/db/events.ts';
import { audienceForViewer } from '@/lib/events/visibility.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Everything a reviewer needs, in one response.
 *
 * Reviewers give up when they have to reconstruct the context themselves —
 * open the task, scroll for the original request, find who was asked what,
 * then go looking for the link. Assembling it server-side is the difference
 * between reviewing and archaeology.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const rows = await db()
      .select({
        id: task.id,
        workspaceId: task.workspaceId,
        title: task.title,
        note: task.note,
        dueAt: task.dueAt,
        status: task.status,
        reviewState: task.reviewState,
        evidenceUrl: task.evidenceUrl,
        source: task.source,
        assigneeName: lineUser.displayName,
        assigneeUserId: task.assigneeUserId,
        createdByUserId: task.createdByUserId,
      })
      .from(task)
      .leftJoin(lineUser, eq(lineUser.id, task.assigneeUserId))
      .where(eq(task.id, id))
      .limit(1);
    const t = rows[0];
    if (!t) throw new HttpError(404, 'ไม่พบงานนี้');
    const membership = await requireMembership(t.workspaceId);

    const [history, questions] = await Promise.all([
      // The reviewer is a manager on this task, so they see the private
      // notes — that is who a ติดปัญหา note was written for.
      listTaskEvents(
        id,
        audienceForViewer({ viewerUserId: membership.userId, role: membership.role, task: t }),
      ),
      db()
        .select({
          question: taskQuestion.question,
          answer: taskQuestion.answer,
          askedOfName: lineUser.displayName,
        })
        .from(taskQuestion)
        .leftJoin(lineUser, eq(lineUser.id, taskQuestion.askedOfUserId))
        .where(eq(taskQuestion.taskId, id)),
    ]);

    return NextResponse.json({
      task: t,
      history,
      questions,
      // The message this came from lives in task.note: retention clears the
      // inbox row's raw text on confirm, keeping only what became a task.
      origin: t.note || null,
      // Whether this reader is the one who signs it off, so the UI does not
      // offer buttons the server will refuse.
      canReview:
        membership.role === 'owner' ||
        membership.role === 'admin' ||
        t.createdByUserId === membership.userId,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

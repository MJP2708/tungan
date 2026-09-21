import { NextResponse } from 'next/server';
import { and, eq, desc, ne, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { task, taskEvent, workspace, workspaceMember } from '@/lib/db/schema.ts';
import { requireMembership, requireSession } from '@/lib/auth/session.ts';
import { planRemindersForTask } from '@/lib/reminders/plan.ts';
import { errorResponse, withIdempotency } from '@/lib/api/handler.ts';
import { assertAssignable } from '@/lib/auth/assignable.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    if (new URL(req.url).searchParams.get('mine') === '1') return await myOpenTasks();
    const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? '';
    await requireMembership(workspaceId);
    const rows = await db()
      .select()
      .from(task)
      .where(eq(task.workspaceId, workspaceId))
      .orderBy(desc(task.createdAt));
    return NextResponse.json({ tasks: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const workspaceId = String(body.workspaceId ?? '');
    const membership = await requireMembership(workspaceId);

    const title = String(body.title ?? '').trim();
    if (!title) {
      return NextResponse.json({ error: 'ใส่ชื่องานก่อน' }, { status: 400 });
    }
    // Deadlines arrive as an ISO instant that the client resolved with the
    // shared engine, or null. Never a label.
    const dueAt = body.dueAt ? new Date(String(body.dueAt)) : null;
    if (dueAt && !Number.isFinite(dueAt.getTime())) {
      return NextResponse.json({ error: 'กำหนดส่งไม่ถูกต้อง' }, { status: 400 });
    }

    const assigneeUserId = await assertAssignable(workspaceId, body.assigneeUserId);

    const { result, replayedId } = await withIdempotency(
      {
        key: req.headers.get('idempotency-key'),
        workspaceId,
        route: 'POST /api/tasks',
      },
      async () => {
        const id = crypto.randomUUID();
        await db().insert(task).values({
          id,
          workspaceId,
          title,
          note: String(body.note ?? ''),
          assigneeUserId,
          primaryAssigneeUserId: assigneeUserId,
          source: String(body.source ?? 'สร้างในทันงาน'),
          dueAt,
          priority: String(body.priority ?? 'normal'),
          createdByUserId: membership.userId,
        });
        await db().insert(taskEvent).values({
          id: crypto.randomUUID(),
          taskId: id,
          workspaceId,
          actorUserId: membership.userId,
          kind: 'created',
          detail: title,
        });
        await planRemindersForTask(id);
        return { id };
      },
    );

    if (replayedId) {
      // A retry under the same key returns the first result rather than
      // creating a second task.
      return NextResponse.json({ id: replayedId, replayed: true });
    }
    if (!result) {
      // Same key, and the first request is still running. Not a failure.
      return NextResponse.json({ error: 'กำลังบันทึกอยู่ ลองอีกครั้งในอีกครู่' }, { status: 409 });
    }
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Open work that is mine, across every workspace I belong to.
 *
 * Someone in two teams had to switch workspace to see everything assigned to
 * them. Scoped by joining workspace_member on the session's own user id, so
 * a task in a workspace the person has left never appears.
 */
async function myOpenTasks() {
  const user = await requireSession();
  const rows = await db()
    .select({
      id: task.id,
      workspaceId: task.workspaceId,
      workspaceName: workspace.name,
      title: task.title,
      dueAt: task.dueAt,
      status: task.status,
      pendingAssigneeUserId: task.pendingAssigneeUserId,
    })
    .from(task)
    .innerJoin(
      workspaceMember,
      and(eq(workspaceMember.workspaceId, task.workspaceId), eq(workspaceMember.userId, user.userId)),
    )
    .innerJoin(workspace, eq(workspace.id, task.workspaceId))
    .where(
      and(
        ne(task.status, 'done'),
        or(eq(task.assigneeUserId, user.userId), eq(task.pendingAssigneeUserId, user.userId)),
      ),
    )
    .orderBy(sql`${task.dueAt} asc nulls last`)
    .limit(50);
  return NextResponse.json({ tasks: rows });
}

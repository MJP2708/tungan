import { NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { task, taskEvent } from '@/lib/db/schema.ts';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse, withIdempotency } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
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
          assigneeUserId: body.assigneeUserId ?? null,
          primaryAssigneeUserId: body.assigneeUserId ?? null,
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
        return { id };
      },
    );

    if (replayedId) {
      // A retry under the same key returns the first result rather than
      // creating a second task.
      return NextResponse.json({ id: replayedId, replayed: true });
    }
    return NextResponse.json({ id: result!.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { inboxItem, task, taskEvent } from '@/lib/db/schema.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { errorResponse, withIdempotency } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Turn a reviewed message into a task.
 *
 * A human has seen the draft and is confirming assignee and deadline here.
 * The system never reaches this path on its own.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const rows = await db().select().from(inboxItem).where(eq(inboxItem.id, id)).limit(1);
    const item = rows[0];
    if (!item) throw new HttpError(404, 'ไม่พบข้อความนี้');

    const membership = await requireMembership(item.workspaceId);
    if (item.state !== 'pending') {
      return NextResponse.json({ error: 'ข้อความนี้ถูกจัดการไปแล้ว' }, { status: 409 });
    }

    // The confirmed values win over the draft: the draft was only a suggestion.
    const title = String(body.title ?? item.suggestedTitle ?? '').trim();
    if (!title) return NextResponse.json({ error: 'ใส่ชื่องานก่อน' }, { status: 400 });
    const dueAt = body.dueAt
      ? new Date(String(body.dueAt))
      : item.suggestedDueAt ?? null;
    if (dueAt && !Number.isFinite(dueAt.getTime())) {
      return NextResponse.json({ error: 'กำหนดส่งไม่ถูกต้อง' }, { status: 400 });
    }
    const assigneeUserId = body.assigneeUserId ?? item.suggestedAssigneeUserId ?? null;

    const { result, replayedId } = await withIdempotency(
      {
        key: req.headers.get('idempotency-key'),
        workspaceId: item.workspaceId,
        route: 'POST /api/inbox/confirm',
      },
      async () => {
        const taskId = crypto.randomUUID();
        await db().insert(task).values({
          id: taskId,
          workspaceId: item.workspaceId,
          title,
          note: item.rawMessage ? `จากข้อความ: ${item.rawMessage}` : '',
          assigneeUserId,
          primaryAssigneeUserId: assigneeUserId,
          source: item.lineGroupId ? 'LINE · กลุ่ม' : 'LINE · DM',
          dueAt,
          createdByUserId: membership.userId,
        });
        await db().insert(taskEvent).values({
          id: crypto.randomUUID(),
          taskId,
          workspaceId: item.workspaceId,
          actorUserId: membership.userId,
          kind: 'created',
          detail: 'ยืนยันจากข้อความใน LINE',
        });
        // Retention: keep only what the user confirmed into a task.
        await db()
          .update(inboxItem)
          .set({ state: 'created', rawMessage: null })
          .where(eq(inboxItem.id, id));
        return { id: taskId };
      },
    );

    if (replayedId) return NextResponse.json({ id: replayedId, replayed: true });
    return NextResponse.json({ id: result!.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

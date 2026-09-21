import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { inboxItem, task, taskEvent } from '@/lib/db/schema.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { planRemindersForTask } from '@/lib/reminders/plan.ts';
import { errorResponse, withIdempotency } from '@/lib/api/handler.ts';
import { assertAssignable } from '@/lib/auth/assignable.ts';

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
    const assigneeUserId = await assertAssignable(
      item.workspaceId,
      body.assigneeUserId ?? item.suggestedAssigneeUserId ?? null,
    );

    const { result, replayedId } = await withIdempotency(
      {
        key: req.headers.get('idempotency-key'),
        workspaceId: item.workspaceId,
        route: 'POST /api/inbox/confirm',
      },
      async () => {
        // Claim the draft FIRST, conditionally. Checking "still pending" and
        // then inserting was two steps, so a confirm in the app and a tap in
        // LINE at the same moment both passed the check and made two tasks.
        // Only the call that flips pending -> created goes on.
        const claimed = await db()
          .update(inboxItem)
          // The raw text goes now: only what became a task is kept, which is
          // what the privacy page and the bot's join message promise. (It used
          // to be copied into task.note here, where unsend and retention
          // could never reach it.)
          .set({ state: 'created', rawMessage: null })
          .where(and(eq(inboxItem.id, id), eq(inboxItem.state, 'pending')))
          .returning({ id: inboxItem.id });
        if (!claimed.length) throw new HttpError(409, 'ข้อความนี้ถูกจัดการไปแล้ว');

        const taskId = crypto.randomUUID();
        try {
          await db().insert(task).values({
            id: taskId,
            workspaceId: item.workspaceId,
            title,
            note: '',
            assigneeUserId,
            primaryAssigneeUserId: assigneeUserId,
            source: item.lineGroupId ? 'LINE · กลุ่ม' : 'LINE · DM',
            dueAt,
            createdByUserId: membership.userId,
          });
        } catch (error) {
          // Hand the draft back rather than leave it claimed with no task.
          await db()
            .update(inboxItem)
            .set({ state: 'pending' })
            .where(eq(inboxItem.id, id));
          throw error;
        }
        await db().insert(taskEvent).values({
          id: crypto.randomUUID(),
          taskId,
          workspaceId: item.workspaceId,
          actorUserId: membership.userId,
          kind: 'created',
          detail: 'ยืนยันจากข้อความใน LINE',
        });
        await planRemindersForTask(taskId);
        return { id: taskId };
      },
    );

    if (replayedId) return NextResponse.json({ id: replayedId, replayed: true });
    if (!result) {
      // Same key, and the first request is still running. Not a failure.
      return NextResponse.json({ error: 'กำลังบันทึกอยู่ ลองอีกครั้งในอีกครู่' }, { status: 409 });
    }
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

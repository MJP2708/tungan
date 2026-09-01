import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { taskQuestion, task, taskEvent } from '@/lib/db/schema.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { planRemindersForTask } from '@/lib/reminders/plan.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Answer a question, which hands the task back to whoever is doing it. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const rows = await db().select().from(taskQuestion).where(eq(taskQuestion.id, id)).limit(1);
    const q = rows[0];
    if (!q) throw new HttpError(404, 'ไม่พบคำถามนี้');
    const membership = await requireMembership(q.workspaceId);

    // The person asked answers it. An admin may answer too, so a question to
    // someone who has left does not strand the task forever — but never the
    // person who asked it: answering your own question is not an answer, and
    // it would let the request be closed without anyone having replied.
    const isAsked = q.askedOfUserId === membership.userId;
    const isAdmin = membership.role === 'owner' || membership.role === 'admin';
    if (!isAsked && (!isAdmin || q.askedByUserId === membership.userId)) {
      throw new HttpError(
        403,
        q.askedByUserId === membership.userId
          ? 'คุณเป็นคนถามเอง ต้องรอคนที่ถูกถามตอบ'
          : 'ตอบได้เฉพาะคนที่ถูกถาม',
      );
    }
    if (q.answeredAt) {
      return NextResponse.json({ error: 'คำถามนี้ตอบไปแล้ว' }, { status: 409 });
    }

    const answer = String((await req.json().catch(() => ({}))).answer ?? '').trim();
    if (!answer) return NextResponse.json({ error: 'พิมพ์คำตอบก่อน' }, { status: 400 });

    await db()
      .update(taskQuestion)
      .set({ answer, answeredAt: new Date() })
      .where(eq(taskQuestion.id, id));

    // The task only resumes when nothing else is still waiting on someone.
    const others = await db()
      .select({ id: taskQuestion.id })
      .from(taskQuestion)
      .where(and(eq(taskQuestion.taskId, q.taskId), isNull(taskQuestion.answeredAt)));
    const stillOpen = others.length > 0;

    await db().insert(taskEvent).values({
      id: crypto.randomUUID(),
      taskId: q.taskId,
      workspaceId: q.workspaceId,
      actorUserId: membership.userId,
      kind: 'answered',
      detail: `ตอบแล้ว: ${answer}`,
    });
    if (!stillOpen) {
      await db().update(task).set({ status: 'progress', updatedAt: new Date() }).where(eq(task.id, q.taskId));
    }
    await planRemindersForTask(q.taskId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

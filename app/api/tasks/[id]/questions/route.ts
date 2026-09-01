import { NextResponse } from 'next/server';
import { and, eq, desc, isNull } from 'drizzle-orm';
import { pushToUser } from '@/lib/line/messaging.ts';
import { db } from '@/lib/db/index.ts';
import { task, taskQuestion, taskEvent, lineUser } from '@/lib/db/schema.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { planRemindersForTask } from '@/lib/reminders/plan.ts';
import { nextWorkingMorning } from '@/lib/reminders/policy.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadTask(id: string) {
  const rows = await db().select().from(task).where(eq(task.id, id)).limit(1);
  if (!rows[0]) throw new HttpError(404, 'ไม่พบงานนี้');
  return rows[0];
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const found = await loadTask(id);
    await requireMembership(found.workspaceId);
    const rows = await db()
      .select({
        id: taskQuestion.id,
        question: taskQuestion.question,
        answer: taskQuestion.answer,
        answeredAt: taskQuestion.answeredAt,
        askedOfUserId: taskQuestion.askedOfUserId,
        askedOfName: lineUser.displayName,
        createdAt: taskQuestion.createdAt,
      })
      .from(taskQuestion)
      .leftJoin(lineUser, eq(lineUser.id, taskQuestion.askedOfUserId))
      .where(eq(taskQuestion.taskId, id))
      .orderBy(desc(taskQuestion.createdAt));
    return NextResponse.json({ questions: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Ask a named person for something, and make the task wait on them. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const found = await loadTask(id);
    const membership = await requireMembership(found.workspaceId);
    const body = await req.json().catch(() => ({}));

    const question = String(body.question ?? '').trim();
    const askedOfUserId = String(body.askedOfUserId ?? '').trim();
    if (!question) {
      return NextResponse.json({ error: 'พิมพ์คำถามก่อน' }, { status: 400 });
    }
    if (!askedOfUserId) {
      // Without a named person this is the old status again: a label that
      // reaches nobody.
      return NextResponse.json({ error: 'เลือกว่าจะถามใคร' }, { status: 400 });
    }
    if (askedOfUserId === membership.userId) {
      return NextResponse.json({ error: 'ถามตัวเองไม่ได้' }, { status: 400 });
    }

    const questionId = crypto.randomUUID();
    await db().insert(taskQuestion).values({
      id: questionId,
      taskId: id,
      workspaceId: found.workspaceId,
      askedByUserId: membership.userId,
      askedOfUserId,
      question,
      // Unanswered questions surface to the owner the next working morning
      // rather than sitting silently forever.
      escalateAt: nextWorkingMorning(new Date(), {
        startsAt: membership.quietHoursEnd,
        endsAt: '18:00',
      }),
    });

    // The task waits on the person being asked, not on the assignee.
    await db().update(task).set({ status: 'blocked', updatedAt: new Date() }).where(eq(task.id, id));
    await db().insert(taskEvent).values({
      id: crypto.randomUUID(),
      taskId: id,
      workspaceId: found.workspaceId,
      actorUserId: membership.userId,
      kind: 'info',
      detail: `ขอข้อมูล: ${question}`,
    });
    await planRemindersForTask(id);

    // One DM to the person being asked. Questions to the same person inside
    // the merge window arrive as one message: push is billed per recipient,
    // so three questions must not cost three messages.
    const pending = await db()
      .select({ question: taskQuestion.question, title: task.title })
      .from(taskQuestion)
      .innerJoin(task, eq(task.id, taskQuestion.taskId))
      .where(
        and(
          eq(taskQuestion.askedOfUserId, askedOfUserId),
          eq(taskQuestion.workspaceId, found.workspaceId),
          isNull(taskQuestion.answeredAt),
        ),
      );
    const lines = pending.map((q) => `• ${q.title}: ${q.question}`);
    await pushToUser(
      {
        workspaceId: found.workspaceId,
        recipientUserId: askedOfUserId,
        taskId: id,
        messages: [{
          type: 'text',
          text:
            (pending.length > 1 ? `มีคำถามรอคุณ ${pending.length} ข้อ` : 'มีคำถามถึงคุณ') +
            `\n${lines.join('\n')}\n\nตอบในแอป: ${(process.env.APP_BASE_URL ?? '').replace(/\/$/, '')}`,
        }],
      },
    ).catch((error) => console.error('[questions] notify failed', error));

    return NextResponse.json({ id: questionId }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

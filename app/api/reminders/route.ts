import { NextResponse } from 'next/server';
import { and, eq, asc } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { reminder, task } from '@/lib/db/schema.ts';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse, withIdempotency } from '@/lib/api/handler.ts';
import { scheduleReminder } from '@/lib/reminders/schedule.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? '';
    await requireMembership(workspaceId);
    const rows = await db()
      .select({
        id: reminder.id,
        taskId: reminder.taskId,
        sendAt: reminder.sendAt,
        state: reminder.state,
        failureReason: reminder.failureReason,
        title: task.title,
      })
      .from(reminder)
      .leftJoin(task, eq(task.id, reminder.taskId))
      .where(eq(reminder.workspaceId, workspaceId))
      .orderBy(asc(reminder.sendAt));
    return NextResponse.json({ reminders: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const workspaceId = String(body.workspaceId ?? '');
    const membership = await requireMembership(workspaceId);

    const dueAt = body.dueAt ? new Date(String(body.dueAt)) : null;
    if (!dueAt || !Number.isFinite(dueAt.getTime())) {
      return NextResponse.json({ error: 'ต้องระบุเวลาที่ถูกต้อง' }, { status: 400 });
    }

    // Quiet hours are applied here, and originalSendAt keeps the unshifted
    // time so a shift cannot create a second reminder for the same deadline.
    const decision = scheduleReminder({
      dueAt,
      leadMinutes: Number(body.leadMinutes ?? 60),
      quiet: { start: membership.quietHoursStart, end: membership.quietHoursEnd },
    });

    const { result, replayedId } = await withIdempotency(
      {
        key: req.headers.get('idempotency-key'),
        workspaceId,
        route: 'POST /api/reminders',
      },
      async () => {
        const id = crypto.randomUUID();
        try {
          await db().insert(reminder).values({
            id,
            workspaceId,
            taskId: body.taskId ?? null,
            // Reminders go to a person, never to a group.
            recipientUserId: String(body.recipientUserId ?? membership.userId),
            sendAt: decision.sendAt,
            originalSendAt: decision.originalSendAt,
          });
        } catch {
          // The dedup index rejected it: this reminder already exists.
          return { id: '' };
        }
        return { id };
      },
    );

    if (replayedId) return NextResponse.json({ id: replayedId, replayed: true });
    if (!result?.id) {
      return NextResponse.json({ error: 'มีการเตือนสำหรับงานนี้อยู่แล้ว' }, { status: 409 });
    }
    return NextResponse.json(
      { id: result.id, sendAt: decision.sendAt, shifted: decision.shifted, reason: decision.reason },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

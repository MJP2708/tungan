import { NextResponse } from 'next/server';
import { and, eq, asc, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { reminder, task } from '@/lib/db/schema.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { errorResponse, withIdempotency } from '@/lib/api/handler.ts';
import { scheduleReminder } from '@/lib/reminders/schedule.ts';
import { assertAssignable } from '@/lib/auth/assignable.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? '';
    const membership = await requireMembership(workspaceId);
    const rows = await db()
      .select({
        id: reminder.id,
        taskId: reminder.taskId,
        sendAt: reminder.sendAt,
        state: reminder.state,
        failureReason: reminder.failureReason,
        title: task.title,
        note: reminder.note,
      })
      .from(reminder)
      .leftJoin(task, eq(task.id, reminder.taskId))
      // เตือนฉัน is the caller's own list. It returned every member's
      // reminders, which now carry their own private wording.
      .where(
        and(
          eq(reminder.workspaceId, workspaceId),
          eq(reminder.recipientUserId, membership.userId),
          // A calendar event's notification belongs to the event, which
          // shows on กำหนดส่ง; listing it here too would read as a duplicate.
          isNull(reminder.eventId),
        ),
      )
      .orderBy(asc(reminder.sendAt));
    return NextResponse.json({
      reminders: rows.map(({ note, ...r }) => ({ ...r, title: r.title ?? note })),
    });
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
    // A time that has already passed would fire on the next run, which reads
    // as the bot reminding you of something at random. A minute of grace for
    // a slow tap.
    if (dueAt.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: 'เวลานี้ผ่านไปแล้ว · เลือกเวลาอื่นหรือพรุ่งนี้' }, { status: 400 });
    }
    // What a personal reminder is about, in the person's words. Trimmed and
    // capped: it is pushed to LINE verbatim.
    const note =
      typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null;

    // The reminder DMs the recipient the task's title. Both ids come from the
    // client, so both are checked against this workspace: a task from another
    // company, or a person outside this one, would otherwise leak its title.
    const recipientUserId =
      (await assertAssignable(workspaceId, body.recipientUserId)) ?? membership.userId;
    const taskId = typeof body.taskId === 'string' && body.taskId ? body.taskId : null;
    if (taskId) {
      const [owned] = await db()
        .select({ id: task.id })
        .from(task)
        .where(and(eq(task.id, taskId), eq(task.workspaceId, workspaceId)))
        .limit(1);
      if (!owned) throw new HttpError(404, 'ไม่พบงานนี้');
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
            taskId,
            // Reminders go to a person, never to a group.
            recipientUserId,
            // Set by a person, so re-planning the task must leave it alone.
            kind: 'manual',
            note,
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

import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { task, taskEvent } from '@/lib/db/schema.ts';
import { findEventForUndo } from '@/lib/db/events.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { planRemindersForTask } from '@/lib/reminders/plan.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How long an action can be taken back. */
const UNDO_WINDOW_MS = 30_000;

/**
 * Reverse one change, once.
 *
 * Undo restores the snapshot the event carried rather than computing an
 * inverse: there is no reliable inverse of "blocked" without knowing what the
 * task was before it.
 *
 * Idempotent by claiming the event — the update is conditional on undoneAt
 * still being null, so a double tap, a retry, or two devices racing all
 * produce one reversal. That is what lets the UI offer undo without a
 * confirmation dialog in front of it.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const eventId = String(body.eventId ?? '');
    if (!eventId) return NextResponse.json({ error: 'ต้องระบุการกระทำที่จะยกเลิก' }, { status: 400 });

    // Deliberately reads past the visibility rule: you are undoing your own
    // action, and the check below is that you are its actor. Going through the
    // audience filter would mean a worker could not take back the private note
    // they just wrote.
    const event = await findEventForUndo(eventId);
    if (!event || event.taskId !== id) throw new HttpError(404, 'ไม่พบการกระทำนี้');

    const membership = await requireMembership(event.workspaceId);
    // Only the person who did it may take it back. Undoing someone else's
    // action is an ordinary edit and goes through the normal permission path.
    if (event.actorUserId && event.actorUserId !== membership.userId) {
      throw new HttpError(403, 'ยกเลิกได้เฉพาะการกระทำของคุณเอง');
    }
    if (Date.now() - event.at.getTime() > UNDO_WINDOW_MS) {
      return NextResponse.json({ error: 'เลยเวลายกเลิกแล้ว' }, { status: 409 });
    }
    if (!event.previousState) {
      return NextResponse.json({ error: 'การกระทำนี้ยกเลิกไม่ได้' }, { status: 400 });
    }

    // Claim it. Losing this race means someone already undid it.
    const claimed = await db()
      .update(taskEvent)
      .set({ undoneAt: new Date() })
      .where(and(eq(taskEvent.id, eventId), isNull(taskEvent.undoneAt)))
      .returning({ id: taskEvent.id });
    if (!claimed.length) return NextResponse.json({ ok: true, alreadyUndone: true });

    const restore = event.previousState as Record<string, unknown>;
    // Dates come back from jsonb as strings.
    for (const key of ['dueAt', 'acceptedAt', 'statusChangedAt', 'handoffOfferedAt']) {
      if (typeof restore[key] === 'string') restore[key] = new Date(restore[key] as string);
    }
    await db()
      .update(task)
      .set({ ...restore, updatedAt: new Date() })
      .where(eq(task.id, id));

    await db().insert(taskEvent).values({
      id: crypto.randomUUID(),
      taskId: id,
      workspaceId: event.workspaceId,
      actorUserId: membership.userId,
      kind: 'undone',
      detail: `ยกเลิก: ${event.detail}`,
    });

    await planRemindersForTask(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

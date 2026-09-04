import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { task } from '@/lib/db/schema.ts';
import { findEventForUndo, setEventVisibility } from '@/lib/db/events.ts';
import { isVisibility } from '@/lib/events/visibility.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Change who can read a note.
 *
 * Only the person who wrote it. A manager widening someone's private ติดปัญหา
 * note would break the promise the default makes, and the promise is the only
 * reason the note is honest in the first place.
 *
 * Narrowing is allowed too: someone who shared a note and regretted it should
 * not have to ask. What has already been read cannot be unread, but the note
 * stops appearing.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const visibility = body.visibility;
    if (!isVisibility(visibility)) {
      return NextResponse.json({ error: 'ระดับการมองเห็นไม่ถูกต้อง' }, { status: 400 });
    }

    const event = await findEventForUndo(id);
    if (!event) throw new HttpError(404, 'ไม่พบบันทึกนี้');

    // Membership is resolved from the event's own workspace, never from the
    // request body.
    const membership = await requireMembership(event.workspaceId);
    if (event.actorUserId !== membership.userId) {
      throw new HttpError(403, 'เปลี่ยนได้เฉพาะบันทึกที่คุณเขียนเอง');
    }

    // A blocked reason is an internal note about the work, not a deliverable.
    // Sending one to the agency's client is a mistake nobody can take back.
    if (visibility === 'client' && (event.kind === 'blocked' || event.kind === 'info')) {
      return NextResponse.json(
        { error: 'เหตุผลที่ติดปัญหาส่งให้ลูกค้าไม่ได้ · แชร์ได้แค่ในพื้นที่งาน' },
        { status: 400 },
      );
    }

    await setEventVisibility(id, visibility);

    // The task itself is unchanged: it still shows publicly as blocked. Only
    // who can read the reason moved.
    const [row] = await db()
      .select({ status: task.status })
      .from(task)
      .where(eq(task.id, event.taskId))
      .limit(1);

    return NextResponse.json({ ok: true, visibility, taskStatus: row?.status ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}

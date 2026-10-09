import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { deleteEvent, updateEvent } from '@/lib/calendar-events.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Change an event. Safe to retry without a separate key: it sets the whole
 * event to what was sent, so sending it twice ends in the same state.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireSession();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await updateEvent({ eventId: id, userId: user.userId, body }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireSession();
    await deleteEvent(id, user.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

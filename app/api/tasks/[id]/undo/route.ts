import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { undoTaskEvent } from '@/lib/tasks/undo.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Undo replaces "are you sure".
 *
 * Thin on purpose: the same undo is offered on LINE postbacks, which carry no
 * cookie, so the rules live in lib/tasks/undo.ts.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const eventId = String(body.eventId ?? '');
    if (!eventId) {
      return NextResponse.json({ error: 'ต้องระบุการกระทำที่จะยกเลิก' }, { status: 400 });
    }
    const user = await requireSession();
    return NextResponse.json(await undoTaskEvent({ taskId: id, eventId, actorUserId: user.userId }));
  } catch (error) {
    return errorResponse(error);
  }
}

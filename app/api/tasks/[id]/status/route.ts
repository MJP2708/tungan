import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { applyTransition, isTransition } from '@/lib/tasks/transitions.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Move a task.
 *
 * Thin on purpose. The rules live in lib/tasks/transitions.ts because the same
 * moves also arrive as postbacks tapped inside LINE, where there is no cookie
 * to read. Two copies would drift, and the half that drifted would be the
 * permission checks.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (!isTransition(action)) {
      return NextResponse.json({ error: 'ไม่รู้จักการกระทำนี้' }, { status: 400 });
    }

    // Identity comes from our own session cookie and nothing else. Which
    // workspace this task belongs to, and whether this person is in it, is
    // resolved inside applyTransition against the task's own row.
    const user = await requireSession();
    const result = await applyTransition({
      taskId: id,
      action,
      actorUserId: user.userId,
      input: body,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

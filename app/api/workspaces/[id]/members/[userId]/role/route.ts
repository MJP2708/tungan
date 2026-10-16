import { NextResponse } from 'next/server';
import { requireSession, HttpError } from '@/lib/auth/session.ts';
import { errorResponse, withIdempotency } from '@/lib/api/handler.ts';
import { changeMemberRole } from '@/lib/auth/roles.ts';
import { isRole } from '@/lib/permissions.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Make someone a Manager or a Member of this group (2026-10-17).
 *
 * Every rule is in can() and changeMemberRole: Managers only (or the
 * group's creator, as a recovery path), never your own role, never the last
 * Manager — counted under a row lock, so two Managers demoting each other at
 * once cannot both succeed. Setting a role is the same request every time,
 * so a retry ends in the same state; the idempotency key still makes a retry
 * return the first answer.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    const { id, userId } = await params;
    const actor = await requireSession();
    const body = await req.json().catch(() => ({}));
    if (!isRole(body.role)) throw new HttpError(400, 'บทบาทต้องเป็นผู้จัดการหรือสมาชิก');
    const { result, replayedId } = await withIdempotency(
      { key: req.headers.get('idempotency-key'), workspaceId: id, route: 'PATCH /api/workspaces/members/role' },
      async () => {
        const out = await changeMemberRole({
          workspaceId: id,
          actorUserId: actor.userId,
          targetUserId: userId,
          role: body.role,
        });
        return { id: `${userId}:${body.role}`, changed: out.changed };
      },
    );
    if (replayedId) return NextResponse.json({ ok: true, replayed: true });
    return NextResponse.json({ ok: true, changed: result?.changed ?? false });
  } catch (error) {
    return errorResponse(error);
  }
}

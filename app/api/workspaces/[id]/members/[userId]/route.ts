import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { workspaceMember } from '@/lib/db/schema.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Change a member's nickname.
 *
 * Nicknames are per-workspace display data: two people with the same nickname
 * are still different people, so this never touches identity.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    const { id, userId } = await params;
    const membership = await requireMembership(id);
    const body = await req.json().catch(() => ({}));
    const nickname = String(body.nickname ?? '').trim();
    if (!nickname) return NextResponse.json({ error: 'ใส่ชื่อเล่นก่อน' }, { status: 400 });

    // Anyone may rename themselves; renaming someone else is an admin action.
    if (userId !== membership.userId && membership.role === 'member') {
      throw new HttpError(403, 'แก้ชื่อเล่นคนอื่นได้เฉพาะผู้ดูแล');
    }

    await db()
      .update(workspaceMember)
      .set({ nickname })
      .where(and(eq(workspaceMember.workspaceId, id), eq(workspaceMember.userId, userId)));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

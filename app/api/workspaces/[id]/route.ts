import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { workspace } from '@/lib/db/schema.ts';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Longer than any name people actually use, short enough to render in the switcher. */
const MAX_NAME = 60;

/**
 * Rename a workspace, or turn AI help on and off for it.
 *
 * There was no way to do this at all: a workspace created at first sign-in is
 * called "งานของฉัน", and a group connected to it before one-tap setup existed
 * left a whole team looking at someone's personal space. Owners and admins can
 * fix the name instead of starting again.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireMembership(id, { roles: ['owner', 'admin'] });

    const body = await req.json().catch(() => ({}));

    // Turning AI help on or off for this team. The key itself is a
    // server-only env var; this only says whether this workspace may use it.
    if (typeof body.aiEnabled === 'boolean') {
      await db().update(workspace).set({ aiEnabled: body.aiEnabled }).where(eq(workspace.id, id));
      return NextResponse.json({ ok: true, aiEnabled: body.aiEnabled });
    }

    const name = String(body.name ?? '').trim().slice(0, MAX_NAME);
    if (!name) {
      return NextResponse.json({ error: 'ใส่ชื่อพื้นที่งานก่อน' }, { status: 400 });
    }

    await db().update(workspace).set({ name }).where(eq(workspace.id, id));
    return NextResponse.json({ ok: true, name });
  } catch (error) {
    return errorResponse(error);
  }
}

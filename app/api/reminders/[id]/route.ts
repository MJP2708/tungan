import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { reminder } from '@/lib/db/schema.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How many times one reminder may be pushed back. */
const MAX_SNOOZES = 3;

async function load(id: string) {
  const rows = await db().select().from(reminder).where(eq(reminder.id, id)).limit(1);
  if (!rows[0]) throw new HttpError(404, 'ไม่พบการเตือนนี้');
  return rows[0];
}

/** Mark done, or move the time. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const found = await load(id);
    const membership = await requireMembership(found.workspaceId);
    // A reminder is addressed to one person; only they or an admin change it.
    if (found.recipientUserId !== membership.userId && membership.role === 'member') {
      throw new HttpError(403, 'แก้ได้เฉพาะเจ้าของการเตือน');
    }
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (body.done === true) patch.state = 'sent';
    if (body.done === false) patch.state = 'pending';
    if (body.sendAt) {
      const at = new Date(String(body.sendAt));
      if (!Number.isFinite(at.getTime())) {
        return NextResponse.json({ error: 'เวลาไม่ถูกต้อง' }, { status: 400 });
      }
      // Snoozing is capped. Unlimited deferral is indistinguishable from
      // ignoring, and it hides the fact that nothing is moving — the point of
      // a limit is to make people defer honestly or deal with it.
      if (found.snoozeCount >= MAX_SNOOZES) {
        return NextResponse.json(
          {
            error: `เลื่อนได้สูงสุด ${MAX_SNOOZES} ครั้งแล้ว · จัดการงานนี้หรือเปลี่ยนกำหนดส่งแทน`,
          },
          { status: 409 },
        );
      }
      // originalSendAt is deliberately left alone: it is the dedup key, and
      // moving it would let the same reminder be scheduled twice.
      patch.sendAt = at;
      patch.snoozeCount = found.snoozeCount + 1;
    }
    await db().update(reminder).set(patch).where(eq(reminder.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const found = await load(id);
    const membership = await requireMembership(found.workspaceId);
    if (found.recipientUserId !== membership.userId && membership.role === 'member') {
      throw new HttpError(403, 'ลบได้เฉพาะเจ้าของการเตือน');
    }
    await db().delete(reminder).where(eq(reminder.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { inboxItem } from '@/lib/db/schema.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const rows = await db().select().from(inboxItem).where(eq(inboxItem.id, id)).limit(1);
    const item = rows[0];
    if (!item) throw new HttpError(404, 'ไม่พบข้อความนี้');
    await requireMembership(item.workspaceId);
    // Dismissing drops the raw text too — we keep only what became a task.
    await db()
      .update(inboxItem)
      .set({ state: 'dismissed', rawMessage: null })
      .where(eq(inboxItem.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

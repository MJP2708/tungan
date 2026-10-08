import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { markAnnouncementRead } from '@/lib/announcements.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Closed with X or รับทราบ. Safe to repeat: closing twice changes nothing. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await requireSession();
    await markAnnouncementRead(id, user.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

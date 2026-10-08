import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { unreadAnnouncementsFor } from '@/lib/announcements.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What the person opening the app has not closed yet, in any of their workspaces. */
export async function GET() {
  try {
    const user = await requireSession();
    return NextResponse.json({ announcements: await unreadAnnouncementsFor(user.userId) });
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextResponse } from 'next/server';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { announcementWorkspace, deleteAnnouncement } from '@/lib/announcements.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Take an announcement down. Owners and admins of its workspace only. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireMembership(await announcementWorkspace(id), { roles: ['owner', 'admin'] });
    await deleteAnnouncement(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

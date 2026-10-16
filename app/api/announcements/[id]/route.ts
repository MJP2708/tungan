import { NextResponse } from 'next/server';
import { requireCan } from '@/lib/auth/require-can.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { announcementWorkspace, deleteAnnouncement } from '@/lib/announcements.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Take an announcement down. Managers of its group only (can()). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireCan(await announcementWorkspace(id), 'post_announcement');
    await deleteAnnouncement(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

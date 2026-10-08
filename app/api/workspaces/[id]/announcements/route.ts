import { NextResponse } from 'next/server';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse, withIdempotency } from '@/lib/api/handler.ts';
import { listAnnouncements, postAnnouncement } from '@/lib/announcements.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The workspace's recent announcements; any member may read them. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const membership = await requireMembership(id);
    return NextResponse.json({ announcements: await listAnnouncements(id, membership.userId) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Post one. Owners and admins only — checked here, not just hidden in the UI. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const membership = await requireMembership(id, { roles: ['owner', 'admin'] });
    const body = await req.json().catch(() => ({}));
    const { result, replayedId } = await withIdempotency(
      { key: req.headers.get('idempotency-key'), workspaceId: id, route: 'POST /api/workspaces/announcements' },
      () =>
        postAnnouncement({
          workspaceId: id,
          authorUserId: membership.userId,
          title: String(body.title ?? ''),
          body: String(body.body ?? ''),
        }),
    );
    if (replayedId) return NextResponse.json({ id: replayedId, replayed: true });
    if (!result) {
      return NextResponse.json({ error: 'กำลังบันทึกอยู่ ลองอีกครั้งในอีกครู่' }, { status: 409 });
    }
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextResponse } from 'next/server';
import { requireMembership } from '@/lib/auth/session.ts';
import { groupFacts } from '@/lib/auth/roles.ts';
import { requireCan } from '@/lib/auth/require-can.ts';
import { can } from '@/lib/permissions.ts';
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
    // Names of who has not seen it: Managers (can()); authors get their own
    // in listAnnouncements.
    const manager = can({ userId: membership.userId }, 'see_unread_names', await groupFacts(id, membership.userId));
    return NextResponse.json({
      announcements: await listAnnouncements(id, membership.userId, { manager }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Post one. Managers only (can()) — checked here, not just hidden in the UI. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const membership = await requireCan(id, 'post_announcement');
    const body = await req.json().catch(() => ({}));
    const { result, replayedId } = await withIdempotency(
      { key: req.headers.get('idempotency-key'), workspaceId: id, route: 'POST /api/workspaces/announcements' },
      () =>
        postAnnouncement({
          workspaceId: id,
          authorUserId: membership.userId,
          title: String(body.title ?? ''),
          body: String(body.body ?? ''),
          link: body.link == null ? null : String(body.link),
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

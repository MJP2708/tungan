import { NextResponse } from 'next/server';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse, withIdempotency } from '@/lib/api/handler.ts';
import { createEvent, listEvents } from '@/lib/calendar-events.ts';
import { HttpError } from '@/lib/http-error.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_RANGE_DAYS = 120;

/** Events between ?from and ?to that this person may see. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership(id);
    const url = new URL(req.url);
    const from = new Date(url.searchParams.get('from') ?? '');
    const to = new Date(url.searchParams.get('to') ?? '');
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
      throw new HttpError(400, 'ต้องระบุช่วงวันที่');
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86400000) {
      throw new HttpError(400, 'ช่วงวันที่ยาวเกินไป');
    }
    const events = await listEvents({
      workspaceId: id,
      userId: membership.userId,
      role: membership.role,
      from,
      to,
    });
    return NextResponse.json({ events });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Add an event. Any member may; who it notifies is decided by its audience. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const membership = await requireMembership(id);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { result, replayedId } = await withIdempotency(
      { key: req.headers.get('idempotency-key'), workspaceId: id, route: 'POST /api/workspaces/events' },
      () => createEvent({ workspaceId: id, createdBy: membership.userId, body }),
    );
    if (replayedId) return NextResponse.json({ id: replayedId, replayed: true });
    if (!result) {
      return NextResponse.json({ error: 'กำลังบันทึกอยู่ ลองอีกครั้งในอีกครู่' }, { status: 409 });
    }
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

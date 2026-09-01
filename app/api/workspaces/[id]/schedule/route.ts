import { NextResponse } from 'next/server';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { workingHoursFor, setSchedule } from '@/lib/reminders/schedule-learning.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Your own working hours in this workspace.
 *
 * Readable and editable by the person they describe. A schedule inferred
 * about someone that they cannot see or correct is surveillance, not
 * scheduling — so the source is reported too, and setting it once stops
 * observation overwriting it.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const membership = await requireMembership(id);
    const hours = await workingHoursFor(id, membership.userId, {
      startsAt: membership.quietHoursEnd,
      endsAt: '18:00',
    });
    return NextResponse.json({
      startsAt: hours.startsAt,
      endsAt: hours.endsAt,
      source: hours.source,
      note:
        hours.source === 'learned'
          ? 'ตั้งจากเวลาที่คุณมักเริ่มทำงาน แก้ได้'
          : hours.source === 'manual'
            ? 'คุณตั้งเองไว้'
            : 'ใช้เวลาทำงานของพื้นที่งาน',
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const membership = await requireMembership(id);
    const body = await req.json().catch(() => ({}));
    const startsAt = String(body.startsAt ?? '');
    const endsAt = String(body.endsAt ?? '');
    const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!valid.test(startsAt) || !valid.test(endsAt)) {
      return NextResponse.json({ error: 'ใส่เวลาแบบ HH:MM' }, { status: 400 });
    }
    // Only your own: one person setting another's hours would let a manager
    // schedule someone else's morning for them.
    await setSchedule(id, membership.userId, startsAt, endsAt);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

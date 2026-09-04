import { NextResponse } from 'next/server';
import { clientDelivery } from '@/lib/delivery/client-view.ts';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { formatDeadline } from '@/lib/deadline.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Completed work with its evidence, in a form that can be sent to a client.
 *
 * Almost entirely data the product already holds — the value is that nobody
 * has to assemble it by hand at the end of a month.
 *
 * Deliberately omits who did what. A client-facing summary is about the work
 * delivered, and turning it into a per-person scoreboard is the ranking this
 * product does not do.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireMembership(id);
    const days = Math.min(180, Math.max(1, Number(new URL(req.url).searchParams.get('days') ?? 30)));

    // Built through the one client-facing view, so a private note cannot
    // reach a client even if this route later grows a new field.
    const rows = await clientDelivery({ workspaceId: id, days });

    const now = new Date();
    const text = [
      `สรุปงานที่เสร็จแล้ว ${days} วันล่าสุด · ${rows.length} งาน`,
      '',
      ...rows.map((r) =>
        `• ${r.title}${r.dueAt ? ` (${formatDeadline(r.dueAt, { now })})` : ''}${
          r.evidenceUrl ? `\n  ${r.evidenceUrl}` : ''
        }${r.notes.map((n) => `\n  ${n.detail}`).join('')}`,
      ),
    ].join('\n');

    return NextResponse.json({ days, count: rows.length, items: rows, text });
  } catch (error) {
    return errorResponse(error);
  }
}

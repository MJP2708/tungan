import { NextResponse } from 'next/server';
import { requireCan } from '@/lib/auth/require-can.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { periodSummaryInput } from '@/lib/ai/inputs.ts';
import { refusalMessage, summarizePeriod } from '@/lib/ai/assist.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Summarise a group's day or week (2026-10-25), for ภาพรวม. Everyone who can
 * see the group's tasks can ask, as everyone can see ภาพรวม. Titles, names and
 * the public blocked preset only — never a private note (lib/ai/inputs.ts).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { userId } = await requireCan(id, 'view_group_tasks');
    const body = await req.json().catch(() => ({}));
    const range = body.range === 'week' ? 'week' : 'day';
    const key = req.headers.get('idempotency-key') ?? crypto.randomUUID();
    const out = await summarizePeriod({
      workspaceId: id,
      idempotencyKey: `period:${range}:${userId}:${key}`,
      input: await periodSummaryInput(id, range),
    });
    if (!out.ok) return NextResponse.json({ error: refusalMessage(out.reason), reason: out.reason }, { status: 409 });
    return NextResponse.json({ range, summary: out.summary, highlights: out.highlights });
  } catch (error) {
    return errorResponse(error);
  }
}

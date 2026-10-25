import { NextResponse } from 'next/server';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { groupFacts, assertCan } from '@/lib/auth/roles.ts';
import { audienceForViewer } from '@/lib/events/visibility.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { findTask, taskSummaryInput } from '@/lib/ai/inputs.ts';
import { refusalMessage, summarizeTask } from '@/lib/ai/assist.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Summarise one task and its history for the person reading it (2026-10-25).
 * The model is given exactly what this reader may see: the same can() check
 * and the same audience as GET /api/tasks/[id], so a private ติดปัญหา note
 * reaches the model only when it would reach the reader.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const found = await findTask(id);
    if (!found) throw new HttpError(404, 'ไม่พบงานนี้');
    const membership = await requireMembership(found.workspaceId);
    const facts = await groupFacts(found.workspaceId, membership.userId);
    await assertCan({ userId: membership.userId, workspaceId: found.workspaceId, action: 'view_group_tasks', task: found, facts });
    const audience = audienceForViewer({ viewerUserId: membership.userId, facts, task: found });

    const key = req.headers.get('idempotency-key') ?? crypto.randomUUID();
    const out = await summarizeTask({
      workspaceId: found.workspaceId,
      // Per reader and task: what one person may read is not another's.
      idempotencyKey: `task:${id}:${membership.userId}:${key}`,
      input: await taskSummaryInput(found, audience),
    });
    if (!out.ok) return NextResponse.json({ error: refusalMessage(out.reason), reason: out.reason }, { status: 409 });
    return NextResponse.json({ summary: out.summary, nextStep: out.nextStep });
  } catch (error) {
    return errorResponse(error);
  }
}

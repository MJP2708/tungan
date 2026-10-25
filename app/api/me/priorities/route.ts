import { NextResponse } from 'next/server';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { myTasksFor } from '@/lib/tasks/my-work.ts';
import { refusalMessage, suggestPriorities } from '@/lib/ai/assist.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "What should I do first?" (2026-10-25): up to three of my own tasks, each
 * with a reason. A suggestion beside งานฉัน — its order never changes.
 *
 * The workspace the person is looking at pays, and only if they belong to it
 * (checked here, never taken on the client's word) and its AI is on. Only the
 * caller's own tasks are ever sent.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const membership = await requireMembership(String(body.workspaceId ?? ''));
    const key = req.headers.get('idempotency-key') ?? crypto.randomUUID();
    const out = await suggestPriorities({
      workspaceId: membership.workspaceId,
      // Scoped to the person: one person's key never returns another's answer.
      idempotencyKey: `${membership.userId}:${key}`,
      tasks: await myTasksFor(membership.userId),
    });
    if (!out.ok) return NextResponse.json({ error: refusalMessage(out.reason), reason: out.reason }, { status: 409 });
    return NextResponse.json({ suggestions: out.suggestions });
  } catch (error) {
    return errorResponse(error);
  }
}

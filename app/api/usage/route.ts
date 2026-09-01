import { NextResponse } from 'next/server';
import { db } from '@/lib/db/index.ts';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { usedThisMonth, billingMonth } from '@/lib/line/messaging.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? '';
    const membership = await requireMembership(workspaceId);
    const month = billingMonth();
    const used = await usedThisMonth(workspaceId, month);
    return NextResponse.json({
      month,
      // Counted by actual recipients, not by API calls. Replies are free and
      // are recorded with a recipient count of 0.
      used,
      cap: membership.monthlyMessageCap,
      remaining: Math.max(0, membership.monthlyMessageCap - used),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

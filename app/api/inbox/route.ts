import { NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { inboxItem } from '@/lib/db/schema.ts';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? '';
    await requireMembership(workspaceId);
    const rows = await db()
      .select()
      .from(inboxItem)
      .where(and(eq(inboxItem.workspaceId, workspaceId), eq(inboxItem.state, 'pending')))
      .orderBy(desc(inboxItem.createdAt));
    return NextResponse.json({ items: rows });
  } catch (error) {
    return errorResponse(error);
  }
}

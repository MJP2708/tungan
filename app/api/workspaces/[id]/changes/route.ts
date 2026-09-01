import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { task, inboxItem } from '@/lib/db/schema.ts';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A cheap "has anything changed?" probe.
 *
 * Clients poll this instead of re-fetching tasks and inbox on a timer, so the
 * common case — nothing happened — costs two counts and a max(), not the whole
 * workspace. Only when the version string differs does the client pull the
 * real data.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireMembership(id);

    const [tasks] = await db()
      .select({
        count: sql<number>`count(*)::int`,
        latest: sql<string | null>`max(${task.updatedAt})`,
      })
      .from(task)
      .where(eq(task.workspaceId, id));

    const [inbox] = await db()
      .select({
        count: sql<number>`count(*)::int`,
        latest: sql<string | null>`max(${inboxItem.createdAt})`,
      })
      .from(inboxItem)
      .where(and(eq(inboxItem.workspaceId, id), eq(inboxItem.state, 'pending')));

    return NextResponse.json({
      version: [tasks?.count ?? 0, tasks?.latest ?? '', inbox?.count ?? 0, inbox?.latest ?? ''].join('|'),
      pendingInbox: inbox?.count ?? 0,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

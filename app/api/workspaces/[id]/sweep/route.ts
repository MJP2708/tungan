import { NextResponse } from 'next/server';
import { and, eq, ne, lt, sql, desc } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { task, lineUser } from '@/lib/db/schema.ts';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { zonedDateParts, fromZonedWallClock } from '@/lib/deadline.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * End-of-day sweep: what has not moved today.
 *
 * One list of everything still open that nobody touched since this morning,
 * so the day can be closed in one pass instead of hunting through the board.
 * It reports time-in-state rather than an overdue count — how long something
 * has been stuck is the number you can act on.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireMembership(id);

    const now = new Date();
    const p = zonedDateParts(now);
    const startOfToday = fromZonedWallClock(p.year, p.month, p.day, 0, 0);

    const rows = await db()
      .select({
        id: task.id,
        title: task.title,
        status: task.status,
        blockedReason: task.blockedReason,
        dueAt: task.dueAt,
        statusChangedAt: task.statusChangedAt,
        updatedAt: task.updatedAt,
        assigneeName: lineUser.displayName,
        pendingAssigneeUserId: task.pendingAssigneeUserId,
      })
      .from(task)
      .leftJoin(lineUser, eq(lineUser.id, task.assigneeUserId))
      .where(
        and(
          eq(task.workspaceId, id),
          ne(task.status, 'done'),
          lt(task.updatedAt, startOfToday),
        ),
      )
      .orderBy(desc(task.statusChangedAt));

    return NextResponse.json({
      items: rows.map((r) => ({
        ...r,
        // Days in the current state, which is what makes "ติดปัญหา 3 วัน"
        // sayable at all.
        daysInState: Math.max(
          0,
          Math.floor((now.getTime() - r.statusChangedAt.getTime()) / 86400000),
        ),
        awaitingHandoff: Boolean(r.pendingAssigneeUserId),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

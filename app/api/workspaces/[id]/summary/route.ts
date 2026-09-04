import { NextResponse } from 'next/server';
import { and, eq, gte, desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { task, lineUser } from '@/lib/db/schema.ts';
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
    const since = new Date(Date.now() - days * 86400000);

    const rows = await db()
      .select({
        title: task.title,
        dueAt: task.dueAt,
        evidenceUrl: task.evidenceUrl,
        updatedAt: task.updatedAt,
        closedAt: task.closedAt,
      })
      .from(task)
      // Only closed work, and windowed on when it actually closed. `updatedAt`
      // moves for any later edit, so a task closed three months ago could
      // reappear in a 30-day summary because someone fixed a typo in it.
      .where(
        and(
          eq(task.workspaceId, id),
          eq(task.status, 'done'),
          gte(sql`coalesce(${task.closedAt}, ${task.updatedAt})`, since),
        ),
      )
      .orderBy(desc(sql`coalesce(${task.closedAt}, ${task.updatedAt})`));

    const now = new Date();
    const text = [
      `สรุปงานที่เสร็จแล้ว ${days} วันล่าสุด · ${rows.length} งาน`,
      '',
      ...rows.map((r) =>
        `• ${r.title}${r.dueAt ? ` (${formatDeadline(r.dueAt, { now })})` : ''}${
          r.evidenceUrl ? `\n  ${r.evidenceUrl}` : ''
        }`,
      ),
    ].join('\n');

    return NextResponse.json({ days, count: rows.length, items: rows, text });
  } catch (error) {
    return errorResponse(error);
  }
}

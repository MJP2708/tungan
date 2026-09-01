import { NextResponse } from 'next/server';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { task, taskEvent, lineUser } from '@/lib/db/schema.ts';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What needs unblocking — "ต้องช่วยตรงไหน".
 *
 * Deliberately keyed on the task and what it is waiting for, not on the
 * person. It never counts how many times someone was late or ranks members,
 * because a tool that shames a slow teammate stops being used honestly: people
 * hide problems instead of flagging them, which is the opposite of the point.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireMembership(id);

    const stuck = await db()
      .select({
        id: task.id,
        title: task.title,
        status: task.status,
        dueAt: task.dueAt,
        assigneeUserId: task.assigneeUserId,
        assigneeName: lineUser.displayName,
      })
      .from(task)
      .leftJoin(lineUser, eq(lineUser.id, task.assigneeUserId))
      .where(and(eq(task.workspaceId, id), eq(task.status, 'blocked')))
      .orderBy(desc(task.updatedAt));

    if (!stuck.length) return NextResponse.json({ items: [] });

    // The note from the most recent ขอข้อมูล / ติดปัญหา is what someone
    // actually needs, so the reader can help rather than just chase.
    const events = await db()
      .select({
        taskId: taskEvent.taskId,
        kind: taskEvent.kind,
        detail: taskEvent.detail,
        at: taskEvent.at,
      })
      .from(taskEvent)
      .where(
        and(
          inArray(taskEvent.taskId, stuck.map((s) => s.id)),
          inArray(taskEvent.kind, ['blocked', 'info']),
        ),
      )
      .orderBy(desc(taskEvent.at));

    const latest = new Map<string, { detail: string; at: Date }>();
    for (const e of events) {
      if (!latest.has(e.taskId)) latest.set(e.taskId, { detail: e.detail, at: e.at });
    }

    return NextResponse.json({
      items: stuck.map((s) => ({
        ...s,
        needs: latest.get(s.id)?.detail ?? 'ยังไม่ได้ระบุว่าติดตรงไหน',
        since: latest.get(s.id)?.at ?? null,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

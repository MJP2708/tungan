import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { inboxItem, task, taskEvent } from '@/lib/db/schema.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { planRemindersForTask } from '@/lib/reminders/plan.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Confirm several drafts at once.
 *
 * Each row is claimed with the same conditional update the single confirm
 * uses, so a batch that overlaps another confirm creates one task per draft,
 * not two — and a retried batch is a no-op rather than a duplicate run.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (!ids.length) return NextResponse.json({ error: 'ยังไม่ได้เลือกข้อความ' }, { status: 400 });

    const items = await db().select().from(inboxItem).where(inArray(inboxItem.id, ids));
    if (!items.length) throw new HttpError(404, 'ไม่พบข้อความที่เลือก');

    // Every selected draft must belong to one workspace the caller is in.
    const workspaces = new Set(items.map((i) => i.workspaceId));
    if (workspaces.size > 1) {
      return NextResponse.json({ error: 'เลือกข้ามพื้นที่งานไม่ได้' }, { status: 400 });
    }
    const membership = await requireMembership([...workspaces][0]);

    const created: string[] = [];
    let skipped = 0;
    for (const item of items) {
      const claimed = await db()
        .update(inboxItem)
        .set({ state: 'created', rawMessage: null })
        .where(and(eq(inboxItem.id, item.id), eq(inboxItem.state, 'pending')))
        .returning({ id: inboxItem.id });
      if (!claimed.length) {
        skipped += 1;
        continue;
      }
      const taskId = crypto.randomUUID();
      await db().insert(task).values({
        id: taskId,
        workspaceId: item.workspaceId,
        title: item.suggestedTitle || 'งานจาก LINE',
        assigneeUserId: item.suggestedAssigneeUserId,
        primaryAssigneeUserId: item.suggestedAssigneeUserId,
        source: item.lineGroupId ? 'LINE · กลุ่ม' : 'LINE · DM',
        dueAt: item.suggestedDueAt,
        createdByUserId: membership.userId,
      });
      await db().insert(taskEvent).values({
        id: crypto.randomUUID(),
        taskId,
        workspaceId: item.workspaceId,
        actorUserId: membership.userId,
        kind: 'created',
        detail: 'ยืนยันพร้อมกันหลายรายการ',
      });
      await planRemindersForTask(taskId);
      created.push(taskId);
    }

    return NextResponse.json({ created: created.length, skipped }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

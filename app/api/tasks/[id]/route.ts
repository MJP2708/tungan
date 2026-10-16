import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { task, taskEvent } from '@/lib/db/schema.ts';
import { listTaskEvents } from '@/lib/db/events.ts';
import { audienceForViewer } from '@/lib/events/visibility.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { planRemindersForTask } from '@/lib/reminders/plan.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { isSafeHttpUrl } from '@/lib/url.ts';
import { assertAssignable } from '@/lib/auth/assignable.ts';
import { groupFacts, assertCan } from '@/lib/auth/roles.ts';
import { audit } from '@/lib/audit.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadTask(id: string) {
  const rows = await db().select().from(task).where(eq(task.id, id)).limit(1);
  if (!rows[0]) throw new HttpError(404, 'ไม่พบงานนี้');
  return rows[0];
}

/** One task plus its history. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const found = await loadTask(id);
    // Authorization comes from the task's own workspace, never from the URL.
    const membership = await requireMembership(found.workspaceId);
    const facts = await groupFacts(found.workspaceId, membership.userId);
    // A personal task is its maker's alone (can()).
    await assertCan({ userId: membership.userId, workspaceId: found.workspaceId, action: 'view_group_tasks', task: found, facts });
    // Anyone not entitled to the private reason reads it as the group does:
    // they see it is blocked, not why.
    const history = await listTaskEvents(
      id,
      audienceForViewer({ viewerUserId: membership.userId, facts, task: found }),
    );
    return NextResponse.json({ task: found, history });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Edit the fields a person can change by hand. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const found = await loadTask(id);
    const membership = await requireMembership(found.workspaceId);
    const body = await req.json().catch(() => ({}));
    // Each field is its own permission (can()): the deadline and the person
    // are Manager decisions; the title, note, priority and proof belong to
    // whoever is doing the work, or a Manager. Checked before anything is
    // written, so a refused field never leaves the others half-saved.
    const facts = await groupFacts(found.workspaceId, membership.userId);
    const check = (action: Parameters<typeof assertCan>[0]['action']) =>
      assertCan({ userId: membership.userId, workspaceId: found.workspaceId, action, task: found, facts });
    // Only an actual change counts: the edit form sends every field, and a
    // worker saving a new title must not be refused over the deadline it
    // left alone.
    const sameInstant = (a: unknown, b: Date | null) =>
      (a === null && b === null) ||
      (a !== null && b !== null && new Date(String(a)).getTime() === b.getTime());
    const dueChanges = body.dueAt !== undefined && !sameInstant(body.dueAt, found.dueAt);
    const assigneeChanges =
      body.assigneeUserId !== undefined && (body.assigneeUserId || null) !== found.assigneeUserId;
    if (dueChanges) await check('change_deadline');
    if (assigneeChanges) await check('reassign_task');
    if (
      typeof body.title === 'string' ||
      typeof body.note === 'string' ||
      typeof body.priority === 'string' ||
      typeof body.evidenceUrl === 'string'
    ) {
      await check('edit_task_details');
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    const changed: string[] = [];

    if (typeof body.title === 'string') {
      const title = body.title.trim();
      if (!title) return NextResponse.json({ error: 'ใส่ชื่องานก่อน' }, { status: 400 });
      patch.title = title;
      changed.push('ชื่องาน');
    }
    if (typeof body.note === 'string') {
      patch.note = body.note;
      changed.push('รายละเอียด');
    }
    if (dueChanges) {
      // A real instant or nothing. Never a phrase.
      if (body.dueAt === null) {
        patch.dueAt = null;
      } else {
        const at = new Date(String(body.dueAt));
        if (!Number.isFinite(at.getTime())) {
          return NextResponse.json({ error: 'กำหนดส่งไม่ถูกต้อง' }, { status: 400 });
        }
        patch.dueAt = at;
      }
      changed.push('กำหนดส่ง');
    }
    if (assigneeChanges) {
      patch.assigneeUserId = await assertAssignable(found.workspaceId, body.assigneeUserId);
      changed.push('ผู้รับผิดชอบ');
    }
    if (typeof body.priority === 'string') {
      patch.priority = body.priority;
      changed.push('ความสำคัญ');
    }
    if (typeof body.evidenceUrl === 'string') {
      if (!isSafeHttpUrl(body.evidenceUrl)) {
        return NextResponse.json(
          { error: 'ใส่ลิงก์ http:// หรือ https:// ที่ถูกต้อง' },
          { status: 400 },
        );
      }
      patch.evidenceUrl = body.evidenceUrl;
      changed.push('ลิงก์หลักฐาน');
    }

    await db().update(task).set(patch).where(eq(task.id, id));
    if ('dueAt' in patch && String(patch.dueAt ?? '') !== String(found.dueAt ?? '')) {
      await audit({
        actorUserId: membership.userId,
        action: 'deadline_changed',
        workspaceId: found.workspaceId,
        targetTaskId: id,
        targetUserId: found.assigneeUserId,
        before: { dueAt: found.dueAt },
        after: { dueAt: patch.dueAt },
      });
    }
    if ('assigneeUserId' in patch && patch.assigneeUserId !== found.assigneeUserId) {
      await audit({
        actorUserId: membership.userId,
        action: 'task_reassigned',
        workspaceId: found.workspaceId,
        targetTaskId: id,
        targetUserId: (patch.assigneeUserId as string | null) ?? null,
        before: { assigneeUserId: found.assigneeUserId },
        after: { assigneeUserId: patch.assigneeUserId },
      });
    }
    await db().insert(taskEvent).values({
      id: crypto.randomUUID(),
      taskId: id,
      workspaceId: found.workspaceId,
      actorUserId: membership.userId,
      kind: 'edited',
      detail: `แก้ไข: ${changed.join(', ') || 'ไม่มีการเปลี่ยนแปลง'}`,
    });

    await planRemindersForTask(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Delete a task.
 *
 * Restricted to the person accountable for it or a workspace owner/admin:
 * deleting is the one action that removes another person's record of the work,
 * and task_event rows go with it.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const found = await loadTask(id);
    const membership = await requireMembership(found.workspaceId);
    // Who asked for it, or a Manager (can(): delete_task).
    await assertCan({ userId: membership.userId, workspaceId: found.workspaceId, action: 'delete_task', task: found });

    await db().delete(task).where(eq(task.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

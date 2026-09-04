import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { task, taskEvent } from '@/lib/db/schema.ts';
import { listTaskEvents } from '@/lib/db/events.ts';
import { audienceForViewer } from '@/lib/events/visibility.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { planRemindersForTask } from '@/lib/reminders/plan.ts';
import { errorResponse } from '@/lib/api/handler.ts';

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
    // A member with no connection to this task reads it as the workspace
    // does: they see it is blocked, not why.
    const history = await listTaskEvents(
      id,
      audienceForViewer({ viewerUserId: membership.userId, role: membership.role, task: found }),
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
    if (body.dueAt !== undefined) {
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
    if (body.assigneeUserId !== undefined) {
      patch.assigneeUserId = body.assigneeUserId || null;
      changed.push('ผู้รับผิดชอบ');
    }
    if (typeof body.priority === 'string') {
      patch.priority = body.priority;
      changed.push('ความสำคัญ');
    }
    if (typeof body.evidenceUrl === 'string') {
      try {
        const url = new URL(body.evidenceUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        return NextResponse.json(
          { error: 'ใส่ลิงก์ http:// หรือ https:// ที่ถูกต้อง' },
          { status: 400 },
        );
      }
      patch.evidenceUrl = body.evidenceUrl;
      changed.push('ลิงก์หลักฐาน');
    }

    await db().update(task).set(patch).where(eq(task.id, id));
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

    const mayDelete =
      membership.role === 'owner' ||
      membership.role === 'admin' ||
      found.createdByUserId === membership.userId ||
      found.primaryAssigneeUserId === membership.userId;
    if (!mayDelete) {
      throw new HttpError(403, 'ลบได้เฉพาะผู้สร้างงาน ผู้รับผิดชอบหลัก หรือผู้ดูแลพื้นที่งาน');
    }

    await db().delete(task).where(eq(task.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

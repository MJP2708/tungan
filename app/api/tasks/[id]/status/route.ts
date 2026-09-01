import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { task, taskEvent } from '@/lib/db/schema.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The five mobile transitions. Each writes a task_event. */
const TRANSITIONS = {
  accept: { status: 'progress', reviewState: 'working', kind: 'accepted', detail: 'รับงาน' },
  info: { status: 'blocked', reviewState: 'working', kind: 'info', detail: 'ขอข้อมูลเพิ่ม' },
  blocked: { status: 'blocked', reviewState: 'working', kind: 'blocked', detail: 'ติดปัญหา' },
  handoff: { status: null, reviewState: null, kind: 'handoff', detail: 'ส่งต่อ' },
  submit: { status: 'progress', reviewState: 'review', kind: 'submitted', detail: 'ส่งงาน' },
} as const;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const action = String(body.action ?? '') as keyof typeof TRANSITIONS;
    const move = TRANSITIONS[action];
    if (!move) return NextResponse.json({ error: 'ไม่รู้จักการกระทำนี้' }, { status: 400 });

    const rows = await db().select().from(task).where(eq(task.id, id)).limit(1);
    const found = rows[0];
    if (!found) throw new HttpError(404, 'ไม่พบงานนี้');

    // Authorization comes from the task's own workspace, never from the body.
    const membership = await requireMembership(found.workspaceId);

    // Only the assignee or the primary owner may move a task, which is the
    // same rule the UI shows as the lock icon.
    const mayEdit =
      found.assigneeUserId === membership.userId ||
      found.primaryAssigneeUserId === membership.userId ||
      membership.role === 'owner' ||
      membership.role === 'admin';
    if (!mayEdit) throw new HttpError(403, 'งานนี้ดูได้อย่างเดียว เพราะคุณไม่ใช่ผู้รับผิดชอบ');

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (move.status) patch.status = move.status;
    if (move.reviewState) patch.reviewState = move.reviewState;
    if (action === 'accept' && !found.acceptedAt) patch.acceptedAt = new Date();
    if (action === 'handoff') {
      const to = body.assigneeUserId ? String(body.assigneeUserId) : null;
      if (!to) return NextResponse.json({ error: 'ต้องระบุผู้รับงานต่อ' }, { status: 400 });
      patch.assigneeUserId = to;
      if (!found.primaryAssigneeUserId) patch.primaryAssigneeUserId = found.assigneeUserId;
    }
    if (action === 'submit') {
      const evidenceUrl = body.evidenceUrl ? String(body.evidenceUrl) : found.evidenceUrl;
      if (!evidenceUrl) {
        return NextResponse.json({ error: 'เพิ่มลิงก์หลักฐานก่อนส่งตรวจ' }, { status: 400 });
      }
      try {
        const url = new URL(evidenceUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        return NextResponse.json({ error: 'ใส่ลิงก์ http:// หรือ https:// ที่ถูกต้อง' }, { status: 400 });
      }
      patch.evidenceUrl = evidenceUrl;
    }

    await db().update(task).set(patch).where(eq(task.id, id));
    await db().insert(taskEvent).values({
      id: crypto.randomUUID(),
      taskId: id,
      workspaceId: found.workspaceId,
      actorUserId: membership.userId,
      kind: move.kind,
      detail: move.detail,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

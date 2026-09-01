import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { task, taskEvent, reminder, lineUser } from '@/lib/db/schema.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { planRemindersForTask } from '@/lib/reminders/plan.ts';
import { pushToUser } from '@/lib/line/messaging.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The five mobile transitions. Each writes a task_event. */
const TRANSITIONS = {
  accept: { status: 'progress', reviewState: 'working', kind: 'accepted', detail: 'รับงาน' },
  info: { status: 'blocked', reviewState: 'working', kind: 'info', detail: 'ขอข้อมูลเพิ่ม' },
  blocked: { status: 'blocked', reviewState: 'working', kind: 'blocked', detail: 'ติดปัญหา' },
  handoff: { status: null, reviewState: null, kind: 'handoff', detail: 'ส่งต่อ' },
  accept_handoff: { status: 'progress', reviewState: 'working', kind: 'handoff_accepted', detail: 'รับงานที่ส่งต่อมา' },
  decline_handoff: { status: null, reviewState: null, kind: 'handoff_declined', detail: 'ปฏิเสธงานที่ส่งต่อ' },
  submit: { status: 'progress', reviewState: 'review', kind: 'submitted', detail: 'ส่งงาน' },
  approve: { status: 'done', reviewState: 'approved', kind: 'approved', detail: 'อนุมัติงาน' },
  revision: { status: 'progress', reviewState: 'revision', kind: 'revision', detail: 'ขอแก้ไข' },
} as const;

/** Reviewing someone's work is a different right from doing the work. */
const REVIEW_ACTIONS = new Set(['approve', 'revision']);

/** The only two things the person receiving an offer may do. */
const HANDOFF_ANSWERS = new Set(['accept_handoff', 'decline_handoff']);

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
      // The person a handoff was offered to has to be able to answer it.
      // They are deliberately not the assignee yet — that is the whole point
      // of an offer — so the ordinary check would lock them out of the only
      // two actions they are allowed.
      found.pendingAssigneeUserId === membership.userId ||
      membership.role === 'owner' ||
      membership.role === 'admin';
    if (!mayEdit) throw new HttpError(403, 'งานนี้ดูได้อย่างเดียว เพราะคุณไม่ใช่ผู้รับผิดชอบ');

    // ...but that only unlocks answering the offer, nothing else.
    if (
      found.pendingAssigneeUserId === membership.userId &&
      found.assigneeUserId !== membership.userId &&
      membership.role === 'member' &&
      !HANDOFF_ANSWERS.has(action)
    ) {
      throw new HttpError(403, 'รับงานที่ส่งต่อมาก่อน จึงจะแก้ไขงานนี้ได้');
    }

    // Approving your own submission would make review meaningless, so the
    // person who asked for the work signs it off, not the person who did it.
    // This is enforced here rather than in the UI, which is where the
    // prototype's approval had no check at all.
    if (REVIEW_ACTIONS.has(action)) {
      const mayReview =
        membership.role === 'owner' ||
        membership.role === 'admin' ||
        found.createdByUserId === membership.userId;
      if (!mayReview) {
        throw new HttpError(403, 'ตรวจงานได้เฉพาะผู้สั่งงานหรือผู้ดูแลพื้นที่งาน');
      }
    }

    // ขอข้อมูล and ติดปัญหา carry a short note saying what is needed. Without
    // it the team view can only say someone is stuck, not what would unstick
    // them.
    // ติดปัญหา takes a preset reason so it is countable and sortable. Free
    // text stays optional: forcing prose is how a required field turns into
    // "-" and stops meaning anything.
    const BLOCKED_REASONS = ['รอลูกค้า', 'รอของ', 'รอคนอื่น', 'อื่นๆ'] as const;
    const note = String(body.note ?? '').trim().slice(0, 300);
    const reason = String(body.reason ?? '').trim();
    if (action === 'blocked') {
      if (!BLOCKED_REASONS.includes(reason as (typeof BLOCKED_REASONS)[number])) {
        return NextResponse.json(
          { error: `เลือกเหตุผล: ${BLOCKED_REASONS.join(' / ')}` },
          { status: 400 },
        );
      }
    }
    if (action === 'info' && !note) {
      return NextResponse.json(
        { error: 'บอกสั้น ๆ ว่าต้องการข้อมูลอะไร' },
        { status: 400 },
      );
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (move.status) patch.status = move.status;
    if (move.reviewState) patch.reviewState = move.reviewState;
    if (action === 'accept' && !found.acceptedAt) patch.acceptedAt = new Date();
    if (action === 'handoff') {
      const to = body.assigneeUserId ? String(body.assigneeUserId) : null;
      if (!to) return NextResponse.json({ error: 'ต้องระบุผู้รับงานต่อ' }, { status: 400 });
      if (to === found.assigneeUserId) {
        return NextResponse.json({ error: 'งานนี้อยู่กับผู้รับคนนี้แล้ว' }, { status: 400 });
      }
      // Offered, not moved. The task stays with the sender until the receiver
      // accepts, so work cannot fall into the gap between two people who each
      // think the other has it.
      patch.pendingAssigneeUserId = to;
      patch.handoffOfferedAt = new Date();
    }

    if (action === 'accept_handoff') {
      if (!found.pendingAssigneeUserId) {
        return NextResponse.json({ error: 'ไม่มีงานที่ส่งต่อมารอรับ' }, { status: 400 });
      }
      if (found.pendingAssigneeUserId !== membership.userId) {
        throw new HttpError(403, 'งานนี้ส่งต่อให้คนอื่น');
      }
      patch.assigneeUserId = found.pendingAssigneeUserId;
      if (!found.primaryAssigneeUserId) patch.primaryAssigneeUserId = found.assigneeUserId;
      patch.pendingAssigneeUserId = null;
      patch.handoffOfferedAt = null;
      patch.acceptedAt = new Date();
    }

    if (action === 'decline_handoff') {
      if (found.pendingAssigneeUserId !== membership.userId) {
        throw new HttpError(403, 'งานนี้ส่งต่อให้คนอื่น');
      }
      // Back to the sender, visibly, rather than vanishing.
      patch.pendingAssigneeUserId = null;
      patch.handoffOfferedAt = null;
    }

    if (action === 'blocked') patch.blockedReason = reason;
    else if (move.status && move.status !== 'blocked') patch.blockedReason = null;
    if (move.status && move.status !== found.status) patch.statusChangedAt = new Date();
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

    // Handing over moves the reminders too. Leaving them behind would keep
    // nagging someone who is no longer responsible, which is the fastest way
    // to teach a team to ignore the bot.
    if (action === 'accept_handoff' && found.assigneeUserId) {
      await db()
        .delete(reminder)
        .where(
          and(
            eq(reminder.taskId, id),
            eq(reminder.recipientUserId, found.assigneeUserId),
            eq(reminder.state, 'pending'),
          ),
        );
    }

    // Closing a task cancels anything still queued for it.
    if (action === 'approve') {
      await db()
        .delete(reminder)
        .where(and(eq(reminder.taskId, id), eq(reminder.state, 'pending')));
    }

    const names = await db()
      .select({ id: lineUser.id, name: lineUser.displayName })
      .from(lineUser)
      .where(inArray(lineUser.id, [
        found.assigneeUserId,
        patch.assigneeUserId as string,
        patch.pendingAssigneeUserId as string,
      ].filter(Boolean) as string[]));
    const nameOf = (id: string | null) =>
      names.find((n) => n.id === id)?.name || 'ไม่ทราบชื่อ';

    await db().insert(taskEvent).values({
      id: crypto.randomUUID(),
      taskId: id,
      workspaceId: found.workspaceId,
      actorUserId: membership.userId,
      kind: move.kind,
      // Handing over records both people, so the history answers "who had
      // this and when" without guessing.
      detail:
        action === 'handoff'
          ? `เสนอส่งต่อจาก ${nameOf(found.assigneeUserId)} ให้ ${nameOf(patch.pendingAssigneeUserId as string)} · รอผู้รับกดรับ`
          : action === 'blocked'
            ? `ติดปัญหา: ${reason}${note ? ` · ${note}` : ''}`
            : note
              ? `${move.detail}: ${note}`
              : move.detail,
    });

    // The receiver has to know an offer is waiting, or it sits forever.
    // One DM, and offers to the same person merge into it.
    if (action === 'handoff' && patch.pendingAssigneeUserId) {
      const waiting = await db()
        .select({ title: task.title })
        .from(task)
        .where(eq(task.pendingAssigneeUserId, patch.pendingAssigneeUserId as string));
      await pushToUser({
        workspaceId: found.workspaceId,
        recipientUserId: patch.pendingAssigneeUserId as string,
        taskId: id,
        messages: [{
          type: 'text',
          text:
            (waiting.length > 1 ? `มีงานส่งต่อรอคุณรับ ${waiting.length} งาน` : 'มีงานส่งต่อถึงคุณ') +
            `\n${waiting.map((w) => `• ${w.title}`).join('\n')}` +
            `\n\nกดรับหรือปฏิเสธในแอป: ${(process.env.APP_BASE_URL ?? '').replace(/\/$/, '')}`,
        }],
      }).catch((error) => console.error('[handoff] notify failed', error));
    }

    // The answer to "who should be reminded, and when" just changed.
    await planRemindersForTask(id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

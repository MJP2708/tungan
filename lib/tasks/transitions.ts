import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { task, taskEvent, reminder, lineUser, workspaceMember } from '../db/schema.ts';
import { HttpError } from '../auth/session.ts';
import { planRemindersForTask } from '../reminders/plan.ts';
import { pushToUser } from '../line/messaging.ts';
import { noteActivity } from '../reminders/schedule-learning.ts';
import { checkEvidenceLink } from '../evidence/check-link.ts';
import { isSafeHttpUrl } from '../url.ts';
import { audienceLabel, defaultVisibilityFor, normalizeVisibility } from '../events/visibility.ts';
import { BLOCKED_REASONS, isBlockedReason } from './reasons.ts';
import { appLink } from '@/lib/deep-link.ts';

/**
 * Every way a task can move, in one place.
 *
 * Lifted out of the route handler because the same transitions now arrive from
 * two directions: the app, carrying a session cookie, and a postback tapped
 * inside LINE, carrying no cookie at all. Two copies of these rules would
 * drift, and the half that drifted would be the permission checks.
 *
 * Nothing here knows about HTTP. A refusal is an HttpError, which the route
 * turns into a status code and the webhook turns into a reply.
 */

/** The five worker transitions plus the review pair. Each writes a task_event. */
export const TRANSITIONS = {
  accept: { status: 'progress', reviewState: 'working', kind: 'accepted', detail: 'รับงาน' },
  info: { status: 'blocked', reviewState: 'working', kind: 'info', detail: 'ขอข้อมูลเพิ่ม' },
  blocked: { status: 'blocked', reviewState: 'working', kind: 'blocked', detail: 'ติดปัญหา' },
  handoff: { status: null, reviewState: null, kind: 'handoff', detail: 'ส่งต่อ' },
  accept_handoff: { status: 'progress', reviewState: 'working', kind: 'handoff_accepted', detail: 'รับงานที่ส่งต่อมา' },
  decline_handoff: { status: null, reviewState: null, kind: 'handoff_declined', detail: 'ปฏิเสธงานที่ส่งต่อ' },
  // เสร็จแล้ว means submitted, not closed. Wording that implies the task is
  // over is what made the approval step decorative in the prototype.
  submit: { status: 'review', reviewState: 'review', kind: 'submitted', detail: 'ส่งงาน' },
  approve: { status: 'done', reviewState: 'approved', kind: 'approved', detail: 'อนุมัติงาน' },
  revision: { status: 'progress', reviewState: 'revision', kind: 'revision', detail: 'ขอแก้ไข' },
} as const;

export type TransitionAction = keyof typeof TRANSITIONS;

export function isTransition(value: unknown): value is TransitionAction {
  return typeof value === 'string' && value in TRANSITIONS;
}


/** Reviewing someone's work is a different right from doing the work. */
const REVIEW_ACTIONS = new Set(['approve', 'revision']);

/** The only two things the person receiving an offer may do. */
const HANDOFF_ANSWERS = new Set(['accept_handoff', 'decline_handoff']);

export type TransitionActor = { userId: string; role: string };

/**
 * Read one field of the request body as text.
 *
 * The body is JSON from a client, so a field can be any shape. Coercing an
 * object with String() stores the literal text "[object Object]" as somebody's
 * blocked reason, which then looks like real data in every view that reads it.
 * Anything that is not a string is treated as absent.
 */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export type TransitionInput = {
  note?: unknown;
  reason?: unknown;
  assigneeUserId?: unknown;
  evidenceUrl?: unknown;
  /** Set only by an explicit "ส่งโดยไม่มีลิงก์" choice, never a default. */
  allowWithoutEvidence?: unknown;
  dueAt?: unknown;
  visibility?: unknown;
};

export type TransitionResult = {
  ok: true;
  alreadyApplied: boolean;
  warning: string | null;
  eventId: string | null;
  visibility: string | null;
  audienceNote: string | null;
};

/**
 * Who has to sign this submission off.
 *
 * The person who asked for the work, when that is somebody other than the
 * person who did it. Otherwise an owner of the workspace — anyone but the
 * worker, because a submission routed back to its own author is not a review.
 * Null when there is genuinely nobody else, in which case no nudge is
 * scheduled rather than one being sent to the worker.
 */
async function resolveReviewer(
  workspaceId: string,
  createdByUserId: string | null,
  assigneeUserId: string | null,
): Promise<string | null> {
  if (createdByUserId && createdByUserId !== assigneeUserId) return createdByUserId;
  const owners = await db()
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        inArray(workspaceMember.role, ['owner', 'admin']),
      ),
    );
  return owners.find((o) => o.userId !== assigneeUserId)?.userId ?? null;
}

/**
 * Apply one transition.
 *
 * The caller proves WHO the actor is — a session cookie in the app, a verified
 * LINE user id in the webhook. Everything after that, including whether they
 * belong to this workspace at all, is decided here.
 */
export async function applyTransition(params: {
  taskId: string;
  action: TransitionAction;
  /** The LINE-identified user making the move. Their role is resolved here. */
  actorUserId: string;
  input?: TransitionInput;
}): Promise<TransitionResult> {
  const { taskId, action, actorUserId } = params;
  const input = (params.input ?? {}) as Record<string, unknown>;
  const move = TRANSITIONS[action];
  const rows = await db().select().from(task).where(eq(task.id, taskId)).limit(1);
  const found = rows[0];
  if (!found) throw new HttpError(404, 'ไม่พบงานนี้');

  // Membership is resolved HERE, against the task's own workspace, rather
  // than trusted from the caller. Both callers know who the actor is but not
  // which workspace the task belongs to until this row is read, so a caller
  // that resolved it first would be resolving the wrong thing — and the
  // webhook has no session to resolve it from at all.
  const [membership] = await db()
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, found.workspaceId),
        eq(workspaceMember.userId, actorUserId),
      ),
    )
    .limit(1);
  // 404, not 403: a non-member must not learn that this task exists.
  if (!membership) throw new HttpError(404, 'ไม่พบงานนี้');
  const actor: TransitionActor = { userId: actorUserId, role: membership.role };

  // Only the assignee or the primary owner may move a task, which is the
  // same rule the UI shows as the lock icon.
  const mayEdit =
    found.assigneeUserId === actor.userId ||
    found.primaryAssigneeUserId === actor.userId ||
    // The person a handoff was offered to has to be able to answer it.
    // They are deliberately not the assignee yet — that is the whole point
    // of an offer — so the ordinary check would lock them out of the only
    // two actions they are allowed.
    found.pendingAssigneeUserId === actor.userId ||
    // The person who ASKED for the work has to be able to sign it off, and
    // in an agency that is usually an account manager holding a plain
    // member role, not a workspace admin. Without this the review right
    // below could never be reached by the one person it names.
    found.createdByUserId === actor.userId ||
    actor.role === 'owner' ||
    actor.role === 'admin';
  if (!mayEdit) throw new HttpError(403, 'งานนี้ดูได้อย่างเดียว เพราะคุณไม่ใช่ผู้รับผิดชอบ');

  // ...but that only unlocks answering the offer, nothing else.
  if (
    found.pendingAssigneeUserId === actor.userId &&
    found.assigneeUserId !== actor.userId &&
    actor.role === 'member' &&
    !HANDOFF_ANSWERS.has(action)
  ) {
    throw new HttpError(403, 'รับงานที่ส่งต่อมาก่อน จึงจะแก้ไขงานนี้ได้');
  }

  // Likewise, asking for work does not make it yours to do. The creator
  // gets อนุมัติ and ขอแก้ไข, not the worker's status buttons — otherwise a
  // manager could quietly mark a task accepted on someone else's behalf.
  if (
    found.createdByUserId === actor.userId &&
    found.assigneeUserId !== actor.userId &&
    actor.role === 'member' &&
    !REVIEW_ACTIONS.has(action)
  ) {
    throw new HttpError(403, 'งานนี้อยู่กับผู้รับผิดชอบ · คุณตรวจหรือขอแก้ไขได้');
  }

  // Approving your own submission would make review meaningless, so the
  // person who asked for the work signs it off, not the person who did it.
  // This is enforced here rather than in the UI, which is where the
  // prototype's approval had no check at all.
  if (REVIEW_ACTIONS.has(action)) {
    const mayReview =
      actor.role === 'owner' ||
      actor.role === 'admin' ||
      found.createdByUserId === actor.userId;
    if (!mayReview) {
      throw new HttpError(403, 'ตรวจงานได้เฉพาะผู้สั่งงานหรือผู้ดูแลพื้นที่งาน');
    }

    // Having review rights in the workspace is not the same as having them
    // over your own work. An owner who does a task still cannot sign it off
    // when somebody else asked for it — otherwise every approval on the
    // record could have been self-issued, and none of them prove anything.
    //
    // A task someone created for themselves is the exception: nobody else
    // is waiting on it, and blocking it would leave a solo workspace with
    // no way to ever close anything.
    const askedBySomeoneElse =
      !!found.createdByUserId && found.createdByUserId !== found.assigneeUserId;
    if (
      action === 'approve' &&
      found.assigneeUserId === actor.userId &&
      askedBySomeoneElse
    ) {
      throw new HttpError(403, 'ปิดงานของตัวเองไม่ได้ · ให้ผู้สั่งงานหรือผู้ดูแลเป็นคนอนุมัติ');
    }
  }

  // ขอข้อมูล and ติดปัญหา carry a short note saying what is needed. Without
  // it the team view can only say someone is stuck, not what would unstick
  // them.
  // ติดปัญหา takes a preset reason so it is countable and sortable. Free
  // text stays optional: forcing prose is how a required field turns into
  // "-" and stops meaning anything.
  const note = text(input.note).trim().slice(0, 300);
  const reason = text(input.reason).trim();
  let linkWarning: string | null = null;
  // Recorded on the event, so "handed in with no proof" is visible in the
  // history rather than inferred from a missing field.
  let submittedWithoutEvidence = false;
  if (action === 'blocked') {
    if (!isBlockedReason(reason)) {
      throw new HttpError(400, `เลือกเหตุผล: ${BLOCKED_REASONS.join(' / ')}`);
    }
  }
  if (action === 'info' && !note) {
    throw new HttpError(400, 'บอกสั้น ๆ ว่าต้องการข้อมูลอะไร');
  }

  // The same tap arriving twice, seconds apart, is ordinary on a phone with
  // a slow connection. The second one is not a new decision.
  const ALREADY: Partial<Record<keyof typeof TRANSITIONS, () => boolean>> = {
    accept: () => !!found.acceptedAt && found.status === 'progress',
    submit: () => found.status === 'review',
    approve: () => found.status === 'done',
  };
  if (ALREADY[action]?.()) {
    return { ok: true as const, alreadyApplied: true, warning: null, eventId: null, visibility: null, audienceNote: null };
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (move.status) patch.status = move.status;
  if (move.reviewState) patch.reviewState = move.reviewState;
  if (action === 'accept' && !found.acceptedAt) patch.acceptedAt = new Date();
  if (action === 'handoff') {
    const to = text(input.assigneeUserId) || null;
    if (!to) throw new HttpError(400, 'ต้องระบุผู้รับงานต่อ');
    if (to === found.assigneeUserId) {
      throw new HttpError(400, 'งานนี้อยู่กับผู้รับคนนี้แล้ว');
    }
    // Offered, not moved. The task stays with the sender until the receiver
    // accepts, so work cannot fall into the gap between two people who each
    // think the other has it.
    patch.pendingAssigneeUserId = to;
    patch.handoffOfferedAt = new Date();
  }

  if (action === 'accept_handoff') {
    if (!found.pendingAssigneeUserId) {
      throw new HttpError(400, 'ไม่มีงานที่ส่งต่อมารอรับ');
    }
    if (found.pendingAssigneeUserId !== actor.userId) {
      throw new HttpError(403, 'งานนี้ส่งต่อให้คนอื่น');
    }
    patch.assigneeUserId = found.pendingAssigneeUserId;
    if (!found.primaryAssigneeUserId) patch.primaryAssigneeUserId = found.assigneeUserId;
    patch.pendingAssigneeUserId = null;
    patch.handoffOfferedAt = null;
    patch.acceptedAt = new Date();
  }

  if (action === 'decline_handoff') {
    if (found.pendingAssigneeUserId !== actor.userId) {
      throw new HttpError(403, 'งานนี้ส่งต่อให้คนอื่น');
    }
    // Back to the sender, visibly, rather than vanishing.
    patch.pendingAssigneeUserId = null;
    patch.handoffOfferedAt = null;
  }

  if (action === 'revision') {
    // Reopening on the old deadline means the task is born overdue, which
    // makes every "เกินกำหนด" number in the product untrustworthy.
    if (!note) {
      throw new HttpError(400, 'บอกด้วยว่าต้องแก้อะไร');
    }
    const newDue = text(input.dueAt) ? new Date(text(input.dueAt)) : null;
    if (!newDue || !Number.isFinite(newDue.getTime())) {
      throw new HttpError(400, 'ตั้งกำหนดส่งใหม่ด้วย ไม่งั้นงานจะเกิดมาพร้อมสถานะเลยกำหนด');
    }
    if (newDue.getTime() <= Date.now()) {
      throw new HttpError(400, 'กำหนดส่งใหม่ต้องเป็นเวลาในอนาคต');
    }
    patch.dueAt = newDue;
  }

  if (action === 'blocked') patch.blockedReason = reason;
  else if (move.status && move.status !== 'blocked') patch.blockedReason = null;
  if (move.status && move.status !== found.status) patch.statusChangedAt = new Date();
  if (action === 'submit') {
    const evidenceUrl = text(input.evidenceUrl) || found.evidenceUrl;
    if (!evidenceUrl) {
      // Proof is the point of the review step, so the ask comes first. But a
      // refusal with no way to answer it would make the LINE button a dead
      // end, and a worker who has genuinely finished should not be stuck. So
      // handing in without a link stays possible when explicitly chosen, and
      // is recorded as such — the reviewer sees the gap instead of a
      // submission that looks complete.
      if (!input.allowWithoutEvidence) {
        throw new HttpError(400, 'เพิ่มลิงก์หลักฐานก่อนส่งตรวจ');
      }
      submittedWithoutEvidence = true;
    }
    if (evidenceUrl) {
      if (!isSafeHttpUrl(evidenceUrl)) {
        throw new HttpError(400, 'ใส่ลิงก์ http:// หรือ https:// ที่ถูกต้อง');
      }
      patch.evidenceUrl = evidenceUrl;
      // Checked now, while the submitter is still there, rather than when the
      // reviewer is already blocked by it.
      linkWarning = (await checkEvidenceLink(evidenceUrl)).warning;
    }
    patch.submittedAt = new Date();
    // Resolve who has to sign this off once, now, and store it. Re-deriving
    // the rule at nudge time would chase whoever happens to be owner then,
    // which is not who the worker submitted to.
    patch.reviewerUserId = await resolveReviewer(found.workspaceId, found.createdByUserId, found.assigneeUserId);
  }

  if (action === 'approve') patch.closedAt = new Date();
  if (action === 'revision') {
    // Back to the worker: it is no longer waiting on a reviewer, so the
    // reviewer's nudge must not survive.
    patch.submittedAt = null;
    patch.closedAt = null;
  }

  // Snapshot only the fields this action touches, so undo restores exactly
  // what changed and leaves anything edited since alone.
  const previousState: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (key === 'updatedAt') continue;
    previousState[key] = (found as unknown as Record<string, unknown>)[key] ?? null;
  }

  // Two taps of the same button must produce one result.
  //
  // The write applies only if the task is still in the state we read a few
  // lines above, so of two simultaneous taps the second finds nothing to
  // update and stops here rather than writing a second identical event.
  // Without it a double tap left the task in the right state but the
  // history saying it was approved twice, by the same person, at the same
  // instant — and that history is the whole point of the approval step.
  //
  // The guard is the state, not updatedAt: Postgres keeps microseconds and
  // a JS Date only milliseconds, so comparing the timestamp we read back
  // never matches and every write would be refused.
  const applied = await db()
    .update(task)
    .set(patch)
    .where(
      and(
        eq(task.id, taskId),
        eq(task.status, found.status),
        eq(task.reviewState, found.reviewState),
        found.pendingAssigneeUserId
          ? eq(task.pendingAssigneeUserId, found.pendingAssigneeUserId)
          : isNull(task.pendingAssigneeUserId),
      ),
    )
    .returning({ id: task.id });
  if (!applied.length) {
    return { ok: true as const, alreadyApplied: true, warning: linkWarning, eventId: null, visibility: null, audienceNote: null };
  }

  // Handing over moves the reminders too. Leaving them behind would keep
  // nagging someone who is no longer responsible, which is the fastest way
  // to teach a team to ignore the bot.
  if (action === 'accept_handoff' && found.assigneeUserId) {
    await db()
      .delete(reminder)
      .where(
        and(
          eq(reminder.taskId, taskId),
          eq(reminder.recipientUserId, found.assigneeUserId),
          eq(reminder.state, 'pending'),
        ),
      );
  }

  // Closing a task cancels anything still queued for it.
  if (action === 'approve') {
    await db()
      .delete(reminder)
      .where(and(eq(reminder.taskId, taskId), eq(reminder.state, 'pending')));
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

  // ติดปัญหา and ขอข้อมูลเพิ่ม are private unless the worker says otherwise.
  // People report a problem honestly only when the report is not broadcast,
  // and the default is what almost everyone will use.
  //
  // Only the person writing the note may widen it. A manager quietly making
  // someone's private note workspace-visible would be worse than not having
  // the setting at all.
  const requested = normalizeVisibility(input.visibility, defaultVisibilityFor(move.kind));
  const visibility =
    defaultVisibilityFor(move.kind) === 'private' && requested === 'client'
      ? // A blocked reason is internal. Marking one client-visible is almost
        // always a mistake, and an expensive one.
        'workspace'
      : requested;

  const eventId = crypto.randomUUID();
  await db().insert(taskEvent).values({
    id: eventId,
    taskId,
    workspaceId: found.workspaceId,
    actorUserId: actor.userId,
    previousState,
    visibility,
    kind: move.kind,
    // Handing over records both people, so the history answers "who had
    // this and when" without guessing.
    detail:
      action === 'handoff'
        ? `เสนอส่งต่อจาก ${nameOf(found.assigneeUserId)} ให้ ${nameOf(patch.pendingAssigneeUserId as string)} · รอผู้รับกดรับ`
        : action === 'blocked'
          ? `ติดปัญหา: ${reason}${note ? ` · ${note}` : ''}`
          // Handed in with nothing to look at. Said plainly, so the reviewer
          // sees the gap rather than a submission that appears complete.
          : submittedWithoutEvidence
            ? 'ส่งงาน · ไม่ได้แนบลิงก์หลักฐาน'
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
      taskId,
      messages: [{
        type: 'text',
        text:
          (waiting.length > 1 ? `มีงานส่งต่อรอคุณรับ ${waiting.length} งาน` : 'มีงานส่งต่อถึงคุณ') +
          `\n${waiting.map((w) => `• ${w.title}`).join('\n')}` +
          `\n\nกดรับหรือปฏิเสธในแอป: ${waiting.length > 1 ? appLink() : appLink({ task: taskId })}`,
      }],
    }).catch((error) => console.error('[handoff] notify failed', error));
  }

  // Acting on a task is evidence of when this person is at work.
  await noteActivity(found.workspaceId, actor.userId);

  // The answer to "who should be reminded, and when" just changed.
  await planRemindersForTask(taskId);

  // The id the client needs to offer undo on this exact change, and who
  // can read the note — shown on the note itself, so nobody has to guess.
  return {
    ok: true as const,
    alreadyApplied: false,
    warning: linkWarning,
    eventId,
    visibility,
    audienceNote: audienceLabel(visibility),
  };}

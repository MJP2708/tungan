import 'server-only';
import { and, eq, lte, sql, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { reminder, task, lineUser, workspace } from '../db/schema.ts';
import { pushToUser, usedThisMonth, billingMonth } from '../line/messaging.ts';
import { formatDeadline } from '../deadline.ts';

/** How long a runner owns the rows it claimed. */
const LEASE_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const BATCH = 50;

export type DispatchResult = {
  claimed: number;
  recipients: number;
  sent: number;
  failed: number;
  skippedOverCap: number;
  notFriend: number;
};

/**
 * Claim due reminders with a lease.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes two overlapping cron runs safe: the
 * second run skips rows the first is holding rather than waiting for them or,
 * worse, sending them again. The lease covers the case where a runner dies
 * mid-batch — the rows become claimable again once it expires, instead of
 * being stuck pending forever.
 */
async function claimDue(now: Date) {
  const leaseUntil = new Date(now.getTime() + LEASE_MINUTES * 60000);
  const rows = await db().execute(sql`
    update ${reminder}
       set claimed_until = ${leaseUntil}, attempts = attempts + 1
     where id in (
       select id from ${reminder}
        where state = 'pending'
          and send_at <= ${now}
          and attempts < ${MAX_ATTEMPTS}
          and (claimed_until is null or claimed_until < ${now})
        order by send_at
        limit ${BATCH}
        for update skip locked
     )
    returning id, workspace_id, task_id, recipient_user_id, send_at, attempts
  `);
  return (rows as unknown as { rows: Array<{
    id: string; workspace_id: string; task_id: string | null;
    recipient_user_id: string; send_at: string; attempts: number;
  }> }).rows ?? [];
}

/**
 * Send everything that is due.
 *
 * Reminders are grouped into one message per person — the daily digest the
 * cost model requires. Push is billed per recipient, so ten reminders for one
 * person must cost one message, not ten. A group is never a recipient.
 */
export async function dispatchDueReminders(
  options: { now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<DispatchResult> {
  const now = options.now ?? new Date();
  const claimed = await claimDue(now);
  const result: DispatchResult = {
    claimed: claimed.length,
    recipients: 0,
    sent: 0,
    failed: 0,
    skippedOverCap: 0,
    notFriend: 0,
  };
  if (!claimed.length) return result;

  // How close the workspace is to its cap decides whether the message says
  // anything about being trimmed. Sending less without saying so is a bug
  // from the reader's side: they conclude the bot forgot.
  const capNotices = new Map<string, string>();
  for (const workspaceId of new Set(claimed.map((c) => c.workspace_id))) {
    const [ws] = await db()
      .select({ cap: workspace.monthlyMessageCap })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);
    const cap = ws?.cap ?? 300;
    const used = await usedThisMonth(workspaceId);
    if (used >= cap) {
      capNotices.set(workspaceId, 'ใช้โควตาข้อความเดือนนี้ครบแล้ว จึงยังส่งไม่ได้');
    } else if (cap - used <= Math.max(10, Math.ceil(cap * 0.1))) {
      capNotices.set(
        workspaceId,
        `เหลือโควตาข้อความเดือนนี้ ${cap - used} ข้อความ · รวมการเตือนเป็นฉบับเดียวเพื่อประหยัด`,
      );
    }
  }

  // One message per person per workspace.
  const groups = new Map<string, typeof claimed>();
  for (const row of claimed) {
    const key = `${row.workspace_id}::${row.recipient_user_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  result.recipients = groups.size;

  const titles = await titlesFor(claimed.map((c) => c.task_id).filter(Boolean) as string[]);

  for (const [key, rows] of groups) {
    const [workspaceId, recipientUserId] = key.split('::');
    const ids = rows.map((r) => r.id);

    const lines = rows.map((r) => {
      const t = r.task_id ? titles.get(r.task_id) : null;
      const when = t?.dueAt ? ` · ${formatDeadline(t.dueAt, { now })}` : '';
      return `• ${t?.title ?? 'งานที่ต้องทำ'}${when}`;
    });
    const notice = capNotices.get(workspaceId);
    const text =
      (rows.length === 1
        ? `เตือนงาน\n${lines[0]}`
        : `เตือนงาน ${rows.length} รายการ\n${lines.join('\n')}`) +
      // Say it in the message itself. A quieter bot with no explanation reads
      // as a broken bot.
      (notice ? `\n\n(${notice})` : '');

    const outcome = await pushToUser(
      { workspaceId, recipientUserId, messages: [{ type: 'text', text }], taskId: rows[0].task_id ?? undefined },
      { fetchImpl: options.fetchImpl, now },
    );

    if (outcome.ok) {
      result.sent += 1;
      await db()
        .update(reminder)
        .set({ state: 'sent', sentAt: now, claimedUntil: null, failureReason: null })
        .where(inArray(reminder.id, ids));
      continue;
    }

    // Every failure is stored and stays visible. A reminder that could not be
    // delivered must never look the same as one that was.
    const reason =
      outcome.reason === 'not_friend'
        ? 'ยังไม่ได้แอดบอทเป็นเพื่อน จึงส่งข้อความไม่ได้'
        : outcome.reason === 'over_cap'
          ? 'ใช้โควตาข้อความของเดือนนี้ครบแล้ว'
          : `ส่งไม่สำเร็จ${outcome.status ? ` (${outcome.status})` : ''}`;

    if (outcome.reason === 'not_friend') result.notFriend += 1;
    else if (outcome.reason === 'over_cap') result.skippedOverCap += 1;
    else result.failed += 1;

    const permanent = outcome.reason === 'not_friend' || outcome.reason === 'over_cap';
    await db()
      .update(reminder)
      .set({
        // Retrying a non-friend or an exhausted quota just burns attempts, so
        // those stop here and surface instead.
        state: permanent ? 'failed' : 'pending',
        failureReason: reason,
        // Exponential backoff, released from the lease so a later run can pick
        // it up rather than holding it.
        claimedUntil: permanent
          ? null
          : new Date(now.getTime() + Math.min(60, 2 ** rows[0].attempts) * 60000),
      })
      .where(inArray(reminder.id, ids));
  }

  return result;
}

async function titlesFor(taskIds: string[]) {
  const map = new Map<string, { title: string; dueAt: Date | null }>();
  if (!taskIds.length) return map;
  const rows = await db()
    .select({ id: task.id, title: task.title, dueAt: task.dueAt })
    .from(task)
    .where(inArray(task.id, taskIds));
  for (const r of rows) map.set(r.id, { title: r.title, dueAt: r.dueAt });
  return map;
}

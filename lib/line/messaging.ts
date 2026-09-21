import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { messageUsage, lineUser } from '../db/schema.ts';
import { zonedDateParts } from '../deadline.ts';

const REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';
const PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

/** YYYY-MM in Asia/Bangkok, so a monthly cap matches the user's calendar. */
export function billingMonth(now: Date = new Date()): string {
  const p = zonedDateParts(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

function accessToken() {
  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not configured');
  return token;
}

/**
 * Reply to a webhook event.
 *
 * Reply messages are NOT counted against the plan quota, so every group-facing
 * confirmation should come through here rather than as a push. The reply token
 * is single-use and short-lived, so this is only usable while handling the
 * event that produced it.
 */
export async function replyMessage(
  replyToken: string,
  messages: Array<Record<string, unknown>>,
  options: { workspaceId?: string; fetchImpl?: typeof fetch } = {},
): Promise<{ ok: boolean; status: number }> {
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(REPLY_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken()}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (options.workspaceId) {
    // Recorded with recipientCount 0: replies cost nothing against quota, but
    // we still want them in the ledger to explain traffic.
    await db().insert(messageUsage).values({
      id: crypto.randomUUID(),
      workspaceId: options.workspaceId,
      channel: 'reply',
      recipientCount: 0,
      billingMonth: billingMonth(),
    });
  }
  return { ok: res.ok, status: res.status };
}

export type PushOutcome =
  | { ok: true; counted: number }
  | { ok: false; reason: 'not_friend' | 'over_cap' | 'line_error'; counted: 0; status?: number };

/**
 * Push a DM to ONE person.
 *
 * Push is billed per recipient, so this takes a single user by design: a
 * helper that accepted a group would make a ten-person group cost ten
 * messages behind one innocuous-looking call.
 */
export async function pushToUser(
  params: {
    workspaceId: string;
    recipientUserId: string;
    messages: Array<Record<string, unknown>>;
    taskId?: string;
  },
  options: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<PushOutcome> {
  const now = options.now ?? new Date();
  const month = billingMonth(now);

  const rows = await db()
    .select({ lineUserId: lineUser.lineUserId, isOaFriend: lineUser.isOaFriend })
    .from(lineUser)
    .where(eq(lineUser.id, params.recipientUserId))
    .limit(1);
  const recipient = rows[0];
  if (!recipient) return { ok: false, reason: 'line_error', counted: 0 };

  // A member only receives DMs if they added the OA as a friend. Surface it
  // as a stored failure so the UI can warn, instead of dropping it silently.
  if (!recipient.isOaFriend) return { ok: false, reason: 'not_friend', counted: 0 };

  if (await isOverCap(params.workspaceId, month)) {
    return { ok: false, reason: 'over_cap', counted: 0 };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(PUSH_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken()}`,
    },
    body: JSON.stringify({ to: recipient.lineUserId, messages: params.messages }),
  });

  if (!res.ok) return { ok: false, reason: 'line_error', counted: 0, status: res.status };

  await db().insert(messageUsage).values({
    id: crypto.randomUUID(),
    workspaceId: params.workspaceId,
    channel: 'push',
    recipientCount: 1,
    billingMonth: month,
    taskId: params.taskId,
  });
  return { ok: true, counted: 1 };
}

/**
 * Ask LINE whether this user can receive a DM from the OA.
 *
 * 200 means they have added the OA and a push will be delivered; 404 means
 * they have not, or have blocked it. This is the authoritative answer, unlike
 * a follow event that can be missed.
 */
export async function isFriendOfOa(
  lineUserId: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<boolean | null> {
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const res = await doFetch(
      `https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`,
      { headers: { authorization: `Bearer ${accessToken()}` } },
    );
    if (res.ok) return true;
    // 404 is LINE's answer for "not a friend, or blocked". Anything else
    // (429, 5xx) is not an answer about this person at all.
    return res.status === 404 ? false : null;
  } catch {
    // A network failure is not proof of anything: null means "leave the flag
    // as it was". Returning false here used to mark a reachable person
    // unreachable, and their reminders then stopped.
    return null;
  }
}

export type LineProfile = { displayName: string; pictureUrl: string | null };

async function getJson<T>(url: string, fetchImpl?: typeof fetch): Promise<T | null> {
  try {
    const res = await (fetchImpl ?? fetch)(url, {
      headers: { authorization: `Bearer ${accessToken()}` },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * A group member's name, as LINE shows it in that group.
 *
 * Works on every account type and without friendship, unlike the member-ID
 * list (Verified/Premium only). This is what gives people who have never
 * opened the app a real name in the assignee picker instead of a blank.
 */
export async function groupMemberProfile(
  groupOrRoomId: string,
  lineUserId: string,
  kind: 'group' | 'room' = 'group',
  options: { fetchImpl?: typeof fetch } = {},
): Promise<LineProfile | null> {
  const body = await getJson<{ displayName?: string; pictureUrl?: string }>(
    `https://api.line.me/v2/bot/${kind}/${encodeURIComponent(groupOrRoomId)}/member/${encodeURIComponent(lineUserId)}`,
    options.fetchImpl,
  );
  return body?.displayName ? { displayName: body.displayName, pictureUrl: body.pictureUrl ?? null } : null;
}

/** A friend's profile, for someone who messaged the OA directly. */
export async function userProfile(
  lineUserId: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<LineProfile | null> {
  const body = await getJson<{ displayName?: string; pictureUrl?: string }>(
    `https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`,
    options.fetchImpl,
  );
  return body?.displayName ? { displayName: body.displayName, pictureUrl: body.pictureUrl ?? null } : null;
}

/** A group's own name, so the app can tell two groups apart. */
export async function groupName(
  groupId: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<string | null> {
  const body = await getJson<{ groupName?: string }>(
    `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/summary`,
    options.fetchImpl,
  );
  return body?.groupName || null;
}

/** Counted messages used this month, by recipient count rather than calls. */
export async function usedThisMonth(workspaceId: string, month = billingMonth()) {
  const rows = await db()
    .select({ total: sql<number>`coalesce(sum(${messageUsage.recipientCount}), 0)` })
    .from(messageUsage)
    .where(
      and(
        eq(messageUsage.workspaceId, workspaceId),
        eq(messageUsage.billingMonth, month),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

async function isOverCap(workspaceId: string, month: string) {
  const { workspace } = await import('../db/schema.ts');
  const rows = await db()
    .select({ cap: workspace.monthlyMessageCap })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const cap = rows[0]?.cap ?? 300;
  return (await usedThisMonth(workspaceId, month)) >= cap;
}

import { NextRequest, NextResponse, after } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import {
  lineEvent,
  inboxItem,
  lineUser,
  lineGroup,
  groupWorkspace,
  lineGroupMember,
  workspace,
  workspaceMember,
  task,
  taskEvent,
} from '@/lib/db/schema.ts';
import { verifyLineSignature } from '@/lib/line/verify.ts';
import { extractDraft, shouldProcessGroupMessage } from '@/lib/line/extract.ts';
import { fromZonedWallClock } from '@/lib/deadline.ts';
import { isHelpRequest, helpMessage } from '@/lib/line/help.ts';
import { confirmMessage, confirmBody, assigneePicker } from '@/lib/line/confirm-message.ts';
import { replyMessage, isFriendOfOa } from '@/lib/line/messaging.ts';

// Signature verification needs node crypto's timingSafeEqual.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LineSource = {
  type?: 'user' | 'group' | 'room';
  userId?: string;
  groupId?: string;
  roomId?: string;
};

type LineEventPayload = {
  type: string;
  webhookEventId?: string;
  deliveryContext?: { isRedelivery?: boolean };
  replyToken?: string;
  timestamp?: number;
  source?: LineSource;
  message?: { id?: string; type?: string; text?: string };
  unsend?: { messageId?: string };
  postback?: { data?: string; params?: { datetime?: string; date?: string; time?: string } };
  joined?: { members?: Array<{ userId?: string }> };
  left?: { members?: Array<{ userId?: string }> };
};

/** The id of whatever the event came from, whichever kind it is. */
function sourceIdOf(source: LineSource | undefined) {
  return source?.groupId ?? source?.roomId ?? source?.userId ?? null;
}

export async function POST(req: NextRequest) {
  // The signature covers the exact bytes LINE sent. Read the raw body FIRST:
  // parsing and re-serialising would not reproduce them, and verifying after
  // parsing means acting on unverified input.
  const raw = await req.text();
  const signature = req.headers.get('x-line-signature');

  if (!verifyLineSignature(raw, signature)) {
    // Logged on its own channel: a rejected signature is a possible attack,
    // not a bug in our processing, and the two must be told apart.
    console.warn(
      '[webhook][signature-rejected]',
      JSON.stringify({
        hasSignature: Boolean(signature),
        bytes: raw.length,
        ua: req.headers.get('user-agent') ?? '',
      }),
    );
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let body: { events?: LineEventPayload[] };
  try {
    body = JSON.parse(raw);
  } catch {
    console.error('[webhook][processing-error] body was not JSON');
    // Still a 200: LINE retries non-2xx, and retrying will not fix bad JSON.
    return NextResponse.json({ ok: true });
  }

  const events = body.events ?? [];

  // Work that must outlive the response.
  //
  // The previous version used a bare `void promise` guarded by a
  // `globalThis.waitUntil` check that only exists on Cloudflare Workers. On
  // Vercel the function is frozen the moment the response is returned, so the
  // work was cut off mid-way: the event row landed and the follow-up write
  // silently did not. `after()` is the supported way to keep it alive.
  after(async () => {
    for (const event of events) {
      try {
        await handleEvent(event);
      } catch (error) {
        console.error(
          '[webhook][processing-error]',
          event.type,
          (error as Error).message,
        );
        if (event.webhookEventId) {
          await db()
            .update(lineEvent)
            .set({ processingError: String((error as Error).message).slice(0, 500) })
            .where(eq(lineEvent.webhookEventId, event.webhookEventId))
            .catch(() => {});
        }
      }
    }
  });

  // Always 200 once the signature is good. A non-200 makes LINE retry, and
  // retries are how duplicate tasks appear.
  return NextResponse.json({ ok: true });
}

async function handleEvent(event: LineEventPayload) {
  const source = event.source;
  const eventId = event.webhookEventId;

  // Dedup on the event id. The primary key enforces it, so a concurrent retry
  // loses the insert race rather than creating a second task.
  if (eventId) {
    try {
      await db().insert(lineEvent).values({
        webhookEventId: eventId,
        type: event.type,
        sourceType: source?.type ?? null,
        sourceId: sourceIdOf(source),
        senderUserId: source?.userId ?? null,
        isRedelivery: Boolean(event.deliveryContext?.isRedelivery),
        payload: event as unknown as Record<string, unknown>,
      });
    } catch {
      // Already seen: a duplicate is a no-op, never a second task.
      return;
    }
  }

  switch (event.type) {
    case 'message':
      await handleMessage(event);
      break;
    case 'unsend':
      await handleUnsend(event);
      break;
    case 'follow':
      await syncFriendship(source?.userId);
      break;
    case 'unfollow':
      await setFriendship(source?.userId, false);
      break;
    case 'join':
      await handleJoin(event);
      break;
    case 'leave':
      await handleLeave(event);
      break;
    case 'memberJoined':
      await handleMemberJoined(event);
      break;
    case 'memberLeft':
      // Members are kept, not deleted: their name still has to render on the
      // tasks they were assigned.
      break;
    case 'postback':
      await handlePostback(event);
      break;
    default:
      break;
  }

  if (eventId) {
    await db()
      .update(lineEvent)
      .set({ processedAt: new Date() })
      .where(eq(lineEvent.webhookEventId, eventId));
  }
}

/**
 * Ask LINE whether this person can actually receive a DM, rather than
 * inferring it from having caught a follow event.
 *
 * Relying on the event alone is fragile: miss it once — a webhook registered
 * at the wrong path, a truncated run — and the flag stays wrong forever, so
 * the UI either warns about someone who is reachable or, worse, stays quiet
 * about someone who is not.
 */
async function syncFriendship(lineUserId: string | undefined) {
  if (!lineUserId) return;
  const friend = await isFriendOfOa(lineUserId);
  await setFriendship(lineUserId, friend);
}

async function setFriendship(lineUserId: string | undefined, isFriend: boolean) {
  if (!lineUserId) return;
  await db()
    .update(lineUser)
    .set({ isOaFriend: isFriend, updatedAt: new Date() })
    .where(eq(lineUser.lineUserId, lineUserId));
}

/** The bot was added to a group: record it so it can be bound to a workspace. */
async function handleJoin(event: LineEventPayload) {
  const groupId = event.source?.groupId ?? event.source?.roomId;
  if (!groupId) return;
  await ensureGroupKnown(groupId);
}

/** Returns our internal id for a LINE group, creating the row if needed. */
async function ensureGroupKnown(lineGroupId: string): Promise<string> {
  const existing = await db()
    .select({ id: lineGroup.id })
    .from(lineGroup)
    .where(eq(lineGroup.lineGroupId, lineGroupId))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const id = crypto.randomUUID();
  await db()
    .insert(lineGroup)
    .values({ id, lineGroupId, name: '' })
    .onConflictDoNothing();
  const row = await db()
    .select({ id: lineGroup.id })
    .from(lineGroup)
    .where(eq(lineGroup.lineGroupId, lineGroupId))
    .limit(1);
  return row[0]?.id ?? id;
}

/** Record that we have seen this person in this group. */
async function noteGroupMember(lineGroupId: string, lineUserId: string) {
  const groupRowId = await ensureGroupKnown(lineGroupId);
  const userRowId = await ensureUserKnown(lineUserId);
  await db()
    .insert(lineGroupMember)
    .values({ lineGroupId: groupRowId, userId: userRowId })
    .onConflictDoUpdate({
      target: [lineGroupMember.lineGroupId, lineGroupMember.userId],
      set: { lastSeenAt: new Date() },
    });
}

async function handleLeave(event: LineEventPayload) {
  const groupId = event.source?.groupId ?? event.source?.roomId;
  if (!groupId) return;
  // The binding goes, the group row stays so history still resolves.
  const rows = await db()
    .select({ id: lineGroup.id })
    .from(lineGroup)
    .where(eq(lineGroup.lineGroupId, groupId))
    .limit(1);
  if (rows[0]) {
    await db().delete(groupWorkspace).where(eq(groupWorkspace.lineGroupId, rows[0].id));
  }
}

/**
 * Someone joined the group. Without a Verified or Premium account the full
 * member list is not available, so events like this are how the member list
 * gets built at all.
 */
async function handleMemberJoined(event: LineEventPayload) {
  const groupId = event.source?.groupId ?? event.source?.roomId;
  const members = event.joined?.members ?? [];
  if (!groupId || !members.length) return;
  for (const member of members) {
    if (member.userId) await noteGroupMember(groupId, member.userId);
  }
}

/** Record a LINE user we have seen, so the assignee picker can offer them. */
async function ensureUserKnown(lineUserId: string) {
  const existing = await db()
    .select({ id: lineUser.id })
    .from(lineUser)
    .where(eq(lineUser.lineUserId, lineUserId))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const id = crypto.randomUUID();
  await db()
    .insert(lineUser)
    .values({ id, lineUserId, displayName: '', isOaFriend: false })
    .onConflictDoNothing();
  return id;
}

/**
 * Someone tapped a button on the confirmation.
 *
 * Two taps must produce one task. The guard is the inbox row's own state: the
 * update to 'created' is conditional on it still being 'pending', so the
 * second tap changes nothing and reports the existing task instead. The
 * webhookEventId dedup upstream covers LINE retrying the same tap; this covers
 * a person tapping twice, which is a different thing.
 */
async function handlePostback(event: LineEventPayload) {
  const params = new URLSearchParams(event.postback?.data ?? '');
  const action = params.get('action');
  const inboxId = params.get('inbox');
  if (!action || !inboxId) return;

  const rows = await db().select().from(inboxItem).where(eq(inboxItem.id, inboxId)).limit(1);
  const item = rows[0];
  if (!item) return;

  // The tapper must be a member of the workspace the draft belongs to.
  const actorLineUserId = event.source?.userId;
  let actorUserId: string | null = null;
  if (actorLineUserId) {
    const who = await db()
      .select({ userId: workspaceMember.userId })
      .from(lineUser)
      .innerJoin(workspaceMember, eq(workspaceMember.userId, lineUser.id))
      .where(eq(lineUser.lineUserId, actorLineUserId))
      .limit(1);
    actorUserId = who[0]?.userId ?? null;
  }

  // Editing the draft in place. Each of these is idempotent: they set a value
  // rather than accumulating one, so two taps land on the same result.
  if (action === 'setdue') {
    if (item.state !== 'pending') return;
    const picked = event.postback?.params?.datetime;
    if (!picked) return;
    // LINE returns local wall clock; store the instant it means in Bangkok.
    const [datePart, timePart] = picked.split('T');
    const [y, mo, d] = datePart.split('-').map(Number);
    const [h, mi] = (timePart ?? '00:00').split(':').map(Number);
    const at = fromZonedWallClock(y, mo, d, h, mi);
    await db().update(inboxItem).set({ suggestedDueAt: at, confidence: 'explicit' })
      .where(and(eq(inboxItem.id, inboxId), eq(inboxItem.state, 'pending')));
    await replyDraft(event, inboxId, 'แก้กำหนดส่งแล้ว');
    return;
  }

  if (action === 'pickassignee') {
    if (item.state !== 'pending') return;
    const members = await knownMembers(item.workspaceId);
    if (event.replyToken) {
      await replyMessage(
        event.replyToken,
        [assigneePicker(inboxId, members, (process.env.APP_BASE_URL ?? '').replace(/\/$/, ''))],
        { workspaceId: item.workspaceId },
      ).catch(() => {});
    }
    return;
  }

  if (action === 'setassignee') {
    if (item.state !== 'pending') return;
    const userId = params.get('user');
    if (!userId) return;
    await db().update(inboxItem).set({ suggestedAssigneeUserId: userId })
      .where(and(eq(inboxItem.id, inboxId), eq(inboxItem.state, 'pending')));
    await replyDraft(event, inboxId, 'เปลี่ยนผู้รับผิดชอบแล้ว');
    return;
  }

  if (action === 'dismiss') {
    await db()
      .update(inboxItem)
      .set({ state: 'dismissed', rawMessage: null })
      .where(and(eq(inboxItem.id, inboxId), eq(inboxItem.state, 'pending')));
    if (event.replyToken) {
      await replyMessage(event.replyToken, [{ type: 'text', text: 'ปิดข้อความนี้แล้ว ไม่ได้สร้างงาน' }],
        { workspaceId: item.workspaceId }).catch(() => {});
    }
    return;
  }

  if (action !== 'confirm') return;

  if (item.state !== 'pending') {
    if (event.replyToken) {
      await replyMessage(event.replyToken, [{ type: 'text', text: 'ข้อความนี้ถูกยืนยันไปแล้ว ไม่ได้สร้างงานซ้ำ' }],
        { workspaceId: item.workspaceId }).catch(() => {});
    }
    return;
  }

  // Claim the draft first. Only the tap that flips pending -> created goes on
  // to insert a task, so a double tap cannot produce two.
  const claimed = await db()
    .update(inboxItem)
    .set({ state: 'created', rawMessage: null })
    .where(and(eq(inboxItem.id, inboxId), eq(inboxItem.state, 'pending')))
    .returning({ id: inboxItem.id });
  if (!claimed.length) return;

  const taskId = crypto.randomUUID();
  await db().insert(task).values({
    id: taskId,
    workspaceId: item.workspaceId,
    title: item.suggestedTitle || 'งานจาก LINE',
    note: '',
    assigneeUserId: item.suggestedAssigneeUserId,
    primaryAssigneeUserId: item.suggestedAssigneeUserId,
    source: item.lineGroupId ? 'LINE · กลุ่ม' : 'LINE · DM',
    dueAt: item.suggestedDueAt,
    createdByUserId: actorUserId,
  });
  await db().insert(taskEvent).values({
    id: crypto.randomUUID(),
    taskId,
    workspaceId: item.workspaceId,
    actorUserId,
    kind: 'created',
    detail: 'ยืนยันจากข้อความใน LINE',
  });

  if (event.replyToken) {
    await replyMessage(
      event.replyToken,
      [{
        type: 'text',
        text: `สร้างงานแล้ว: ${item.suggestedTitle}${
          item.suggestedDueAt ? `\nกำหนดส่ง ${formatForReply(item.suggestedDueAt)}` : ''
        }`,
      }],
      { workspaceId: item.workspaceId },
    ).catch(() => {});
  }
}

/** On unsend, the stored raw message must go. */
async function handleUnsend(event: LineEventPayload) {
  const messageId = event.unsend?.messageId;
  if (!messageId) return;
  await db()
    .update(inboxItem)
    .set({ rawMessage: null })
    .where(eq(inboxItem.lineMessageId, messageId));
}

async function handleMessage(event: LineEventPayload) {
  if (event.message?.type !== 'text') return;
  const text = event.message.text ?? '';
  const isGroup = event.source?.type === 'group' || event.source?.type === 'room';

  const groupId = event.source?.groupId ?? event.source?.roomId;
  if (event.source?.userId) {
    if (isGroup && groupId) {
      // Speaking is how most members become known, since the member-list
      // endpoint needs a Verified or Premium account.
      await noteGroupMember(groupId, event.source.userId);
    } else {
      await ensureUserKnown(event.source.userId);
      // A person who can message the OA in a 1:1 chat has added it, so this
      // is a second, cheaper chance to get the flag right.
      await setFriendship(event.source.userId, true);
    }
  }

  // Default is mention-only in groups. No auto-scan.
  if (isGroup && !shouldProcessGroupMessage(text)) return;

  const resolved = await resolveWorkspace(event);

  // "How do I use this?" is answered with the reply token, so it costs
  // nothing against the quota however often it is asked. Answered even when
  // the group is not connected yet — that is exactly when someone needs it.
  if (event.replyToken && isHelpRequest(text, /@ทันงาน|@tungan/i.test(text))) {
    await replyMessage(
      event.replyToken,
      [{
        type: 'text',
        text: helpMessage({
          isGroup,
          bound: Boolean(resolved),
          appUrl: (process.env.APP_BASE_URL ?? '').replace(/\/$/, ''),
        }),
      }],
      { workspaceId: resolved?.workspaceId },
    ).catch((error) => console.error('[webhook][processing-error] help reply failed', error));
    return;
  }
  if (!resolved) {
    console.warn('[webhook] message from an unbound source', event.source?.type);
    return;
  }

  const draft = extractDraft(text, {
    members: resolved.members,
    senderUserId: resolved.senderUserId,
    cutoff: resolved.cutoff,
    isGroup,
  });

  const draftId = crypto.randomUUID();
  await db()
    .insert(inboxItem)
    .values({
      id: draftId,
      workspaceId: resolved.workspaceId,
      lineGroupId: sourceIdOf(event.source),
      senderLineUserId: event.source?.userId ?? null,
      senderName: resolved.senderName,
      rawMessage: text,
      lineMessageId: event.message.id ?? null,
      suggestedTitle: draft.title,
      suggestedAssigneeUserId: draft.assigneeUserId,
      suggestedDueAt: draft.dueAt,
      confidence: draft.confidence,
      replyToken: event.replyToken ?? null,
      state: 'pending',
    })
    .onConflictDoNothing();

  // Confirmations go back as a REPLY, which is not counted against the plan
  // quota. A push here would be billed per recipient.
  //
  // The card shows what was read next to the words it was read from, and the
  // two things most often wrong are correctable without leaving the chat.
  if (event.replyToken) {
    const assigneeName = draft.assigneeUserId
      ? (resolved.members.find((m) => m.userId === draft.assigneeUserId)?.names[0] ?? null)
      : null;
    await replyMessage(
      event.replyToken,
      [
        confirmMessage({
          id: draftId,
          title: draft.title,
          dueAt: draft.dueAt,
          dueSource: draft.dueSource,
          assigneeName,
          assigneeSource: draft.assigneeSource,
        }),
      ],
      { workspaceId: resolved.workspaceId },
    ).catch((error) => console.error('[webhook][processing-error] reply failed', error));
  }
}

/** People we know in this workspace, for the assignee picker. */
async function knownMembers(workspaceId: string) {
  const rows = await db()
    .select({
      userId: lineUser.id,
      displayName: lineUser.displayName,
      nickname: workspaceMember.nickname,
    })
    .from(workspaceMember)
    .innerJoin(lineUser, eq(lineUser.id, workspaceMember.userId))
    .where(eq(workspaceMember.workspaceId, workspaceId));
  return rows.map((r) => ({ userId: r.userId, name: r.nickname || r.displayName || 'ไม่ทราบชื่อ' }));
}

/** Re-show the card after an edit, so the person sees the corrected reading. */
async function replyDraft(event: LineEventPayload, inboxId: string, notice: string) {
  if (!event.replyToken) return;
  const rows = await db().select().from(inboxItem).where(eq(inboxItem.id, inboxId)).limit(1);
  const item = rows[0];
  if (!item) return;
  const members = await knownMembers(item.workspaceId);
  const assigneeName =
    members.find((m) => m.userId === item.suggestedAssigneeUserId)?.name ?? null;
  await replyMessage(
    event.replyToken,
    [
      confirmMessage({
        id: inboxId,
        title: `${notice} · ${item.suggestedTitle}`,
        dueAt: item.suggestedDueAt,
        // The reading now came from a picker, not from the text.
        dueSource: null,
        assigneeName,
        assigneeSource: null,
      }),
    ],
    { workspaceId: item.workspaceId },
  ).catch(() => {});
}

function formatForReply(at: Date) {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

async function resolveWorkspace(event: LineEventPayload) {
  const groupId = event.source?.groupId ?? event.source?.roomId;
  const senderLineUserId = event.source?.userId;

  let workspaceId: string | null = null;
  let cutoff = '17:00';

  if (groupId) {
    const rows = await db()
      .select({ workspaceId: groupWorkspace.workspaceId, cutoff: workspace.cutoff })
      .from(lineGroup)
      .innerJoin(groupWorkspace, eq(groupWorkspace.lineGroupId, lineGroup.id))
      .innerJoin(workspace, eq(workspace.id, groupWorkspace.workspaceId))
      .where(eq(lineGroup.lineGroupId, groupId))
      .limit(1);
    if (rows[0]) {
      workspaceId = rows[0].workspaceId;
      cutoff = rows[0].cutoff;
    }
  } else if (senderLineUserId) {
    // DM fallback: required, not optional, because a group that already has
    // another OA cannot add ทันงาน at all.
    const rows = await db()
      .select({ workspaceId: workspaceMember.workspaceId, cutoff: workspace.cutoff })
      .from(lineUser)
      .innerJoin(workspaceMember, eq(workspaceMember.userId, lineUser.id))
      .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
      .where(eq(lineUser.lineUserId, senderLineUserId))
      .limit(1);
    if (rows[0]) {
      workspaceId = rows[0].workspaceId;
      cutoff = rows[0].cutoff;
    }
  }

  if (!workspaceId) return null;

  const members = await db()
    .select({
      userId: lineUser.id,
      lineUserId: lineUser.lineUserId,
      displayName: lineUser.displayName,
      nickname: workspaceMember.nickname,
    })
    .from(workspaceMember)
    .innerJoin(lineUser, eq(lineUser.id, workspaceMember.userId))
    .where(eq(workspaceMember.workspaceId, workspaceId));

  const sender = members.find((m) => m.lineUserId === senderLineUserId);

  return {
    workspaceId,
    cutoff,
    senderUserId: sender?.userId,
    senderName: sender?.nickname || sender?.displayName || '',
    members: members.map((m) => ({
      userId: m.userId,
      names: [m.nickname, m.displayName].filter(Boolean),
    })),
  };
}

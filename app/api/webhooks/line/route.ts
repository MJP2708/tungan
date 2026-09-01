import { NextRequest, NextResponse, after } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import {
  lineEvent,
  inboxItem,
  lineUser,
  lineGroup,
  groupWorkspace,
  workspace,
  workspaceMember,
} from '@/lib/db/schema.ts';
import { verifyLineSignature } from '@/lib/line/verify.ts';
import { extractDraft, shouldProcessGroupMessage } from '@/lib/line/extract.ts';
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
  postback?: { data?: string };
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
  await db()
    .insert(lineGroup)
    .values({ id: crypto.randomUUID(), lineGroupId: groupId, name: '' })
    .onConflictDoNothing();
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
  await db()
    .insert(lineGroup)
    .values({ id: crypto.randomUUID(), lineGroupId: groupId, name: '' })
    .onConflictDoNothing();
  for (const member of members) {
    if (member.userId) await ensureUserKnown(member.userId);
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

async function handlePostback(event: LineEventPayload) {
  // Confirmation postbacks are Task 3. Stored here so the event is not lost
  // in the meantime.
  return;
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

  if (event.source?.userId) {
    await ensureUserKnown(event.source.userId);
    // A person who can message the OA in a 1:1 chat has added it, so this is
    // a second, cheaper chance to get the flag right.
    if (!isGroup) await setFriendship(event.source.userId, true);
  }

  // Default is mention-only in groups. No auto-scan.
  if (isGroup && !shouldProcessGroupMessage(text)) return;

  const resolved = await resolveWorkspace(event);
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

  await db()
    .insert(inboxItem)
    .values({
      id: crypto.randomUUID(),
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
  if (event.replyToken) {
    await replyMessage(
      event.replyToken,
      [
        {
          type: 'text',
          text: draft.dueAt
            ? `รับเรื่องแล้ว: ${draft.title}\nกำหนดส่งที่อ่านได้: ${formatForReply(draft.dueAt)}\nเปิดแอปเพื่อยืนยันก่อนสร้างงาน`
            : `รับเรื่องแล้ว: ${draft.title}\nยังไม่ระบุกำหนดส่ง เปิดแอปเพื่อยืนยันก่อนสร้างงาน`,
        },
      ],
      { workspaceId: resolved.workspaceId },
    ).catch((error) => console.error('[webhook][processing-error] reply failed', error));
  }
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

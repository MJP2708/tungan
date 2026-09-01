import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { lineEvent, inboxItem, lineUser, lineGroup, groupWorkspace, workspace, workspaceMember } from '@/lib/db/schema.ts';
import { verifyLineSignature } from '@/lib/line/verify.ts';
import { extractDraft, shouldProcessGroupMessage } from '@/lib/line/extract.ts';
import { replyMessage } from '@/lib/line/messaging.ts';

// Signature verification needs node crypto's timingSafeEqual.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LineEvent = {
  type: string;
  webhookEventId?: string;
  deliveryContext?: { isRedelivery?: boolean };
  replyToken?: string;
  timestamp?: number;
  source?: { type?: string; userId?: string; groupId?: string };
  message?: { id?: string; type?: string; text?: string };
  unsend?: { messageId?: string };
};

export async function POST(req: NextRequest) {
  // The signature covers the exact bytes LINE sent. Read the raw body FIRST:
  // parsing and re-serialising would not reproduce them, and verifying after
  // parsing means acting on unverified input.
  const raw = await req.text();
  const signature = req.headers.get('x-line-signature');

  if (!verifyLineSignature(raw, signature)) {
    // Log nothing from the body: it can contain a customer's message.
    console.warn('[webhook] rejected: bad or missing signature');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let body: { events?: LineEvent[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const events = body.events ?? [];

  // Acknowledge fast. LINE retries slow endpoints, and a retry that races the
  // first attempt is exactly how duplicate tasks appear. Work continues after
  // the response is handed back.
  const work = Promise.allSettled(events.map((event) => handleEvent(event)));

  // Next keeps the function alive for this; we do not await it before replying.
  if (typeof (globalThis as { waitUntil?: unknown }).waitUntil === 'function') {
    (globalThis as unknown as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(work);
  } else {
    void work.catch((error) => console.error('[webhook] work failed', error));
  }

  return NextResponse.json({ ok: true });
}

async function handleEvent(event: LineEvent) {
  // Dedup on the event id. The unique primary key is what enforces it, so a
  // concurrent retry loses the insert race rather than creating a second task.
  const eventId = event.webhookEventId;
  if (eventId) {
    try {
      await db().insert(lineEvent).values({
        webhookEventId: eventId,
        type: event.type,
        isRedelivery: Boolean(event.deliveryContext?.isRedelivery),
        payload: event as unknown as Record<string, unknown>,
      });
    } catch {
      // Already seen. A duplicate is a no-op, never a second task.
      return;
    }
  }

  switch (event.type) {
    case 'message':
      return handleMessage(event);
    case 'unsend':
      return handleUnsend(event);
    case 'follow':
      return setFriendship(event.source?.userId, true);
    case 'unfollow':
      return setFriendship(event.source?.userId, false);
    default:
      return;
  }
}

/** A member only receives DMs once they have added the OA as a friend. */
async function setFriendship(lineUserId: string | undefined, isFriend: boolean) {
  if (!lineUserId) return;
  await db()
    .update(lineUser)
    .set({ isOaFriend: isFriend, updatedAt: new Date() })
    .where(eq(lineUser.lineUserId, lineUserId));
}

/** On unsend, the stored raw message must go. */
async function handleUnsend(event: LineEvent) {
  const messageId = event.unsend?.messageId;
  if (!messageId) return;
  await db()
    .update(inboxItem)
    .set({ rawMessage: null })
    .where(eq(inboxItem.lineMessageId, messageId));
}

async function handleMessage(event: LineEvent) {
  if (event.message?.type !== 'text') return;
  const text = event.message.text ?? '';
  const isGroup = event.source?.type === 'group';

  // Default is mention-only in groups. No auto-scan.
  if (isGroup && !shouldProcessGroupMessage(text)) return;

  const resolved = await resolveWorkspace(event);
  if (!resolved) return;

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
      lineGroupId: event.source?.groupId ?? null,
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

  // Confirmations go back to the group as a REPLY, which is not counted
  // against the plan quota. A push here would be billed per recipient.
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
    ).catch((error) => console.error('[webhook] reply failed', error));
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

/**
 * Find the workspace this message belongs to, plus the members we actually
 * know about.
 *
 * The group member list API needs a Verified or Premium account, so until then
 * we only know members who have produced a webhook event. The picker degrades
 * to those rather than appearing broken.
 */
async function resolveWorkspace(event: LineEvent) {
  const groupId = event.source?.groupId;
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

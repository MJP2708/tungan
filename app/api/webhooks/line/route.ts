import { NextRequest, NextResponse, after } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
  nameCorrection,
} from '@/lib/db/schema.ts';
import { verifyLineSignature } from '@/lib/line/verify.ts';
import { extractDraft, mayStoreEventPayload, shouldProcessGroupMessage, splitInstructions } from '@/lib/line/extract.ts';
import { fromZonedWallClock } from '@/lib/deadline.ts';
import { isHelpRequest, helpMessage, joinMessage } from '@/lib/line/help.ts';
import { confirmMessage, assigneePicker } from '@/lib/line/confirm-message.ts';
import {
  replyMessage,
  isFriendOfOa,
  groupMemberProfile,
  groupName,
  userProfile,
} from '@/lib/line/messaging.ts';
import { applyTransition, isTransition, type TransitionAction } from '@/lib/tasks/transitions.ts';
import { HttpError } from '@/lib/auth/session.ts';
import { undoTaskEvent } from '@/lib/tasks/undo.ts';
import {
  statusActions, withActions, reasonPrompt, handoffPicker, evidencePrompt, undoAction,
} from '@/lib/line/status-buttons.ts';
import { appLink } from '@/lib/deep-link.ts';
import { isAssignable } from '@/lib/auth/assignable.ts';
import { applyMentions, mentionedPeople, type Mentionee } from '@/lib/line/mentions.ts';

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
  message?: {
    id?: string;
    type?: string;
    text?: string;
    quotedMessageId?: string;
    mention?: { mentionees?: Mentionee[] };
  };
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
        // The dedup row always; the text only when the message was for us.
        payload: mayStoreEventPayload(event)
          ? (event as unknown as Record<string, unknown>)
          : null,
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
  // null = LINE did not answer about this person; keep what we had.
  if (friend === null) return;
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
  // Say what the bot reads, keeps and deletes, before anyone has to ask.
  if (event.replyToken) {
    const base = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '');
    await replyMessage(
      event.replyToken,
      [{ type: 'text', text: joinMessage({ appUrl: appLink(), privacyUrl: `${base}/privacy` }) }],
      {},
    ).catch((error) => console.error('[webhook][processing-error] join reply failed', error));
  }
}

/**
 * Returns our internal id for a LINE group, creating the row if needed.
 *
 * Also gives it its real name. Groups were stored nameless, so every group in
 * the app read "กลุ่ม LINE" and someone in two groups could not tell which one
 * they were connecting.
 */
async function ensureGroupKnown(lineGroupId: string): Promise<string> {
  const existing = await db()
    .select({ id: lineGroup.id, name: lineGroup.name })
    .from(lineGroup)
    .where(eq(lineGroup.lineGroupId, lineGroupId))
    .limit(1);
  if (existing[0]) {
    if (!existing[0].name) await fillGroupName(existing[0].id, lineGroupId);
    return existing[0].id;
  }
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
  await fillGroupName(row[0].id, lineGroupId);
  return row[0].id;
}

async function fillGroupName(rowId: string, lineGroupId: string) {
  // Rooms (multi-person chats) have no summary endpoint and no name.
  if (!lineGroupId.startsWith('C')) return;
  const name = await groupName(lineGroupId);
  if (name) await db().update(lineGroup).set({ name }).where(eq(lineGroup.id, rowId));
}

async function noteGroupMember(lineGroupId: string, lineUserId: string): Promise<string> {
  const groupRowId = await ensureGroupKnown(lineGroupId);
  const userRowId = await ensureUserKnown(lineUserId, { groupOrRoomId: lineGroupId });
  await db()
    .insert(lineGroupMember)
    .values({ lineGroupId: groupRowId, userId: userRowId })
    .onConflictDoUpdate({
      target: [lineGroupMember.lineGroupId, lineGroupMember.userId],
      set: { lastSeenAt: new Date() },
    });
  return userRowId;
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
/**
 * Our id for a LINE user, creating the row if needed, with a real name.
 *
 * People seen only in a group used to be stored with an empty name, so the
 * assignee picker listed every one of them as "สมาชิกในกลุ่ม". The group
 * member profile works on every account type and without friendship; in a
 * 1:1 chat the person is a friend, so their own profile works.
 */
async function ensureUserKnown(
  lineUserId: string,
  where: { groupOrRoomId?: string } = {},
): Promise<string> {
  const existing = await db()
    .select({ id: lineUser.id, displayName: lineUser.displayName })
    .from(lineUser)
    .where(eq(lineUser.lineUserId, lineUserId))
    .limit(1);
  if (existing[0]) {
    if (!existing[0].displayName) await fillUserName(existing[0].id, lineUserId, where);
    return existing[0].id;
  }
  await db()
    .insert(lineUser)
    .values({ id: crypto.randomUUID(), lineUserId, displayName: '', isOaFriend: false })
    .onConflictDoNothing();
  // Read back rather than trust our own id: two events for a new person can
  // race, and the loser's id never made it into the table.
  const row = await db()
    .select({ id: lineUser.id })
    .from(lineUser)
    .where(eq(lineUser.lineUserId, lineUserId))
    .limit(1);
  await fillUserName(row[0].id, lineUserId, where);
  return row[0].id;
}

async function fillUserName(rowId: string, lineUserId: string, where: { groupOrRoomId?: string }) {
  const id = where.groupOrRoomId;
  const profile = id
    ? await groupMemberProfile(id, lineUserId, id.startsWith('R') ? 'room' : 'group')
    : await userProfile(lineUserId);
  if (!profile) return;
  await db()
    .update(lineUser)
    .set({ displayName: profile.displayName, pictureUrl: profile.pictureUrl, updatedAt: new Date() })
    .where(eq(lineUser.id, rowId));
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
/** How long a freshly created task can be taken back from the chat. */
const UNDO_WINDOW_MS = 30_000;

async function handleUndo(event: LineEventPayload, params: URLSearchParams) {
    // A short window to take it back, which is what people actually want
  // straight after a mistap. Past that, it is an ordinary task and gets
  // deleted through the app where the permission rules live.
  const taskId = params.get('task');
  if (!taskId) return;
  const rows = await db().select().from(task).where(eq(task.id, taskId)).limit(1);
  const t = rows[0];
  if (!t) return;
  // Anyone in the group sees this button. Only the person who confirmed the
  // task — or a workspace owner/admin — may take it back; it used to delete
  // for whoever tapped.
  const actorUserId = await actorFor(event);
  const role = actorUserId ? await roleIn(t.workspaceId, actorUserId) : null;
  const mayUndo =
    !!actorUserId && (t.createdByUserId === actorUserId || role === 'owner' || role === 'admin');
  if (!mayUndo) {
    if (event.replyToken) {
      await replyMessage(event.replyToken,
        [{ type: 'text', text: 'ยกเลิกได้เฉพาะคนที่ยืนยันงานนี้' }],
        { workspaceId: t.workspaceId }).catch(() => {});
    }
    return;
  }
  const withinWindow = Date.now() - t.createdAt.getTime() <= UNDO_WINDOW_MS;
  if (!withinWindow) {
    if (event.replyToken) {
      await replyMessage(event.replyToken,
        [{ type: 'text', text: 'เลยเวลายกเลิกแล้ว ลบงานนี้ได้ในแอป' }],
        { workspaceId: t.workspaceId }).catch(() => {});
    }
    return;
  }
  await db().delete(task).where(eq(task.id, taskId));
  if (event.replyToken) {
    await replyMessage(event.replyToken,
      [{ type: 'text', text: 'ยกเลิกงานแล้ว' }],
      { workspaceId: t.workspaceId }).catch(() => {});
  }
  return;
}

/** Resolve the tapper to one of our users. Identity is the LINE user id. */
async function actorFor(event: LineEventPayload): Promise<string | null> {
  const lineUserId = event.source?.userId;
  if (!lineUserId) return null;
  const rows = await db()
    .select({ id: lineUser.id })
    .from(lineUser)
    .where(eq(lineUser.lineUserId, lineUserId))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function roleIn(workspaceId: string, userId: string): Promise<string | null> {
  const rows = await db()
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
    .limit(1);
  return rows[0]?.role ?? null;
}

async function replyTo(event: LineEventPayload, workspaceId: string, messages: unknown[]) {
  if (!event.replyToken) return;
  // The reply token is free; a push would be billed per recipient. Every
  // status change handled inside LINE has to stay on this path.
  await replyMessage(event.replyToken, messages as never, { workspaceId }).catch(() => {});
}

/**
 * The five worker actions, tapped inside LINE.
 *
 * Runs the same lib/tasks/transitions.ts the app does, so the permission rules
 * cannot differ between the two surfaces. Every answer uses the reply token,
 * so a worker can handle a whole day from chat without spending a message.
 */
async function handleStatusPostback(event: LineEventPayload, params: URLSearchParams) {
  const taskId = params.get('task');
  const doing = params.get('do');
  if (!taskId || !doing) return;

  const rows = await db().select().from(task).where(eq(task.id, taskId)).limit(1);
  const found = rows[0];
  if (!found) return;

  const actorUserId = await actorFor(event);
  if (!actorUserId) {
    await replyTo(event, found.workspaceId, [{
      type: 'text',
      text: 'ยังไม่รู้จักบัญชีนี้ · เข้าสู่ระบบในแอปหนึ่งครั้งก่อน',
    }]);
    return;
  }

  // Opens this task in LIFF, already signed in.
  const appUrl = appLink({ task: taskId });

  // Two of the five ask what is wanted before they do anything. Presets, so
  // the answer is still one tap.
  if ((doing === 'info' || doing === 'blocked') && !params.get('reason')) {
    await replyTo(event, found.workspaceId, [reasonPrompt(taskId, doing)]);
    return;
  }
  if (doing === 'handoff' && !params.get('user')) {
    await replyTo(event, found.workspaceId, [
      handoffPicker(taskId, await knownMembers(found.workspaceId), appUrl),
    ]);
    return;
  }
  // Ask for proof before accepting a submission without it, rather than
  // refusing with no way to answer from inside chat.
  if (doing === 'submit' && !found.evidenceUrl && !params.get('nolink')) {
    await replyTo(event, found.workspaceId, [evidencePrompt(taskId, appUrl)]);
    return;
  }

  if (!isTransition(doing)) return;
  const reason = params.get('reason') ?? undefined;

  try {
    const result = await applyTransition({
      taskId,
      action: doing as TransitionAction,
      actorUserId,
      input: {
        reason,
        // ขอข้อมูลเพิ่ม stores its preset as the note; ติดปัญหา keeps reason
        // and note apart so blocked work stays countable by cause.
        note: doing === 'info' ? reason : undefined,
        assigneeUserId: params.get('user') ?? undefined,
        allowWithoutEvidence: params.get('nolink') === '1',
      },
    });

    // A second tap of the same button lands here. Saying so is better than
    // repeating the success line, which reads as having done it twice.
    if (result.alreadyApplied) {
      await replyTo(event, found.workspaceId, [{ type: 'text', text: 'ทำรายการนี้ไปแล้ว' }]);
      return;
    }

    const after = await db().select().from(task).where(eq(task.id, taskId)).limit(1);
    const now = after[0] ?? found;
    const said = STATUS_REPLY[doing] ?? 'อัปเดตแล้ว';
    const line = `${said}: ${found.title}`;
    const audience = result.audienceNote ? `\n(${result.audienceNote})` : '';

    await replyTo(event, found.workspaceId, [
      withActions(
        line + audience,
        result.eventId ? [undoAction(taskId, result.eventId)] : statusActions(now, actorUserId),
      ),
    ]);
  } catch (error) {
    const text = error instanceof HttpError ? error.message : 'ทำรายการไม่สำเร็จ';
    await replyTo(event, found.workspaceId, [{ type: 'text', text }]);
  }
}

/** What each action says once it has happened. Never implies more than it did. */
const STATUS_REPLY: Record<string, string> = {
  accept: 'รับงานแล้ว',
  info: 'บันทึกว่าขอข้อมูลเพิ่มแล้ว',
  blocked: 'บันทึกว่าติดปัญหาแล้ว',
  handoff: 'เสนอส่งต่อแล้ว · รอผู้รับกดรับ',
  accept_handoff: 'รับงานที่ส่งต่อมาแล้ว',
  decline_handoff: 'ส่งกลับให้คนเดิมแล้ว',
  // Not "เสร็จแล้ว". The task is not over until somebody signs it off, and
  // wording that says otherwise is what made the approval step decorative.
  submit: 'ส่งตรวจแล้ว · สถานะตอนนี้คือรอตรวจ',
};

/** Take back a status change, within the same 30 seconds the app allows. */
async function handleStatusUndo(event: LineEventPayload, params: URLSearchParams) {
  const taskId = params.get('task');
  const eventId = params.get('event');
  if (!taskId || !eventId) return;
  const rows = await db().select().from(task).where(eq(task.id, taskId)).limit(1);
  const found = rows[0];
  if (!found) return;
  const actorUserId = await actorFor(event);
  if (!actorUserId) return;

  try {
    const res = await undoTaskEvent({ taskId, eventId, actorUserId });
    await replyTo(event, found.workspaceId, [{
      type: 'text',
      text: res.alreadyUndone ? 'ยกเลิกไปแล้ว' : `ยกเลิกแล้ว: ${found.title}`,
    }]);
  } catch (error) {
    const text = error instanceof HttpError ? error.message : 'ยกเลิกไม่สำเร็จ';
    await replyTo(event, found.workspaceId, [{ type: 'text', text }]);
  }
}

async function handlePostback(event: LineEventPayload) {
  const params = new URLSearchParams(event.postback?.data ?? '');
  const action = params.get('action');
  // `undo` and `status` address a task, everything else addresses a draft.
  if (action === 'undo') return handleUndo(event, params);
  if (action === 'status') return handleStatusPostback(event, params);
  if (action === 'statusundo') return handleStatusUndo(event, params);
  const inboxId = params.get('inbox');
  if (!action || !inboxId) return;

  const rows = await db().select().from(inboxItem).where(eq(inboxItem.id, inboxId)).limit(1);
  const item = rows[0];
  if (!item) return;

  // The tapper must be someone in the workspace the draft belongs to: a
  // member, or a person seen in one of its bound groups. This used to look
  // them up in ANY workspace and never refused, so a confirm by a stranger
  // went through with no creator recorded.
  const tapper = await actorFor(event);
  const actorUserId = tapper && (await isAssignable(item.workspaceId, tapper)) ? tapper : null;
  if (!actorUserId) {
    if (event.replyToken) {
      await replyMessage(event.replyToken,
        [{ type: 'text', text: 'เฉพาะคนในทีมนี้ที่จัดการข้อความนี้ได้' }],
        { workspaceId: item.workspaceId }).catch(() => {});
    }
    return;
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
        [assigneePicker(inboxId, members, appLink())],
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

    // Remember the correction for this workspace, so the same phrase resolves
    // to the right person next time. Only the phrase the parser actually got
    // wrong is worth learning, and only here — never across workspaces.
    if (item.rawMessage && item.suggestedAssigneeUserId !== userId) {
      await rememberCorrection(item.workspaceId, item.rawMessage, userId);
    }
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
  try {
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
  } catch (error) {
    // Hand the draft back rather than leave it claimed with no task behind it.
    await db().update(inboxItem).set({ state: 'pending' }).where(eq(inboxItem.id, inboxId));
    throw error;
  }
  await db().insert(taskEvent).values({
    id: crypto.randomUUID(),
    taskId,
    workspaceId: item.workspaceId,
    actorUserId,
    kind: 'created',
    detail: 'ยืนยันจากข้อความใน LINE',
  });

  if (event.replyToken) {
    // The confirmation carries the five worker actions, so the person who has
    // to do the task can accept it, flag a problem or hand it in without ever
    // leaving the chat. All of them answer on the reply token, which is free.
    const fresh = {
      id: taskId,
      status: 'todo',
      acceptedAt: null,
      pendingAssigneeUserId: null,
    };
    const actions = statusActions(fresh, actorUserId ?? undefined);
    await replyMessage(
      event.replyToken,
      [withActions(
        `สร้างงานแล้ว: ${item.suggestedTitle}${
          item.suggestedDueAt ? `\nกำหนดส่ง ${formatForReply(item.suggestedDueAt)}` : ''
        }`,
        [
          ...actions,
          {
            type: 'action',
            action: {
              type: 'postback',
              label: 'ยกเลิกงานนี้',
              data: `action=undo&task=${taskId}`,
              displayText: 'ยกเลิกงานนี้',
            },
          },
        ],
      )],
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
  // The webhook event holds the same text verbatim. Clearing only the inbox
  // copy left it readable for up to seven more days after the person took
  // the message back.
  await db()
    .update(lineEvent)
    .set({ payload: null })
    .where(sql`${lineEvent.payload} -> 'message' ->> 'id' = ${messageId}`);
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
          appUrl: appLink(),
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

  // Replying to an earlier message and tagging the bot means "make THAT a
  // task". We can only honour it for messages we already hold: the no-auto-scan
  // rule means an ordinary chat message was never stored, and LINE sends only
  // the quoted id, never its text. Saying so is better than quietly making a
  // task out of the one-word reply.
  let sourceText = text;
  const quotedId = event.message?.quotedMessageId;
  if (quotedId) {
    const quoted = await db()
      .select({ rawMessage: inboxItem.rawMessage })
      .from(inboxItem)
      .where(eq(inboxItem.lineMessageId, quotedId))
      .limit(1);
    if (quoted[0]?.rawMessage) {
      sourceText = `${quoted[0].rawMessage} ${text.replace(/@ทันงาน|@tungan/gi, '')}`.trim();
    } else if (event.replyToken) {
      await replyMessage(
        event.replyToken,
        [{
          type: 'text',
          text: 'ผมไม่ได้เก็บข้อความที่คุณตอบกลับไว้ เพราะอ่านเฉพาะข้อความที่ติด @ทันงาน\nพิมพ์งานมาในข้อความนี้ได้เลย',
        }],
        { workspaceId: resolved.workspaceId },
      ).catch(() => {});
      return;
    }
  }

  // One message can contain more than one instruction.
  const instructions = splitInstructions(sourceText);
  const extracted = instructions.map((part) =>
    extractDraft(part, {
      members: resolved.members,
      senderUserId: resolved.senderUserId,
      cutoff: resolved.cutoff,
      isGroup,
    }),
  );
  // Exact @mentions beat name matching: LINE tells us who was tagged.
  const people: Array<{ userId: string; text: string }> = [];
  for (const m of mentionedPeople(text, event.message?.mention?.mentionees)) {
    // Being tagged in the group is proof they are in it, so record them as a
    // group member — which also makes them assignable here.
    const userId = isGroup && groupId
      ? (await noteGroupMember(groupId, m.lineUserId))
      : await ensureUserKnown(m.lineUserId);
    if (await isAssignable(resolved.workspaceId, userId)) people.push({ userId, text: m.text });
  }
  const drafts = applyMentions(extracted, people);

  const draftIds: string[] = [];
  for (const d of drafts) {
    const rowId = crypto.randomUUID();
    draftIds.push(rowId);
    await db()
      .insert(inboxItem)
      .values({
        id: rowId,
        workspaceId: resolved.workspaceId,
        lineGroupId: sourceIdOf(event.source),
        senderLineUserId: event.source?.userId ?? null,
        senderName: resolved.senderName,
        rawMessage: text,
        // Only the first row can carry the LINE message id: the column is
        // unique, which is what makes a redelivered message a no-op.
        lineMessageId: draftIds.length === 1 ? (event.message?.id ?? null) : null,
        suggestedTitle: d.title,
        suggestedAssigneeUserId: d.assigneeUserId,
        suggestedDueAt: d.dueAt,
        confidence: d.confidence,
        replyToken: event.replyToken ?? null,
        state: 'pending',
      })
      .onConflictDoNothing();
  }


  // Confirmations go back as a REPLY, which is not counted against the plan
  // quota. A push here would be billed per recipient.
  //
  // The card shows what was read next to the words it was read from, and the
  // two things most often wrong are correctable without leaving the chat.
  if (event.replyToken) {
    // Someone tagged for the first time was not in the member list built
    // above; look their name up so the card does not say "ยังไม่ระบุ".
    const extraIds = people.map((p) => p.userId).filter(
      (id) => !resolved.members.some((m) => m.userId === id),
    );
    const extraNames = extraIds.length
      ? await db()
          .select({ id: lineUser.id, name: lineUser.displayName })
          .from(lineUser)
          .where(inArray(lineUser.id, extraIds))
      : [];
    const nameOf = (userId: string | null) =>
      userId
        ? (resolved.members.find((m) => m.userId === userId)?.names[0] ??
          extraNames.find((n) => n.id === userId)?.name ??
          null)
        : null;
    // One reply call carries every card. A reply is free whatever it holds,
    // so two instructions cost the same as one.
    await replyMessage(
      event.replyToken,
      drafts.slice(0, 5).map((d, i) =>
        confirmMessage({
          id: draftIds[i],
          title: d.title,
          dueAt: d.dueAt,
          dueSource: d.dueSource,
          assigneeName: nameOf(d.assigneeUserId),
          assigneeSource: d.assigneeSource,
        }),
      ),
      { workspaceId: resolved.workspaceId },
    ).catch((error) => console.error('[webhook][processing-error] reply failed', error));
  }
}

/**
 * Learn that a phrase in this workspace means this person.
 *
 * Stores the @mention or bare name from the message rather than the whole
 * sentence, since that is the part that will recur.
 */
async function rememberCorrection(workspaceId: string, rawMessage: string, userId: string) {
  const candidates = [
    ...(rawMessage.match(/@[^\s@]{2,20}/g) ?? []),
  ].map((c) => c.replace(/^@/, '').toLowerCase()).filter((c) => !/ทันงาน|tungan/i.test(c));
  const phrase = candidates[0];
  if (!phrase) return;
  await db()
    .insert(nameCorrection)
    .values({ workspaceId, phrase, userId })
    .onConflictDoUpdate({
      target: [nameCorrection.workspaceId, nameCorrection.phrase],
      set: { userId, timesUsed: sql`${nameCorrection.timesUsed} + 1`, updatedAt: new Date() },
    });
}

/** Corrections this workspace has taught us, folded into the member list. */
async function learnedNames(workspaceId: string) {
  const rows = await db()
    .select({ phrase: nameCorrection.phrase, userId: nameCorrection.userId })
    .from(nameCorrection)
    .where(eq(nameCorrection.workspaceId, workspaceId));
  return rows;
}

/**
 * Everyone who can be given work here: members, plus people seen in the
 * workspace's bound groups who have not signed in yet.
 *
 * The app's picker already listed both; the LINE picker and @name matching
 * listed members only, so "@เมย์" found nobody until May had logged in.
 */
async function teamMembers(workspaceId: string) {
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
  const seen = await db()
    .selectDistinct({
      userId: lineUser.id,
      lineUserId: lineUser.lineUserId,
      displayName: lineUser.displayName,
    })
    .from(lineGroupMember)
    .innerJoin(groupWorkspace, eq(groupWorkspace.lineGroupId, lineGroupMember.lineGroupId))
    .innerJoin(lineUser, eq(lineUser.id, lineGroupMember.userId))
    .where(eq(groupWorkspace.workspaceId, workspaceId));
  const known = new Set(members.map((m) => m.userId));
  return [
    ...members,
    ...seen.filter((g) => !known.has(g.userId)).map((g) => ({ ...g, nickname: '' })),
  ];
}

/** People we know in this workspace, for the assignee picker. */
async function knownMembers(workspaceId: string) {
  const rows = await teamMembers(workspaceId);
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

  const members = await teamMembers(workspaceId);

  const sender = members.find((m) => m.lineUserId === senderLineUserId);

  // Fold in anything this workspace has corrected before, so a name the
  // parser once got wrong resolves on its own next time.
  const learned = await learnedNames(workspaceId);

  return {
    workspaceId,
    cutoff,
    senderUserId: sender?.userId,
    senderName: sender?.nickname || sender?.displayName || '',
    members: members.map((m) => ({
      userId: m.userId,
      names: [
        m.nickname,
        m.displayName,
        ...learned.filter((l) => l.userId === m.userId).map((l) => l.phrase),
      ].filter(Boolean),
    })),
  };
}

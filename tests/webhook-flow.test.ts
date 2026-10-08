// GATE 4: the product's core flow — a tagged message becomes a draft, a tap
// becomes a task, once.
//
// This is the path everything else exists to serve, and it had no test. The
// only time it ran against a real group it produced two drafts and zero
// tasks, which nothing would have caught.
//
// Real Postgres (the dedup indexes and conditional claims are the point),
// with LINE's API stubbed so nothing is sent. Skipped without
// TEST_DATABASE_URL; see tests/reminders-dispatch.test.ts for the setup.

import test, { before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL;
if (URL_) {
  process.env.DATABASE_URL = URL_;
  process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN ??= 'test-token';
  process.env.NEXT_PUBLIC_LIFF_ID ??= '1234567890-testliff';
  process.env.APP_BASE_URL ??= 'https://tungan.test';
}

describe('LINE flow: message to draft to task', { skip: !URL_ ? 'TEST_DATABASE_URL not set' : false }, () => {
  let db: typeof import('../lib/db/index.ts').db;
  let schema: typeof import('../lib/db/schema.ts');
  let handleEvent: typeof import('../lib/line/handle-event.ts').handleEvent;
  let eq: typeof import('drizzle-orm').eq;
  let and: typeof import('drizzle-orm').and;
  let pool: import('pg').Pool;

  const ws = 'ws-1';
  const groupRow = 'g-row-1';
  const LINE_GROUP = 'C0000000000000000000000000000001';
  const boss = { id: 'u-boss', lineUserId: 'U-boss' };
  const worker = { id: 'u-worker', lineUserId: 'U-worker' };

  /** Everything the bot tried to send, instead of sending it. */
  let sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const replies = () =>
    sent
      .filter((c) => c.url.includes('/message/reply'))
      .flatMap((c) => (c.body.messages as Array<Record<string, unknown>>) ?? []);
  const replyText = () =>
    replies()
      .map((m) => (typeof m.text === 'string' ? m.text : JSON.stringify(m)))
      .join('\n');

  let eventNo = 0;
  type Event = Parameters<typeof handleEvent>[0];
  const event = (extra: Record<string, unknown>) => ({
    webhookEventId: `evt-${(eventNo += 1)}`,
    replyToken: `reply-${eventNo}`,
    source: { type: 'group', groupId: LINE_GROUP, userId: boss.lineUserId },
    ...extra,
  }) as Event;
  const message = (text: string, id = `msg-${eventNo + 1}`) =>
    event({ type: 'message', message: { id, type: 'text', text } });

  before(async () => {
    schema = await import('../lib/db/schema.ts');
    ({ eq, and } = await import('drizzle-orm'));
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pg = (await import('pg')).default;
    const dbModule = await import('../lib/db/index.ts');
    db = dbModule.db;
    pool = new pg.Pool({ connectionString: URL_ });
    dbModule.__setDb(drizzle(pool, { schema }) as never);
    ({ handleEvent } = await import('../lib/line/handle-event.ts'));

    globalThis.fetch = (async (url: string, init?: { body?: string }) => {
      sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : {} });
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
  });

  beforeEach(async () => {
    sent = [];
    for (const t of [schema.announcementRead, schema.announcement, schema.messageUsage, schema.taskEvent, schema.reminder, schema.task,
      schema.inboxItem, schema.lineEvent, schema.groupWorkspace, schema.lineGroupMember,
      schema.lineGroup, schema.workspaceMember, schema.workspace, schema.lineUser]) {
      await db().delete(t);
    }
    await db().insert(schema.lineUser).values([
      { id: boss.id, lineUserId: boss.lineUserId, displayName: 'หัวหน้า', isOaFriend: true },
      { id: worker.id, lineUserId: worker.lineUserId, displayName: 'เมย์', isOaFriend: true },
    ]);
    await db().insert(schema.workspace).values({ id: ws, name: 'ทีมทดสอบ' });
    await db().insert(schema.workspaceMember).values([
      { workspaceId: ws, userId: boss.id, role: 'owner' },
      { workspaceId: ws, userId: worker.id, role: 'member' },
    ]);
    await db().insert(schema.lineGroup).values({ id: groupRow, lineGroupId: LINE_GROUP, name: 'กลุ่มทีม' });
    await db().insert(schema.groupWorkspace).values({ lineGroupId: groupRow, workspaceId: ws });
    await db().insert(schema.lineGroupMember).values([
      { lineGroupId: groupRow, userId: boss.id },
      { lineGroupId: groupRow, userId: worker.id },
    ]);
  });

  after(async () => {
    await pool.end();
  });

  test('joining a group says what the bot reads, on the free reply token', async () => {
    await handleEvent(event({ type: 'join' }));
    const text = replyText();
    assert.match(text, /@ทันงาน/);
    assert.match(text, /7 วัน/, 'says how long messages are kept');
    assert.match(text, /\/privacy/);
    assert.equal(sent.filter((c) => c.url.includes('/message/push')).length, 0, 'never a push');
  });

  test('a tagged message becomes one draft and a card, not a task', async () => {
    await handleEvent(message('@ทันงาน ส่งใบเสนอราคาให้ ABC พรุ่งนี้ 10 โมง'));

    const drafts = await db().select().from(schema.inboxItem);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].state, 'pending');
    assert.match(drafts[0].suggestedTitle, /ใบเสนอราคา/);
    assert.doesNotMatch(drafts[0].suggestedTitle, /@ทันงาน/, 'the mention is not the task name');
    assert.ok(drafts[0].suggestedDueAt, 'the deadline was read');
    assert.equal((await db().select().from(schema.task)).length, 0, 'nothing is created without a person');
    assert.ok(replies().length, 'the group gets a confirmation card');
  });

  test('a message that does not tag the bot is ignored, and its text is not kept', async () => {
    await handleEvent(message('ใครว่างช่วยดูงานนี้หน่อย'));

    assert.equal((await db().select().from(schema.inboxItem)).length, 0);
    assert.equal(replies().length, 0, 'the bot stays quiet');
    const [row] = await db().select().from(schema.lineEvent);
    assert.equal(row.payload, null, 'the dedup row is kept, the text is not');
  });

  test('confirming creates exactly one task, however many times it is tapped', async () => {
    await handleEvent(message('@ทันงาน @เมย์ เช็คของหน้าร้าน วันนี้'));
    const [draft] = await db().select().from(schema.inboxItem);

    await handleEvent(event({ type: 'postback', postback: { data: `action=confirm&inbox=${draft.id}` } }));
    await handleEvent(event({ type: 'postback', postback: { data: `action=confirm&inbox=${draft.id}` } }));

    const tasks = await db().select().from(schema.task);
    assert.equal(tasks.length, 1, 'two taps, one task');
    assert.equal(tasks[0].workspaceId, ws);
    assert.equal(tasks[0].createdByUserId, boss.id);
    const [after_] = await db().select().from(schema.inboxItem).where(eq(schema.inboxItem.id, draft.id));
    assert.equal(after_.state, 'created');
    assert.equal(after_.rawMessage, null, 'the original text goes once it is a task');
    assert.match(replyText(), /ยืนยันไปแล้ว/, 'the second tap says so');
  });

  test('a task confirmed in LINE has its reminder planned (it used to wait for the app)', async () => {
    await handleEvent(message('@ทันงาน @เมย์ ส่งใบเสนอราคา พรุ่งนี้ 16:00'));
    const [draft] = await db().select().from(schema.inboxItem);
    await handleEvent(event({ type: 'postback', postback: { data: `action=confirm&inbox=${draft.id}` } }));
    const [made] = await db().select().from(schema.task);
    assert.ok(made.dueAt, 'the deadline was read');
    const reminders = await db().select().from(schema.reminder).where(eq(schema.reminder.taskId, made.id));
    assert.ok(reminders.length >= 1, 'a reminder exists without anyone opening the app');
  });

  test('@All makes a ทุกคน draft, and confirming gives everyone their own copy', async () => {
    await db().insert(schema.lineUser).values({ id: 'u-third', lineUserId: 'U-third', displayName: 'นนท์', isOaFriend: true });
    await db().insert(schema.lineGroupMember).values({ lineGroupId: groupRow, userId: 'u-third' });
    const text = '@ทันงาน @All ส่ง timesheet พรุ่งนี้';
    await handleEvent(event({
      type: 'message',
      message: {
        id: 'msg-all', type: 'text', text,
        mention: { mentionees: [{ index: 0, length: 7, type: 'user', isSelf: true }, { index: 8, length: 4, type: 'all' }] },
      },
    }));
    const [draft] = await db().select().from(schema.inboxItem);
    assert.equal(draft.assignAll, true);
    assert.doesNotMatch(draft.suggestedTitle, /@all/i, '@All is not part of the task name');
    assert.match(replyText(), /ทุกคน/, 'the card says who it is for');

    sent = [];
    await handleEvent(event({ type: 'postback', postback: { data: `action=confirm&inbox=${draft.id}` } }));
    const tasks = await db().select().from(schema.task);
    // Everyone except the person confirming (the boss): เมย์ and นนท์.
    assert.deepEqual(tasks.map((t) => t.assigneeUserId).sort(), [worker.id, 'u-third'].sort());
    assert.ok(tasks[0].batchId && tasks.every((t) => t.batchId === tasks[0].batchId), 'linked as one batch');
    assert.match(replyText(), /สร้างงานให้ทุกคนแล้ว \(2 คน\)/);
  });

  /** Events from a group the test setup did NOT bind. */
  const NEW_GROUP = 'C0000000000000000000000000000new';
  const inNewGroup = (extra: Record<string, unknown>, userId = boss.lineUserId) =>
    event({ source: { type: 'group', groupId: NEW_GROUP, userId }, ...extra });
  const newGroupWorkspace = async () => {
    const [g] = await db().select().from(schema.lineGroup).where(eq(schema.lineGroup.lineGroupId, NEW_GROUP));
    if (!g) return null;
    const [b] = await db().select().from(schema.groupWorkspace).where(eq(schema.groupWorkspace.lineGroupId, g.id));
    return b?.workspaceId ?? null;
  };
  const roleIn = async (workspaceId: string, userId: string) =>
    (await db().select().from(schema.workspaceMember)
      .where(and(eq(schema.workspaceMember.workspaceId, workspaceId), eq(schema.workspaceMember.userId, userId))))[0]?.role ?? null;

  test('adding the bot to a group sets up its workspace, with nothing to press', async () => {
    await handleEvent(inNewGroup({ type: 'join' }));
    const workspaceId = await newGroupWorkspace();
    assert.ok(workspaceId, 'the group is linked the moment the bot joins');
    assert.match(replyText(), /พร้อมแล้ว/, 'the welcome says it is ready');
    assert.doesNotMatch(replyText(), /สร้างพื้นที่งานของกลุ่มนี้/, 'and does not send anyone to a button');
  });

  test('chatting lets you in; the first to tag @ทันงาน becomes owner; the next is a member', async () => {
    await handleEvent(inNewGroup({ type: 'join' }));
    const workspaceId = (await newGroupWorkspace())!;

    await handleEvent(inNewGroup({ type: 'message', message: { id: 'chat-1', type: 'text', text: 'สวัสดีทุกคน' } }, worker.lineUserId));
    assert.equal(await roleIn(workspaceId, worker.id), 'member', 'seen in the group → in the workspace');

    await handleEvent(inNewGroup({ type: 'message', message: { id: 'tag-1', type: 'text', text: '@ทันงาน ส่งรายงาน พรุ่งนี้' } }));
    assert.equal(await roleIn(workspaceId, boss.id), 'owner', 'the first to tag the bot owns it');

    await handleEvent(inNewGroup({ type: 'message', message: { id: 'tag-2', type: 'text', text: '@ทันงาน โทรหาลูกค้า พรุ่งนี้' } }, worker.lineUserId));
    assert.equal(await roleIn(workspaceId, worker.id), 'member', 'tagging later does not take it over');
  });

  test('a group the bot joined before this existed is set up at its next message', async () => {
    // A group row with no binding, as groups were before 2026-10-08.
    await db().insert(schema.lineGroup).values({ id: 'g-old', lineGroupId: NEW_GROUP, name: 'กลุ่มเก่า' });
    assert.equal(await newGroupWorkspace(), null);
    await handleEvent(inNewGroup({ type: 'message', message: { id: 'old-1', type: 'text', text: 'มีใครอยู่ไหม' } }));
    const workspaceId = await newGroupWorkspace();
    assert.ok(workspaceId);
    const [ws_] = await db().select().from(schema.workspace).where(eq(schema.workspace.id, workspaceId!));
    assert.equal(ws_.name, 'กลุ่มเก่า', 'named after the group');
  });

  test('the bot leaving and coming back keeps the same workspace', async () => {
    await handleEvent(inNewGroup({ type: 'join' }));
    const first = await newGroupWorkspace();
    await handleEvent(inNewGroup({ type: 'leave' }));
    await handleEvent(inNewGroup({ type: 'join' }));
    assert.equal(await newGroupWorkspace(), first, 'not a second, empty workspace');
  });

  test('the owner can announce from LINE; it is an announcement, not a task', async () => {
    await handleEvent(message('@ทันงาน ประกาศ: ประชุมย้ายเป็นศุกร์ 10:00\nห้องใหญ่ ชั้น 3'));
    const rows = await db().select().from(schema.announcement);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'ประชุมย้ายเป็นศุกร์ 10:00');
    assert.equal(rows[0].body, 'ห้องใหญ่ ชั้น 3');
    assert.equal(rows[0].authorUserId, boss.id);
    assert.equal((await db().select().from(schema.inboxItem)).length, 0, 'no task draft');
    assert.match(replyText(), /ประกาศแล้ว/);
    assert.equal(sent.filter((c) => c.url.includes('/message/push')).length, 0, 'nothing pushed to the group');
  });

  test('a member cannot announce from LINE', async () => {
    await handleEvent(event({
      type: 'message',
      source: { type: 'group', groupId: LINE_GROUP, userId: worker.lineUserId },
      message: { id: 'ann-member', type: 'text', text: '@ทันงาน ประกาศ: หยุดงานพรุ่งนี้' },
    }));
    assert.equal((await db().select().from(schema.announcement)).length, 0);
    assert.match(replyText(), /เฉพาะเจ้าของหรือผู้ดูแล/);
  });

  test('a task about announcing something is still a task', async () => {
    await handleEvent(message('@ทันงาน ประกาศผลสอบให้ทีม พรุ่งนี้'));
    assert.equal((await db().select().from(schema.announcement)).length, 0);
    assert.equal((await db().select().from(schema.inboxItem)).length, 1);
  });

  test('a stranger cannot confirm a draft', async () => {
    await handleEvent(message('@ทันงาน ส่งรายงาน วันนี้'));
    const [draft] = await db().select().from(schema.inboxItem);

    await handleEvent({
      webhookEventId: 'evt-stranger',
      replyToken: 'reply-stranger',
      type: 'postback',
      source: { type: 'group', groupId: LINE_GROUP, userId: 'U-nobody' },
      postback: { data: `action=confirm&inbox=${draft.id}` },
    });

    assert.equal((await db().select().from(schema.task)).length, 0);
    assert.match(replyText(), /เฉพาะคนในทีม/);
  });

  test('taking a message back in LINE removes what was stored', async () => {
    await handleEvent(message('@ทันงาน ส่งใบเสนอราคา วันนี้', 'msg-unsend'));
    const before_ = await db().select().from(schema.inboxItem);
    assert.ok(before_[0].rawMessage, 'stored while it was a pending draft');

    await handleEvent(event({ type: 'unsend', unsend: { messageId: 'msg-unsend' } }));

    const [row] = await db().select().from(schema.inboxItem);
    assert.equal(row.rawMessage, null);
    const events = await db().select().from(schema.lineEvent);
    assert.ok(events.every((e) => !JSON.stringify(e.payload ?? '').includes('ใบเสนอราคา')),
      'and the copy in the event log too');
  });

  test('the same message delivered twice does not make two drafts', async () => {
    const once = message('@ทันงาน โทรหาลูกค้า วันนี้');
    await handleEvent(once);
    await handleEvent(once); // LINE redelivering the same webhook event

    assert.equal((await db().select().from(schema.inboxItem)).length, 1);
  });
});

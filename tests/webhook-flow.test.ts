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
    ({ eq } = await import('drizzle-orm'));
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
    for (const t of [schema.messageUsage, schema.taskEvent, schema.reminder, schema.task,
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

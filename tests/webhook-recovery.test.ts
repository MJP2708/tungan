// P0-2 (2026-11-06): a LINE message is never silently lost.
//
// The dedup insert used to treat ANY error as "already seen", and an event a
// run left half-done was dropped by every redelivery. These run against real
// Postgres, because the primary key, the lease and the conditional claim are
// the point. Skipped without TEST_DATABASE_URL.

import test, { before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL;
if (URL_) {
  process.env.DATABASE_URL = URL_;
  process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN ??= 'test-token';
  process.env.NEXT_PUBLIC_LIFF_ID ??= '1234567890-testliff';
  process.env.APP_BASE_URL ??= 'https://tungan.test';
}

describe('webhook: nothing lost, nothing done twice', { skip: !URL_ ? 'TEST_DATABASE_URL not set' : false }, () => {
  let db: typeof import('../lib/db/index.ts').db;
  let schema: typeof import('../lib/db/schema.ts');
  let events: typeof import('../lib/line/handle-event.ts');
  let recoverWebhookEvents: typeof import('../lib/line/recover.ts').recoverWebhookEvents;
  let eq: typeof import('drizzle-orm').eq;
  let pool: import('pg').Pool;

  const ws = 'ws-r';
  const groupRow = 'g-row-r';
  const LINE_GROUP = 'C0000000000000000000000000000r01';
  const boss = { id: 'u-boss-r', lineUserId: 'U-boss-r' };
  const worker = { id: 'u-worker-r', lineUserId: 'U-worker-r' };

  let sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const pushes = () => sent.filter((c) => c.url.includes('/message/push')).length;

  let n = 0;
  type Event = import('../lib/line/handle-event.ts').LineEventPayload;
  const message = (text: string): Event => {
    n += 1;
    return {
      type: 'message',
      webhookEventId: `rec-${n}`,
      replyToken: `reply-${n}`,
      source: { type: 'group', groupId: LINE_GROUP, userId: boss.lineUserId },
      message: { id: `rec-msg-${n}`, type: 'text', text },
    };
  };
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  /** A row as a run that died mid-way leaves it: claimed, never finished. */
  async function leftUnfinished(event: Event, receivedAt: Date, claimedUntil: Date | null) {
    await db().insert(schema.lineEvent).values({
      webhookEventId: event.webhookEventId!,
      type: event.type,
      sourceType: 'group',
      sourceId: LINE_GROUP,
      senderUserId: boss.lineUserId,
      payload: event as unknown as Record<string, unknown>,
      attempts: 1,
      claimedUntil,
      receivedAt,
    });
  }
  const eventRow = async (id: string) =>
    (await db().select().from(schema.lineEvent).where(eq(schema.lineEvent.webhookEventId, id)))[0];

  before(async () => {
    schema = await import('../lib/db/schema.ts');
    ({ eq } = await import('drizzle-orm'));
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pg = (await import('pg')).default;
    const dbModule = await import('../lib/db/index.ts');
    db = dbModule.db;
    pool = new pg.Pool({ connectionString: URL_ });
    dbModule.__setDb(drizzle(pool, { schema }) as never);
    events = await import('../lib/line/handle-event.ts');
    ({ recoverWebhookEvents } = await import('../lib/line/recover.ts'));

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
    await db().insert(schema.workspace).values({ id: ws, name: 'ทีมทดสอบ', createdByUserId: boss.id });
    await db().insert(schema.workspaceMember).values([
      { workspaceId: ws, userId: boss.id, role: 'manager' },
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

  test('a database error on the dedup insert is not taken for a duplicate', async () => {
    // No type: the insert fails with not_null_violation (23502), not 23505.
    // It used to be swallowed as "already seen", with nothing logged.
    const broken = { ...message('@ทันงาน ส่งรายงาน'), type: undefined } as unknown as Event;
    await assert.rejects(() => events.handleEvent(broken), /type|null/i);
  });

  test('a true duplicate is still a no-op', async () => {
    const e = message('@ทันงาน ส่งรายงาน พรุ่งนี้');
    await events.handleEvent(e);
    await events.handleEvent(e);
    assert.equal((await db().select().from(schema.inboxItem)).length, 1);
  });

  test('a redelivery takes over an event whose run died, once the lease is over', async () => {
    const e = message('@ทันงาน ส่งรายงาน พรุ่งนี้');
    await leftUnfinished(e, minutesAgo(3), minutesAgo(1));
    await events.handleEvent(e);
    assert.equal((await db().select().from(schema.inboxItem)).length, 1, 'the draft was made');
    const row = await eventRow(e.webhookEventId!);
    assert.ok(row.processedAt, 'and the event is finished');
    assert.equal(row.attempts, 2);
  });

  test('an event another run still holds is left to it', async () => {
    const e = message('@ทันงาน ส่งรายงาน พรุ่งนี้');
    await leftUnfinished(e, minutesAgo(1), new Date(Date.now() + 60_000));
    await events.handleEvent(e);
    assert.equal((await db().select().from(schema.inboxItem)).length, 0);
  });

  test('the recovery pass finishes a half-processed event exactly once', async () => {
    const e = message('@ทันงาน เช็คของหน้าร้าน วันนี้');
    await leftUnfinished(e, minutesAgo(10), minutesAgo(8));

    const first = await recoverWebhookEvents();
    const second = await recoverWebhookEvents();
    assert.deepEqual(first, { found: 1, recovered: 1, failed: 0 });
    assert.equal(second.found, 0, 'finished events are not picked up again');
    assert.equal((await db().select().from(schema.inboxItem)).length, 1);
    assert.ok((await eventRow(e.webhookEventId!)).processedAt);
  });

  test('two recovery passes at once run the event once', async () => {
    const e = message('@ทันงาน เช็คของหน้าร้าน วันนี้');
    await leftUnfinished(e, minutesAgo(10), null);
    let runs = 0;
    const slow = async (event: Event) => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 50));
      await events.processEvent(event);
    };
    await Promise.all([recoverWebhookEvents(new Date(), { process: slow }), recoverWebhookEvents(new Date(), { process: slow })]);
    assert.equal(runs, 1);
  });

  test('recovery leaves alone: fresh events, events with no payload, and events out of attempts', async () => {
    const fresh = message('@ทันงาน หนึ่ง');
    await leftUnfinished(fresh, minutesAgo(1), null);
    const exhausted = message('@ทันงาน สอง');
    await leftUnfinished(exhausted, minutesAgo(10), null);
    await db().update(schema.lineEvent).set({ attempts: events.MAX_EVENT_ATTEMPTS })
      .where(eq(schema.lineEvent.webhookEventId, exhausted.webhookEventId!));
    await db().insert(schema.lineEvent).values({ webhookEventId: 'untagged', type: 'message', receivedAt: minutesAgo(10) });
    assert.equal((await recoverWebhookEvents()).found, 0);
  });

  test('a failed recovery is recorded without the message text, and tried again later', async () => {
    const e = message('@ทันงาน ความลับของลูกค้า');
    await leftUnfinished(e, minutesAgo(10), null);
    const r = await recoverWebhookEvents(new Date(), {
      process: async () => {
        throw Object.assign(new Error('Failed query: insert ... params: ความลับของลูกค้า'), { cause: { code: '57P01', message: 'terminating connection' } });
      },
    });
    assert.equal(r.failed, 1);
    const row = await eventRow(e.webhookEventId!);
    assert.equal(row.processedAt, null);
    assert.doesNotMatch(row.processingError ?? '', /ความลับ/);
    assert.match(row.processingError ?? '', /57P01/);
  });

  test('a stored error is cleared with the payload after seven days', async () => {
    // P1-7: the error is about someone's message, so it follows the 7-day rule.
    const { purgeExpiredContent } = await import('../lib/retention.ts');
    const e = message('@ทันงาน เก่า');
    await leftUnfinished(e, minutesAgo(8 * 24 * 60), null);
    await db().update(schema.lineEvent).set({ processingError: '[57P01] terminating connection' })
      .where(eq(schema.lineEvent.webhookEventId, e.webhookEventId!));
    await purgeExpiredContent();
    const row = await eventRow(e.webhookEventId!);
    assert.equal(row.payload, null);
    assert.equal(row.processingError, null);
  });

  test('re-running a split message or an announcement adds nothing', async () => {
    const split = message('@ทันงาน ส่งรายงานพรุ่งนี้ แล้วก็โทรหาลูกค้าบ่าย 3');
    await events.handleEvent(split);
    const drafts = (await db().select().from(schema.inboxItem)).length;
    assert.ok(drafts >= 2, 'the message splits');
    await events.processEvent(split);
    assert.equal((await db().select().from(schema.inboxItem)).length, drafts);

    const announce = message('@ทันงาน ประกาศ: ประชุมย้ายเป็นศุกร์ 10:00');
    await events.handleEvent(announce);
    await events.processEvent(announce);
    assert.equal((await db().select().from(schema.announcement)).length, 1);
  });

  test('offering a hand-off again does not DM the receiver again', async () => {
    const { applyTransition } = await import('../lib/tasks/transitions.ts');
    await db().insert(schema.task).values({ id: 't-r', workspaceId: ws, title: 'งานส่งต่อ', assigneeUserId: boss.id, createdByUserId: boss.id });
    const offer = () => applyTransition({ taskId: 't-r', action: 'handoff', actorUserId: boss.id, input: { assigneeUserId: worker.id } });
    await offer();
    await offer();
    assert.equal(pushes(), 1);
  });
});

// Calendar events: who sees them, who may change them, and that each one's
// LINE notifications are planned, re-planned and sent like every reminder.
//
// Real Postgres; skipped without TEST_DATABASE_URL (setup in
// tests/reminders-dispatch.test.ts).

import test, { before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fromZonedWallClock } from '../lib/deadline.ts';

const URL_ = process.env.TEST_DATABASE_URL;
if (URL_) {
  process.env.DATABASE_URL = URL_;
  process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN ??= 'test-token';
}

describe('calendar events', { skip: !URL_ ? 'TEST_DATABASE_URL not set' : false }, () => {
  let db: typeof import('../lib/db/index.ts').db;
  let schema: typeof import('../lib/db/schema.ts');
  let ev: typeof import('../lib/calendar-events.ts');
  let dispatchDueReminders: typeof import('../lib/reminders/dispatch.ts').dispatchDueReminders;
  let eq: typeof import('drizzle-orm').eq;
  let pool: import('pg').Pool;

  const ws = 'ws-1';
  const boss = 'u-boss';
  const may = 'u-may';
  const nont = 'u-nont';
  const outsider = 'u-out';
  const range = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2027-01-01T00:00:00Z') };
  const days = (n: number) => new Date(Date.now() + n * 86400000);

  const notifications = async (eventId: string) =>
    (await db().select().from(schema.reminder).where(eq(schema.reminder.eventId, eventId)))
      .map((r) => ({ to: r.recipientUserId, sendAt: r.sendAt, state: r.state, kind: r.kind }))
      .sort((a, b) => a.to.localeCompare(b.to));
  const visibleTo = async (userId: string, role = 'member') =>
    (await ev.listEvents({ workspaceId: ws, userId, role, ...range })).map((e) => e.title);

  before(async () => {
    schema = await import('../lib/db/schema.ts');
    ({ eq } = await import('drizzle-orm'));
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pg = (await import('pg')).default;
    const dbModule = await import('../lib/db/index.ts');
    db = dbModule.db;
    pool = new pg.Pool({ connectionString: URL_ });
    dbModule.__setDb(drizzle(pool, { schema }) as never);
    ev = await import('../lib/calendar-events.ts');
    ({ dispatchDueReminders } = await import('../lib/reminders/dispatch.ts'));
  });

  beforeEach(async () => {
    for (const t of [schema.messageUsage, schema.reminder, schema.calendarEventAttendee, schema.calendarEvent,
      schema.groupWorkspace, schema.lineGroupMember, schema.lineGroup,
      schema.workspaceMember, schema.workspace, schema.lineUser]) {
      await db().delete(t);
    }
    await db().insert(schema.lineUser).values([
      { id: boss, lineUserId: 'U-boss', displayName: 'หัวหน้า', isOaFriend: true },
      { id: may, lineUserId: 'U-may', displayName: 'เมย์', isOaFriend: true },
      { id: nont, lineUserId: 'U-nont', displayName: 'นนท์', isOaFriend: true },
      { id: outsider, lineUserId: 'U-out', displayName: 'คนนอก', isOaFriend: true },
    ]);
    await db().insert(schema.workspace).values([{ id: ws, name: 'ทีมทดสอบ' }, { id: 'ws-2', name: 'อีกทีม' }]);
    await db().insert(schema.workspaceMember).values([
      { workspaceId: ws, userId: boss, role: 'owner' },
      { workspaceId: ws, userId: may, role: 'member' },
      { workspaceId: ws, userId: nont, role: 'member' },
      { workspaceId: 'ws-2', userId: outsider, role: 'owner' },
    ]);
  });

  after(async () => {
    await pool.end();
  });

  test('a personal event is seen and notified only for the person who made it — not even the owner', async () => {
    const { id, recipients } = await ev.createEvent({
      workspaceId: ws, createdBy: may,
      body: { title: 'หาหมอฟัน', startsAt: days(3).toISOString(), audience: 'me', notifyMinutes: 60 },
    });
    assert.equal(recipients, 1);
    assert.deepEqual(await visibleTo(may), ['หาหมอฟัน']);
    assert.deepEqual(await visibleTo(boss, 'owner'), []);
    assert.deepEqual((await notifications(id)).map((n) => n.to), [may]);
  });

  test('a team event shows for everyone and notifies each member, so it costs one message each', async () => {
    const starts = days(2);
    const { id, recipients } = await ev.createEvent({
      workspaceId: ws, createdBy: boss,
      body: { title: 'ประชุมทีม', startsAt: starts.toISOString(), audience: 'everyone', notifyMinutes: 30 },
    });
    assert.equal(recipients, 3);
    for (const u of [boss, may, nont]) assert.deepEqual(await visibleTo(u), ['ประชุมทีม']);
    const n = await notifications(id);
    assert.deepEqual(n.map((x) => x.to), [boss, may, nont].sort());
    assert.ok(n.every((x) => x.kind === 'event' && x.state === 'pending'));
  });

  test('"everyone" includes people seen in the team\u2019s LINE group, as ทุกคน tasks do', async () => {
    await db().insert(schema.lineUser).values({ id: 'u-guest', lineUserId: 'U-guest', displayName: 'แขก', isOaFriend: true });
    await db().insert(schema.lineGroup).values({ id: 'g1', lineGroupId: 'C1', name: 'กลุ่ม' });
    await db().insert(schema.groupWorkspace).values({ lineGroupId: 'g1', workspaceId: ws });
    await db().insert(schema.lineGroupMember).values({ lineGroupId: 'g1', userId: 'u-guest' });
    const { id, recipients } = await ev.createEvent({
      workspaceId: ws, createdBy: boss,
      body: { title: 'ประชุมใหญ่', startsAt: days(2).toISOString(), audience: 'everyone', notifyMinutes: 60 },
    });
    assert.equal(recipients, 4);
    assert.deepEqual((await notifications(id)).map((x) => x.to), [boss, may, nont, 'u-guest'].sort());
  });

  test('invited people see it; others do not; someone from another company cannot be invited', async () => {
    const { id } = await ev.createEvent({
      workspaceId: ws, createdBy: boss,
      body: { title: 'ดูหน้างาน', startsAt: days(1).toISOString(), audience: 'people', attendeeIds: [may], notifyMinutes: 10 },
    });
    assert.deepEqual(await visibleTo(may), ['ดูหน้างาน']);
    assert.deepEqual(await visibleTo(nont), []);
    // The organiser is told too.
    assert.deepEqual((await notifications(id)).map((x) => x.to), [boss, may].sort());

    const error = await ev.createEvent({
      workspaceId: ws, createdBy: boss,
      body: { title: 'x', startsAt: days(1).toISOString(), audience: 'people', attendeeIds: [outsider] },
    }).then(() => null, (e) => e);
    assert.equal(error?.status, 400);
  });

  test('moving an event moves its pending notifications; deleting it removes them', async () => {
    const { id } = await ev.createEvent({
      workspaceId: ws, createdBy: boss,
      body: { title: 'ประชุม', startsAt: days(2).toISOString(), audience: 'everyone', notifyMinutes: 60 },
    });
    const later = days(5);
    await ev.updateEvent({
      eventId: id, userId: boss,
      body: { title: 'ประชุม', startsAt: later.toISOString(), audience: 'me', notifyMinutes: 60 },
    });
    const n = await notifications(id);
    // Now private: only the organiser, an hour before the new time.
    assert.deepEqual(n.map((x) => x.to), [boss]);
    assert.equal(n[0].sendAt.getTime(), later.getTime() - 3600000);

    await ev.deleteEvent(id, boss);
    assert.deepEqual(await notifications(id), []);
    assert.deepEqual(await visibleTo(boss), []);
  });

  test('a member cannot change someone else’s team event; the owner can; a private one only its maker', async () => {
    const { id } = await ev.createEvent({
      workspaceId: ws, createdBy: may,
      body: { title: 'อบรม', startsAt: days(2).toISOString(), audience: 'everyone' },
    });
    const denied = await ev.updateEvent({ eventId: id, userId: nont, body: { title: 'x', startsAt: days(2).toISOString() } })
      .then(() => null, (e) => e);
    assert.equal(denied?.status, 403);
    await ev.updateEvent({ eventId: id, userId: boss, body: { title: 'อบรม (ย้ายห้อง)', startsAt: days(2).toISOString(), audience: 'everyone' } });
    assert.deepEqual(await visibleTo(may), ['อบรม (ย้ายห้อง)']);

    const mine = await ev.createEvent({ workspaceId: ws, createdBy: may, body: { title: 'ส่วนตัว', startsAt: days(2).toISOString() } });
    const hidden = await ev.deleteEvent(mine.id, boss).then(() => null, (e) => e);
    assert.equal(hidden?.status, 404, 'a private event is not even acknowledged to others');
    const outside = await ev.deleteEvent(id, outsider).then(() => null, (e) => e);
    assert.equal(outside?.status, 404);
  });

  test('a late-night event is notified before quiet hours, never after the event', async () => {
    // 22:30 Bangkok, ten minutes' notice: 22:20 is quiet (21:00-08:00), so
    // the notification comes at 20:59 that evening.
    const d = days(4);
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(d).split('-').map(Number);
    const starts = fromZonedWallClock(p[0], p[1], p[2], 22, 30);
    const { id } = await ev.createEvent({
      workspaceId: ws, createdBy: boss,
      body: { title: 'ไลฟ์สด', startsAt: starts.toISOString(), notifyMinutes: 10 },
    });
    const [n] = await notifications(id);
    assert.equal(n.sendAt.getTime(), fromZonedWallClock(p[0], p[1], p[2], 20, 59).getTime());
  });

  test('nothing is planned for a time already gone, or with notifications off', async () => {
    const past = await ev.createEvent({ workspaceId: ws, createdBy: boss, body: { title: 'เมื่อวาน', startsAt: days(-1).toISOString(), notifyMinutes: 10 } });
    const off = await ev.createEvent({ workspaceId: ws, createdBy: boss, body: { title: 'ไม่เตือน', startsAt: days(1).toISOString() } });
    assert.deepEqual(await notifications(past.id), []);
    assert.deepEqual(await notifications(off.id), []);
    assert.equal(off.recipients, 0);
  });

  test('the LINE message says นัดหมาย, the title, the time and the join link', async () => {
    const starts = new Date(Date.now() + 20 * 60000);
    const { id } = await ev.createEvent({
      workspaceId: ws, createdBy: boss, now: new Date(Date.now() - 60 * 60000),
      body: { title: 'คุยกับลูกค้า', startsAt: starts.toISOString(), notifyMinutes: 30, link: 'https://meet.google.com/abc-defg-hij' },
    });
    // Due now: the plan said 30 minutes before a start 20 minutes away.
    await db().update(schema.reminder).set({ sendAt: new Date(Date.now() - 1000) }).where(eq(schema.reminder.eventId, id));
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: { body?: string }) => {
      if (String(url).includes('/v2/bot/profile/')) return { ok: true, status: 200, json: async () => ({}) };
      calls.push(JSON.parse(init?.body ?? '{}').messages.map((m: { text: string }) => m.text).join('\n'));
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const result = await dispatchDueReminders({ fetchImpl });
    assert.equal(result.sent, 1);
    assert.match(calls[0], /^นัดหมาย\n• คุยกับลูกค้า · /);
    assert.match(calls[0], /เข้าร่วม: https:\/\/meet\.google\.com\/abc-defg-hij/);
    assert.equal((await notifications(id))[0].state, 'sent');
  });

  test('bad input is refused with a reason', async () => {
    for (const body of [
      { title: '', startsAt: days(1).toISOString() },
      { title: 'x' },
      { title: 'x', startsAt: days(2).toISOString(), endsAt: days(1).toISOString() },
      { title: 'x', startsAt: days(1).toISOString(), notifyMinutes: 7 },
      { title: 'x', startsAt: days(1).toISOString(), audience: 'people', attendeeIds: [] },
      { title: 'x', startsAt: days(1).toISOString(), link: 'javascript:alert(1)' },
    ]) {
      const error = await ev.createEvent({ workspaceId: ws, createdBy: boss, body }).then(() => null, (e) => e);
      assert.equal(error?.status, 400, JSON.stringify(body));
    }
  });
});

// Announcements (shown once per person) and ทุกคน / @All tasks (one copy each).
//
// Real Postgres; skipped without TEST_DATABASE_URL (setup in
// tests/reminders-dispatch.test.ts).

import test, { before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL;
if (URL_) {
  process.env.DATABASE_URL = URL_;
  process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN ??= 'test-token';
}

describe('announcements and ทุกคน tasks', { skip: !URL_ ? 'TEST_DATABASE_URL not set' : false }, () => {
  let db: typeof import('../lib/db/index.ts').db;
  let schema: typeof import('../lib/db/schema.ts');
  let ann: typeof import('../lib/announcements.ts');
  let createTasks: typeof import('../lib/tasks/create.ts').createTasks;
  let everyoneAssignable: typeof import('../lib/auth/assignable.ts').everyoneAssignable;
  let eq: typeof import('drizzle-orm').eq;
  let pool: import('pg').Pool;

  const ws = 'ws-1';
  const boss = 'u-boss';
  const may = 'u-may';
  const nont = 'u-nont'; // seen in the LINE group, never opened the app
  const outsider = 'u-out';

  before(async () => {
    schema = await import('../lib/db/schema.ts');
    ({ eq } = await import('drizzle-orm'));
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pg = (await import('pg')).default;
    const dbModule = await import('../lib/db/index.ts');
    db = dbModule.db;
    pool = new pg.Pool({ connectionString: URL_ });
    dbModule.__setDb(drizzle(pool, { schema }) as never);
    ann = await import('../lib/announcements.ts');
    ({ createTasks } = await import('../lib/tasks/create.ts'));
    ({ everyoneAssignable } = await import('../lib/auth/assignable.ts'));
  });

  beforeEach(async () => {
    for (const t of [schema.announcementRead, schema.announcement, schema.reminder, schema.taskEvent,
      schema.task, schema.groupWorkspace, schema.lineGroupMember, schema.lineGroup,
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
      { workspaceId: 'ws-2', userId: outsider, role: 'owner' },
    ]);
    await db().insert(schema.lineGroup).values({ id: 'g1', lineGroupId: 'C1', name: 'กลุ่ม' });
    await db().insert(schema.groupWorkspace).values({ lineGroupId: 'g1', workspaceId: ws });
    await db().insert(schema.lineGroupMember).values([
      { lineGroupId: 'g1', userId: boss }, { lineGroupId: 'g1', userId: nont },
    ]);
  });

  after(async () => {
    await pool.end();
  });

  test('an announcement pops up once for every member, its author included, never for outsiders', async () => {
    const { id } = await ann.postAnnouncement({ workspaceId: ws, authorUserId: boss, title: 'ประชุมเลื่อนเป็นศุกร์', body: '10:00' });
    assert.equal((await ann.unreadAnnouncementsFor(may)).length, 1, 'a member sees it');
    assert.equal((await ann.unreadAnnouncementsFor(boss)).length, 1, 'so does the person who posted it');
    assert.equal((await ann.unreadAnnouncementsFor(outsider)).length, 0, 'another company never does');

    await ann.markAnnouncementRead(id, may);
    await ann.markAnnouncementRead(id, may); // closing twice changes nothing
    assert.equal((await ann.unreadAnnouncementsFor(may)).length, 0, 'closed means gone, on every device');

    const history = await ann.listAnnouncements(ws, may);
    assert.equal(history[0].title, 'ประชุมเลื่อนเป็นศุกร์');
    assert.equal(history[0].read, true);
  });

  test('someone outside the workspace cannot close (or discover) its announcement', async () => {
    const { id } = await ann.postAnnouncement({ workspaceId: ws, authorUserId: boss, title: 'x', body: '' });
    const error = await ann.markAnnouncementRead(id, outsider).then(() => null, (e) => e);
    assert.equal(error?.status, 404);
  });

  test('read receipts: everyone sees the count, only the author and managers see names', async () => {
    // A third member, so a plain member is not also the author.
    await db().insert(schema.workspaceMember).values({ workspaceId: ws, userId: nont, role: 'member', nickname: 'นนท์จัง' });
    const { id } = await ann.postAnnouncement({
      workspaceId: ws, authorUserId: may, title: 'ประชุมสรุปงาน', body: '',
      link: 'https://meet.google.com/abc-defg-hij',
    });
    await ann.markAnnouncementRead(id, may);
    await ann.markAnnouncementRead(id, outsider).catch(() => {}); // refused, never counted

    const [asMember] = await ann.listAnnouncements(ws, nont);
    assert.equal(asMember.link, 'https://meet.google.com/abc-defg-hij');
    assert.equal(asMember.readCount, 1);
    assert.equal(asMember.audience, 3);
    assert.equal(asMember.unreadNames, null, 'a plain member gets no names');

    const [asAuthor] = await ann.listAnnouncements(ws, may);
    assert.deepEqual([...asAuthor.unreadNames!].sort(), ['นนท์จัง', 'หัวหน้า'].sort(), 'nickname first, then LINE name');

    const [asOwner] = await ann.listAnnouncements(ws, boss, { manager: true });
    assert.equal(asOwner.unreadNames?.length, 2);
  });

  test('a meeting link must be a web link', async () => {
    const error = await ann.postAnnouncement({ workspaceId: ws, authorUserId: boss, title: 'x', body: '', link: 'javascript:alert(1)' })
      .then(() => null, (e) => e);
    assert.equal(error?.status, 400);
  });

  test('an announcement needs a title', async () => {
    const error = await ann.postAnnouncement({ workspaceId: ws, authorUserId: boss, title: '  ', body: 'b' }).then(() => null, (e) => e);
    assert.equal(error?.status, 400);
  });

  test('ทุกคน means members and people seen in the group, minus whoever asked', async () => {
    assert.deepEqual(await everyoneAssignable(ws, boss), [may, nont].sort());
  });

  test('a ทุกคน task is one copy each, linked, with reminders planned', async () => {
    const due = new Date(Date.now() + 2 * 86400e3);
    const made = await createTasks({
      workspaceId: ws, title: 'ส่ง timesheet', dueAt: due, source: 'สร้างในทันงาน',
      createdByUserId: boss, assignees: [may, nont], eventDetail: 'ส่ง timesheet',
    });
    assert.equal(made.ids.length, 2);
    assert.ok(made.batchId);
    const rows = await db().select().from(schema.task).where(eq(schema.task.batchId, made.batchId!));
    assert.deepEqual(rows.map((r) => r.assigneeUserId).sort(), [may, nont].sort());
    assert.ok(rows.every((r) => r.createdByUserId === boss));
    const reminders = await db().select().from(schema.reminder);
    assert.ok(reminders.length >= 2, 'each copy is reminded, not just the first');
  });

  test('a single task has no batch', async () => {
    const made = await createTasks({
      workspaceId: ws, title: 'งานเดียว', dueAt: null, source: 's', createdByUserId: boss,
      assignees: [may], eventDetail: 'x',
    });
    assert.equal(made.batchId, null);
  });
});

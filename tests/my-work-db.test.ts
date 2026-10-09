// "@ทันงาน งานของฉัน": what comes back, and from where. Real Postgres;
// skipped without TEST_DATABASE_URL (setup in tests/reminders-dispatch.test.ts).

import test, { before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL;
if (URL_) process.env.DATABASE_URL = URL_;

describe('my work from LINE', { skip: !URL_ ? 'TEST_DATABASE_URL not set' : false }, () => {
  let db: typeof import('../lib/db/index.ts').db;
  let schema: typeof import('../lib/db/schema.ts');
  let myWorkFor: typeof import('../lib/tasks/my-work.ts').myWorkFor;
  let pool: import('pg').Pool;
  const soon = new Date(Date.now() + 86400000);

  before(async () => {
    schema = await import('../lib/db/schema.ts');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pg = (await import('pg')).default;
    const dbModule = await import('../lib/db/index.ts');
    db = dbModule.db;
    pool = new pg.Pool({ connectionString: URL_ });
    dbModule.__setDb(drizzle(pool, { schema }) as never);
    ({ myWorkFor } = await import('../lib/tasks/my-work.ts'));
  });

  beforeEach(async () => {
    for (const t of [schema.reminder, schema.taskEvent, schema.task, schema.workspaceMember, schema.workspace, schema.lineUser]) {
      await db().delete(t);
    }
    await db().insert(schema.lineUser).values([
      { id: 'u-may', lineUserId: 'U-may', displayName: 'เมย์' },
      { id: 'u-boss', lineUserId: 'U-boss', displayName: 'บอส' },
    ]);
    await db().insert(schema.workspace).values([{ id: 'ws-team', name: 'ทีม' }, { id: 'ws-own', name: 'งานส่วนตัว' }]);
    await db().insert(schema.task).values([
      { id: 't-team', workspaceId: 'ws-team', title: 'ส่งใบเสนอราคา', assigneeUserId: 'u-may', createdByUserId: 'u-boss', dueAt: soon },
      { id: 't-own', workspaceId: 'ws-own', title: 'ต่อทะเบียนรถ', assigneeUserId: 'u-may', createdByUserId: 'u-may', dueAt: soon },
      { id: 't-done', workspaceId: 'ws-team', title: 'เสร็จแล้ว', assigneeUserId: 'u-may', status: 'done' },
      { id: 't-other', workspaceId: 'ws-team', title: 'ของบอส', assigneeUserId: 'u-boss' },
      { id: 't-handoff', workspaceId: 'ws-team', title: 'ส่งต่อมา', assigneeUserId: 'u-boss', pendingAssigneeUserId: 'u-may' },
      { id: 't-review', workspaceId: 'ws-team', title: 'รอตรวจ', assigneeUserId: 'u-boss', createdByUserId: 'u-may', status: 'review' },
    ]);
  });

  after(async () => {
    await pool.end();
  });

  test('in a private chat: every workspace, with hand-offs and reviews; never done or others’ work', async () => {
    const items = await myWorkFor('u-may', null);
    assert.deepEqual(
      items.map((i) => `${i.id}:${i.role}`).sort(),
      ['t-handoff:handoff', 't-own:mine', 't-review:review', 't-team:mine'],
    );
  });

  test('in a group: only that group’s workspace — a personal task is never told to the group', async () => {
    const items = await myWorkFor('u-may', ['ws-team']);
    assert.ok(!items.some((i) => i.id === 't-own'));
    assert.ok(items.some((i) => i.id === 't-team'));
  });

  test('a group not linked to a workspace hears nothing', async () => {
    assert.deepEqual(await myWorkFor('u-may', []), []);
  });
});

// GATE 5: the status loop, and who is allowed to move it.
//
// รับงาน → ขอข้อมูล → ติดปัญหา → ส่งต่อ → ส่งงาน → อนุมัติ / ขอแก้. These rules
// are the product's accountability story, and the same transitions run from
// two surfaces (the app and a LINE postback), so a rule that only holds in
// one of them holds nowhere. The app's own copy of the review rule was wrong
// for a week — อนุมัติ and ขอแก้ never reached the server for the reviewer
// they exist for — which is exactly what this covers.
//
// Real Postgres; LINE and the evidence link check are stubbed. Skipped
// without TEST_DATABASE_URL; setup is in tests/reminders-dispatch.test.ts.

import test, { before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL;
if (URL_) {
  process.env.DATABASE_URL = URL_;
  process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN ??= 'test-token';
}

describe('task lifecycle', { skip: !URL_ ? 'TEST_DATABASE_URL not set' : false }, () => {
  let db: typeof import('../lib/db/index.ts').db;
  let schema: typeof import('../lib/db/schema.ts');
  let applyTransition: typeof import('../lib/tasks/transitions.ts').applyTransition;
  let eq: typeof import('drizzle-orm').eq;
  let pool: import('pg').Pool;

  const ws = 'ws-1';
  const boss = 'u-boss'; // asks for the work
  const worker = 'u-worker'; // does it
  const other = 'u-other'; // a bystander in the same workspace
  const outsider = 'u-outsider'; // in another workspace entirely
  const TASK = 't-1';

  const load = async (id = TASK) =>
    (await db().select().from(schema.task).where(eq(schema.task.id, id)))[0];
  const events = async () =>
    (await db().select().from(schema.taskEvent).where(eq(schema.taskEvent.taskId, TASK))).map((e) => e.kind);
  const refuses = async (fn: () => Promise<unknown>, status: number) => {
    const error = await fn().then(() => null, (e: { status?: number }) => e);
    assert.ok(error, 'expected a refusal');
    assert.equal(error.status, status);
    return error as { status: number; message: string };
  };

  before(async () => {
    schema = await import('../lib/db/schema.ts');
    ({ eq } = await import('drizzle-orm'));
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pg = (await import('pg')).default;
    const dbModule = await import('../lib/db/index.ts');
    db = dbModule.db;
    pool = new pg.Pool({ connectionString: URL_ });
    dbModule.__setDb(drizzle(pool, { schema }) as never);
    ({ applyTransition } = await import('../lib/tasks/transitions.ts'));
    // LINE pushes and the evidence link check both go through fetch.
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch;
  });

  beforeEach(async () => {
    for (const t of [schema.messageUsage, schema.taskEvent, schema.reminder, schema.task,
      schema.workspaceMember, schema.workspace, schema.lineUser]) {
      await db().delete(t);
    }
    await db().insert(schema.lineUser).values([
      { id: boss, lineUserId: 'U-boss', displayName: 'หัวหน้า', isOaFriend: true },
      { id: worker, lineUserId: 'U-worker', displayName: 'เมย์', isOaFriend: true },
      { id: other, lineUserId: 'U-other', displayName: 'คนอื่น', isOaFriend: true },
      { id: outsider, lineUserId: 'U-outsider', displayName: 'คนนอก', isOaFriend: true },
    ]);
    await db().insert(schema.workspace).values([
      { id: ws, name: 'ทีมทดสอบ' },
      { id: 'ws-other', name: 'อีกทีม' },
    ]);
    await db().insert(schema.workspaceMember).values([
      { workspaceId: ws, userId: boss, role: 'member' }, // asks for work, not an admin
      { workspaceId: ws, userId: worker, role: 'member' },
      { workspaceId: ws, userId: other, role: 'member' },
      { workspaceId: 'ws-other', userId: outsider, role: 'owner' },
    ]);
    await db().insert(schema.task).values({
      id: TASK, workspaceId: ws, title: 'ส่งใบเสนอราคา',
      assigneeUserId: worker, primaryAssigneeUserId: worker, createdByUserId: boss,
      dueAt: new Date(Date.now() + 3600e3),
    });
  });

  after(async () => {
    await pool.end();
  });

  test('accepting is one tap, and tapping twice changes nothing', async () => {
    await applyTransition({ taskId: TASK, action: 'accept', actorUserId: worker });
    const first = await load();
    assert.equal(first.status, 'progress');
    assert.ok(first.acceptedAt);

    const again = await applyTransition({ taskId: TASK, action: 'accept', actorUserId: worker });
    assert.equal(again.alreadyApplied, true);
    assert.deepEqual(await events(), ['accepted'], 'no second entry in the history');
  });

  test('someone with no connection to the task cannot even see it', async () => {
    const error = await refuses(
      () => applyTransition({ taskId: TASK, action: 'accept', actorUserId: outsider }),
      404,
    );
    assert.doesNotMatch(error.message, /ส่งใบเสนอราคา/, 'the refusal never leaks the task');
  });

  test('a bystander in the workspace may read it, not move it', async () => {
    await refuses(() => applyTransition({ taskId: TASK, action: 'accept', actorUserId: other }), 403);
  });

  test('ติดปัญหา needs one of the preset reasons, and stays private by default', async () => {
    await refuses(
      () => applyTransition({ taskId: TASK, action: 'blocked', actorUserId: worker, input: { reason: 'อะไรก็ไม่รู้' } }),
      400,
    );

    const result = await applyTransition({
      taskId: TASK, action: 'blocked', actorUserId: worker,
      input: { reason: 'รอลูกค้า', note: 'รอไฟล์ขนาดบูธ' },
    });
    assert.equal((await load()).status, 'blocked');
    assert.equal((await load()).blockedReason, 'รอลูกค้า');
    assert.equal(result.visibility, 'private', 'the reason is not broadcast');
  });

  test('handing over offers the task; it does not move it', async () => {
    await applyTransition({
      taskId: TASK, action: 'handoff', actorUserId: worker, input: { assigneeUserId: other },
    });
    const offered = await load();
    assert.equal(offered.pendingAssigneeUserId, other);
    assert.equal(offered.assigneeUserId, worker, 'still with the sender until accepted');

    await applyTransition({ taskId: TASK, action: 'accept_handoff', actorUserId: other });
    const moved = await load();
    assert.equal(moved.assigneeUserId, other);
    assert.equal(moved.pendingAssigneeUserId, null);
  });

  test('work cannot be handed to someone outside the workspace', async () => {
    await refuses(
      () => applyTransition({ taskId: TASK, action: 'handoff', actorUserId: worker, input: { assigneeUserId: outsider } }),
      400,
    );
  });

  test('ส่งงาน asks for proof first, and unless it is waived, says so', async () => {
    await refuses(() => applyTransition({ taskId: TASK, action: 'submit', actorUserId: worker }), 400);

    await applyTransition({
      taskId: TASK, action: 'submit', actorUserId: worker,
      input: { evidenceUrl: 'https://drive.example.com/file' },
    });
    const submitted = await load();
    assert.equal(submitted.status, 'review', 'submitting is not closing');
    assert.equal(submitted.reviewerUserId, boss, 'whoever asked for the work reviews it');
  });

  test('the worker cannot sign off their own work when somebody else asked for it', async () => {
    await applyTransition({
      taskId: TASK, action: 'submit', actorUserId: worker,
      input: { evidenceUrl: 'https://drive.example.com/file' },
    });
    await refuses(() => applyTransition({ taskId: TASK, action: 'approve', actorUserId: worker }), 403);
    assert.equal((await load()).status, 'review', 'still waiting on the reviewer');
  });

  test('the person who asked for it approves, and pending reminders stop', async () => {
    await applyTransition({
      taskId: TASK, action: 'submit', actorUserId: worker,
      input: { evidenceUrl: 'https://drive.example.com/file' },
    });
    await db().insert(schema.reminder).values({
      id: 'r-1', workspaceId: ws, taskId: TASK, recipientUserId: worker,
      sendAt: new Date(Date.now() + 600e3), originalSendAt: new Date(Date.now() + 600e3),
    });

    await applyTransition({ taskId: TASK, action: 'approve', actorUserId: boss });

    const done = await load();
    assert.equal(done.status, 'done');
    assert.ok(done.closedAt);
    const pending = await db().select().from(schema.reminder).where(eq(schema.reminder.state, 'pending'));
    assert.equal(pending.length, 0, 'a closed task nudges nobody');
  });

  test('ขอแก้ needs a new deadline in the future, or the task is born late', async () => {
    await applyTransition({
      taskId: TASK, action: 'submit', actorUserId: worker,
      input: { evidenceUrl: 'https://drive.example.com/file' },
    });

    await refuses(
      () => applyTransition({ taskId: TASK, action: 'revision', actorUserId: boss, input: { note: 'แก้สีโลโก้' } }),
      400,
    );
    await refuses(
      () => applyTransition({
        taskId: TASK, action: 'revision', actorUserId: boss,
        input: { note: 'แก้สีโลโก้', dueAt: new Date(Date.now() - 3600e3).toISOString() },
      }),
      400,
    );

    const newDue = new Date(Date.now() + 2 * 86400e3);
    await applyTransition({
      taskId: TASK, action: 'revision', actorUserId: boss,
      input: { note: 'แก้สีโลโก้', dueAt: newDue.toISOString() },
    });
    const back = await load();
    assert.equal(back.status, 'progress', 'back with the worker');
    assert.equal(back.submittedAt, null);
    assert.equal(back.dueAt?.toISOString(), newDue.toISOString());
  });
});

// Roles (MEMBER / MANAGER on group membership), can() at every entry point,
// personal tasks and งานฉัน — against a real Postgres (2026-10-17).
// Skipped without TEST_DATABASE_URL (setup in tests/reminders-dispatch.test.ts).

import test, { before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL;
if (URL_) {
  process.env.DATABASE_URL = URL_;
  process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN ??= 'test-token';
  // What production has, so replies carry the button into the app.
  process.env.NEXT_PUBLIC_LIFF_ID ??= '1234567890-testliff';
}

describe('roles, permissions, personal tasks, งานฉัน', { skip: !URL_ ? 'TEST_DATABASE_URL not set' : false }, () => {
  let db: typeof import('../lib/db/index.ts').db;
  let schema: typeof import('../lib/db/schema.ts');
  let eq: typeof import('drizzle-orm').eq;
  let applyTransition: typeof import('../lib/tasks/transitions.ts').applyTransition;
  let roles: typeof import('../lib/auth/roles.ts');
  let myTasksFor: typeof import('../lib/tasks/my-work.ts').myTasksFor;
  let handleEvent: typeof import('../lib/line/handle-event.ts').handleEvent;
  let listTaskEvents: typeof import('../lib/db/events.ts').listTaskEvents;
  let audienceForViewer: typeof import('../lib/events/visibility.ts').audienceForViewer;
  let pool: import('pg').Pool;

  // Group A (LINE group, bound) and group B; a personal workspace for may.
  const A = 'ws-a';
  const B = 'ws-b';
  const MAY_OWN = 'ws-may-own';
  const LINE_GROUP = 'C000000000000000000000000000000A';
  const boss = 'u-boss'; // Manager of A, Member of B
  const may = 'u-may'; // Member of A
  const nont = 'u-nont'; // Member of A
  const beam = 'u-beam'; // Manager of B
  const stranger = 'u-out'; // in nothing

  let sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const replyJson = () => JSON.stringify(sent.filter((c) => c.url.includes('/message/reply')).map((c) => c.body));
  let n = 0;

  async function addTask(id: string, over: Record<string, unknown> = {}) {
    await db().insert(schema.task).values({
      id,
      workspaceId: A,
      title: `งาน ${id}`,
      assigneeUserId: may,
      createdByUserId: boss,
      status: 'review',
      reviewState: 'review',
      dueAt: new Date(Date.now() + 86400000),
      ...over,
    });
  }
  const status = async (id: string) =>
    (await db().select({ s: schema.task.status }).from(schema.task).where(eq(schema.task.id, id)))[0]?.s;
  const refused = (p: Promise<unknown>) => p.then(() => null, (e) => (e as { status?: number }).status ?? 'error');

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
    roles = await import('../lib/auth/roles.ts');
    ({ myTasksFor } = await import('../lib/tasks/my-work.ts'));
    ({ handleEvent } = await import('../lib/line/handle-event.ts'));
    ({ listTaskEvents } = await import('../lib/db/events.ts'));
    ({ audienceForViewer } = await import('../lib/events/visibility.ts'));
    globalThis.fetch = (async (url: string, init?: { body?: string }) => {
      sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : {} });
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
  });

  beforeEach(async () => {
    sent = [];
    for (const t of [schema.auditLog, schema.announcementRead, schema.announcement, schema.messageUsage,
      schema.taskQuestion, schema.taskEvent, schema.reminder, schema.task, schema.inboxItem, schema.lineEvent,
      schema.groupWorkspace, schema.lineGroupMember, schema.lineGroup, schema.workspaceMember,
      schema.workspace, schema.lineUser]) {
      await db().delete(t);
    }
    await db().insert(schema.lineUser).values([
      { id: boss, lineUserId: 'U-boss', displayName: 'บอส', isOaFriend: true },
      { id: may, lineUserId: 'U-may', displayName: 'เมย์', isOaFriend: true },
      { id: nont, lineUserId: 'U-nont', displayName: 'นนท์', isOaFriend: true },
      { id: beam, lineUserId: 'U-beam', displayName: 'บีม', isOaFriend: true },
      { id: stranger, lineUserId: 'U-out', displayName: 'คนนอก', isOaFriend: true },
    ]);
    await db().insert(schema.workspace).values([
      { id: A, name: 'กลุ่มเอ', createdByUserId: boss },
      { id: B, name: 'กลุ่มบี', createdByUserId: beam },
      { id: MAY_OWN, name: 'งานของฉัน', kind: 'personal', createdByUserId: may },
    ]);
    await db().insert(schema.workspaceMember).values([
      { workspaceId: A, userId: boss, role: 'manager' },
      { workspaceId: A, userId: may, role: 'member' },
      { workspaceId: A, userId: nont, role: 'member' },
      { workspaceId: B, userId: beam, role: 'manager' },
      { workspaceId: B, userId: boss, role: 'member' },
      { workspaceId: MAY_OWN, userId: may, role: 'manager' },
    ]);
    await db().insert(schema.lineGroup).values({ id: 'g-a', lineGroupId: LINE_GROUP, name: 'กลุ่มเอ' });
    await db().insert(schema.groupWorkspace).values({ lineGroupId: 'g-a', workspaceId: A });
  });

  after(async () => {
    await pool.end();
  });

  // ── A Member is refused every Manager action ──────────────────────────
  test('a Member cannot approve, request revision, reassign, change deadline or change roles', async () => {
    await addTask('t1');
    assert.equal(await refused(applyTransition({ taskId: 't1', action: 'approve', actorUserId: nont })), 403);
    assert.equal(
      await refused(applyTransition({ taskId: 't1', action: 'revision', actorUserId: nont, input: { note: 'x', dueAt: new Date(Date.now() + 86400000).toISOString() } })),
      403,
    );
    const task = { assigneeUserId: may, createdByUserId: boss };
    for (const action of ['reassign_task', 'change_deadline'] as const) {
      assert.equal(await refused(roles.assertCan({ userId: nont, workspaceId: A, action, task })), 403, action);
    }
    assert.equal(
      await refused(roles.changeMemberRole({ workspaceId: A, actorUserId: nont, targetUserId: may, role: 'manager' })),
      403,
    );
    assert.equal(await status('t1'), 'review');
  });

  test('the same approval as a forged LINE postback from a Member is refused', async () => {
    await addTask('t2');
    await handleEvent({
      type: 'postback',
      webhookEventId: `evt-${(n += 1)}`,
      replyToken: `reply-${n}`,
      source: { type: 'group', groupId: LINE_GROUP, userId: 'U-nont' },
      postback: { data: 'action=status&do=approve&task=t2' },
    } as never);
    assert.equal(await status('t2'), 'review', 'still waiting for a Manager');
    assert.match(replyJson(), /ผู้จัดการ/, 'told why, on the reply token');
    // And as the worker, about their own task: still not a close.
    await handleEvent({
      type: 'postback',
      webhookEventId: `evt-${(n += 1)}`,
      replyToken: `reply-${n}`,
      source: { type: 'group', groupId: LINE_GROUP, userId: 'U-may' },
      postback: { data: 'action=status&do=approve&task=t2' },
    } as never);
    assert.equal(await status('t2'), 'review');
  });

  test('a Member cannot read another member’s private ติดปัญหา note', async () => {
    await addTask('t3', { status: 'progress', reviewState: 'working' });
    await applyTransition({ taskId: 't3', action: 'blocked', actorUserId: may, input: { reason: 'รอลูกค้า', note: 'ลูกค้าเงียบไปสามวัน', visibility: 'private' } });
    const noteFor = async (viewer: string) => {
      const facts = await roles.groupFacts(A, viewer);
      const events = await listTaskEvents('t3', audienceForViewer({ viewerUserId: viewer, facts, task: { assigneeUserId: may, createdByUserId: boss } }));
      return events.some((e) => (e.detail ?? '').includes('ลูกค้าเงียบ'));
    };
    assert.equal(await noteFor(nont), false, 'another member');
    assert.equal(await noteFor(may), true, 'the worker');
    assert.equal(await noteFor(boss), true, 'a Manager');
  });

  test('a Manager in group A has no Manager rights in group B', async () => {
    await db().insert(schema.task).values({ id: 'tb', workspaceId: B, title: 'งานบี', assigneeUserId: beam, createdByUserId: beam, status: 'review', reviewState: 'review' });
    assert.equal(await refused(applyTransition({ taskId: 'tb', action: 'approve', actorUserId: boss })), 403);
    assert.equal(await status('tb'), 'review');
  });

  // ── Role changes ──────────────────────────────────────────────────────
  test('nobody can change their own role', async () => {
    assert.equal(await refused(roles.changeMemberRole({ workspaceId: A, actorUserId: boss, targetUserId: boss, role: 'member' })), 403);
  });

  test('the last Manager cannot be demoted; two Managers demoting each other at once — only one wins', async () => {
    // Make nont a Manager too, then each demotes the other at the same moment.
    await roles.changeMemberRole({ workspaceId: A, actorUserId: boss, targetUserId: nont, role: 'manager' });
    const results = await Promise.allSettled([
      roles.changeMemberRole({ workspaceId: A, actorUserId: boss, targetUserId: nont, role: 'member' }),
      roles.changeMemberRole({ workspaceId: A, actorUserId: nont, targetUserId: boss, role: 'member' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one demotion succeeds');
    const facts = await roles.groupFacts(A, may);
    assert.equal(facts.managerCount, 1, 'the group still has a Manager');
    // The one left cannot be demoted by anyone.
    const managers = await db().select().from(schema.workspaceMember).where(eq(schema.workspaceMember.role, 'manager'));
    const last = managers.find((m) => m.workspaceId === A)!.userId;
    const other = last === boss ? nont : boss;
    const err = await refused(roles.changeMemberRole({ workspaceId: A, actorUserId: other, targetUserId: last, role: 'member' }));
    assert.ok(err === 403 || err === 409, `refused (${err})`);
    // Every change is in the audit log.
    const log = await db().select().from(schema.auditLog).where(eq(schema.auditLog.action, 'role_changed'));
    assert.equal(log.length, 2, 'promotion + the one demotion');
  });

  test('a Manager cannot approve their own task while another Manager exists; alone, it is allowed and logged', async () => {
    await addTask('own', { assigneeUserId: boss, createdByUserId: boss });
    await roles.changeMemberRole({ workspaceId: A, actorUserId: boss, targetUserId: nont, role: 'manager' });
    assert.equal(await refused(applyTransition({ taskId: 'own', action: 'approve', actorUserId: boss })), 403);
    // nont steps down: boss is the only Manager now.
    await roles.changeMemberRole({ workspaceId: A, actorUserId: boss, targetUserId: nont, role: 'member' });
    await applyTransition({ taskId: 'own', action: 'approve', actorUserId: boss });
    assert.equal(await status('own'), 'done');
    const [entry] = await db().select().from(schema.auditLog).where(eq(schema.auditLog.action, 'task_approved'));
    assert.equal(entry.selfApproved, true);
  });

  test('a revision request is logged', async () => {
    await addTask('rev');
    await applyTransition({ taskId: 'rev', action: 'revision', actorUserId: boss, input: { note: 'แก้สี', dueAt: new Date(Date.now() + 2 * 86400000).toISOString() } });
    const [entry] = await db().select().from(schema.auditLog).where(eq(schema.auditLog.action, 'revision_requested'));
    assert.equal(entry.targetTaskId, 'rev');
    assert.equal(entry.actorUserId, boss);
  });

  test('the last Manager leaving the LINE group: no Manager, approvals wait, the creator names a new one', async () => {
    await addTask('wait');
    await handleEvent({
      type: 'memberLeft',
      webhookEventId: `evt-${(n += 1)}`,
      source: { type: 'group', groupId: LINE_GROUP },
      left: { members: [{ userId: 'U-boss' }] },
    } as never);
    assert.equal((await roles.groupFacts(A, may)).managerCount, 0);
    assert.ok((await db().select().from(schema.task)).some((t) => t.id === 'wait'), 'tasks are kept');
    assert.equal(await refused(applyTransition({ taskId: 'wait', action: 'approve', actorUserId: boss })), 403);
    // Tagging the bot does not hand out Manager: the group was set up once.
    await handleEvent({
      type: 'message',
      webhookEventId: `evt-${(n += 1)}`,
      replyToken: `reply-${n}`,
      source: { type: 'group', groupId: LINE_GROUP, userId: 'U-nont' },
      message: { id: `m-${n}`, type: 'text', text: '@ทันงาน ช่วยดูหน้าร้าน' },
    } as never);
    assert.equal((await roles.groupFacts(A, nont)).managerCount, 0, 'no automatic takeover');
    // The creator (boss, now a Member) is the recovery path.
    await roles.changeMemberRole({ workspaceId: A, actorUserId: boss, targetUserId: nont, role: 'manager' });
    await applyTransition({ taskId: 'wait', action: 'approve', actorUserId: nont });
    assert.equal(await status('wait'), 'done');
  });

  // ── Personal tasks ────────────────────────────────────────────────────
  test('a task made for yourself in a private chat is personal; one naming a teammate goes to the team', async () => {
    const dm = (text: string) =>
      handleEvent({
        type: 'message',
        webhookEventId: `evt-${(n += 1)}`,
        replyToken: `reply-${n}`,
        source: { type: 'user', userId: 'U-may' },
        message: { id: `m-${n}`, type: 'text', text },
      } as never);
    await dm('ซื้อของขวัญวันเกิดแม่ พรุ่งนี้');
    await dm('นนท์ ส่งรายงาน พรุ่งนี้');
    const drafts = await db().select().from(schema.inboxItem);
    const own = drafts.find((d) => /ของขวัญ/.test(d.suggestedTitle))!;
    const team = drafts.find((d) => /รายงาน/.test(d.suggestedTitle))!;
    assert.equal(own.workspaceId, MAY_OWN);
    assert.equal(own.suggestedAssigneeUserId, may, 'theirs to do');
    assert.equal(team.workspaceId, A);
  });

  test('a personal task is never seen or touched by anyone else — Managers and workspace creators included', async () => {
    await db().insert(schema.task).values({ id: 'p1', workspaceId: MAY_OWN, title: 'ไปหาหมอฟัน', assigneeUserId: may, createdByUserId: may, status: 'progress', reviewState: 'working' });
    assert.ok((await myTasksFor(may)).some((t) => t.id === 'p1' && t.personal));
    for (const other of [boss, beam, nont]) {
      assert.ok(!(await myTasksFor(other)).some((t) => t.id === 'p1'), other);
      assert.equal(await refused(applyTransition({ taskId: 'p1', action: 'approve', actorUserId: other })), 404, other);
    }
  });

  test('its maker closes a personal task directly; a group task still cannot be closed by its assignee', async () => {
    await db().insert(schema.task).values({ id: 'p2', workspaceId: MAY_OWN, title: 'จ่ายค่าไฟ', assigneeUserId: may, createdByUserId: may, status: 'progress', reviewState: 'working' });
    await applyTransition({ taskId: 'p2', action: 'approve', actorUserId: may });
    assert.equal(await status('p2'), 'done');
    await addTask('g1');
    assert.equal(await refused(applyTransition({ taskId: 'g1', action: 'approve', actorUserId: may })), 403);
  });

  test('a personal task gets no automatic reminder (no push)', async () => {
    const { planRemindersForTask } = await import('../lib/reminders/plan.ts');
    await db().insert(schema.task).values({ id: 'p3', workspaceId: MAY_OWN, title: 'ต่อทะเบียนรถ', assigneeUserId: may, createdByUserId: may, status: 'progress', reviewState: 'working', dueAt: new Date(Date.now() + 6 * 3600000) });
    await planRemindersForTask('p3');
    assert.equal((await db().select().from(schema.reminder).where(eq(schema.reminder.taskId, 'p3'))).length, 0);
  });

  // ── งานฉัน ────────────────────────────────────────────────────────────
  test('งานฉัน never returns a task from a workspace I am not in', async () => {
    // Assigned to stranger in A, but stranger never joined A.
    await addTask('x', { assigneeUserId: stranger, status: 'progress', reviewState: 'working' });
    assert.deepEqual(await myTasksFor(stranger), []);
    await addTask('y', { status: 'progress', reviewState: 'working' });
    const mine = await myTasksFor(may);
    assert.ok(mine.some((t) => t.id === 'y' && t.groupName === 'กลุ่มเอ'));
  });

  test('"@ทันงาน งานฉัน" in a group replies without listing a single task; in a private chat it lists them', async () => {
    await addTask('secret', { title: 'งานลับของเมย์', status: 'progress', reviewState: 'working' });
    await handleEvent({
      type: 'message',
      webhookEventId: `evt-${(n += 1)}`,
      replyToken: `reply-${n}`,
      source: { type: 'group', groupId: LINE_GROUP, userId: 'U-may' },
      message: { id: `m-${n}`, type: 'text', text: '@ทันงาน งานฉัน' },
    } as never);
    const inGroup = replyJson();
    assert.match(inGroup, /เปิดงานฉัน/);
    assert.doesNotMatch(inGroup, /งานลับของเมย์/, 'no task in the group');
    assert.equal((await db().select().from(schema.inboxItem)).length, 0, 'not drafted as a task');

    sent = [];
    await handleEvent({
      type: 'message',
      webhookEventId: `evt-${(n += 1)}`,
      replyToken: `reply-${n}`,
      source: { type: 'user', userId: 'U-may' },
      message: { id: `m-${n}`, type: 'text', text: 'งานฉัน' },
    } as never);
    assert.match(replyJson(), /งานลับของเมย์/);
    assert.equal(sent.filter((c) => c.url.includes('/message/push')).length, 0, 'replies only, never a push');
  });
});

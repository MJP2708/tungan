// GATE 2: a cross-workspace read must fail.
//
// Runs against a real Postgres so the constraints and the join are the ones
// that will run in production. Skipped when TEST_DATABASE_URL is not set.

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { and, eq } from 'drizzle-orm';
import {
  lineUser,
  workspace,
  workspaceMember,
  task,
  lineEvent,
  reminder,
  idempotencyKey,
} from '../lib/db/schema.ts';

const URL_ = process.env.TEST_DATABASE_URL;

describe('workspace isolation', { skip: !URL_ ? 'TEST_DATABASE_URL not set' : false }, () => {
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle>;

  const alice = { id: 'u-alice', lineUserId: 'U-alice' };
  const mallory = { id: 'u-mallory', lineUserId: 'U-mallory' };
  const wsA = 'ws-alice';
  const wsM = 'ws-mallory';

  before(async () => {
    pool = new pg.Pool({ connectionString: URL_ });
    db = drizzle(pool);
    for (const t of [idempotencyKey, reminder, lineEvent, task, workspaceMember, workspace, lineUser]) {
      await db.delete(t);
    }
    await db.insert(lineUser).values([
      { id: alice.id, lineUserId: alice.lineUserId, displayName: 'Alice' },
      { id: mallory.id, lineUserId: mallory.lineUserId, displayName: 'Mallory' },
    ]);
    await db.insert(workspace).values([
      { id: wsA, name: 'Alice Co' },
      { id: wsM, name: 'Mallory Co' },
    ]);
    await db.insert(workspaceMember).values([
      { workspaceId: wsA, userId: alice.id, role: 'owner', nickname: 'Alice' },
      { workspaceId: wsM, userId: mallory.id, role: 'owner', nickname: 'Mallory' },
    ]);
    await db.insert(task).values({
      id: 'task-secret',
      workspaceId: wsA,
      title: 'ราคาต้นทุนลูกค้า ABC',
    });
  });

  after(async () => {
    await pool?.end();
  });

  /** The membership check every route performs, in isolation. */
  async function resolveMembership(workspaceId: string, userId: string) {
    const rows = await db
      .select({ role: workspaceMember.role })
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.workspaceId, workspaceId),
          eq(workspaceMember.userId, userId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  test('a member resolves in their own workspace', async () => {
    assert.ok(await resolveMembership(wsA, alice.id));
  });

  test('an outsider does not resolve, so the route never reaches the data', async () => {
    // Mallory supplies Alice's workspace id, which is all the client controls.
    const membership = await resolveMembership(wsA, mallory.id);
    assert.equal(membership, null, 'Mallory must not resolve membership of Alice workspace');
  });

  test('the workspace-scoped read returns nothing for the outsider', async () => {
    // Even if a bug let the query run, it is scoped to workspaces the caller
    // is a member of, so the secret task is not returned.
    const rows = await db
      .select({ id: task.id, title: task.title })
      .from(task)
      .innerJoin(workspaceMember, eq(workspaceMember.workspaceId, task.workspaceId))
      .where(eq(workspaceMember.userId, mallory.id));
    assert.equal(rows.length, 0);
    assert.ok(!rows.some((r) => r.id === 'task-secret'));
  });

  test('the same read returns the task for its real owner', async () => {
    const rows = await db
      .select({ id: task.id })
      .from(task)
      .innerJoin(workspaceMember, eq(workspaceMember.workspaceId, task.workspaceId))
      .where(eq(workspaceMember.userId, alice.id));
    assert.deepEqual(rows.map((r) => r.id), ['task-secret']);
  });

  test('a duplicate webhook event id is rejected by the database, not by app code', async () => {
    await db.insert(lineEvent).values({ webhookEventId: 'evt-1', type: 'message' });
    await assert.rejects(
      () => db.insert(lineEvent).values({ webhookEventId: 'evt-1', type: 'message' }),
      'a replayed webhook must not insert twice',
    );
  });

  test('an idempotency key can only be claimed once', async () => {
    await db.insert(idempotencyKey).values({ key: 'k-1', workspaceId: wsA, route: 'POST /api/tasks' });
    await assert.rejects(
      () => db.insert(idempotencyKey).values({ key: 'k-1', workspaceId: wsA, route: 'POST /api/tasks' }),
      'a retry must lose the race rather than run the work twice',
    );
  });

  test('the reminder dedup key prevents a second reminder for the same deadline', async () => {
    const original = new Date('2026-09-02T09:00:00.000Z');
    await db.insert(reminder).values({
      id: 'rem-1', workspaceId: wsA, taskId: 'task-secret',
      recipientUserId: alice.id, sendAt: original, originalSendAt: original,
    });
    // A quiet-hours shift changes sendAt but not originalSendAt, so this is
    // still the same reminder and must be rejected.
    await assert.rejects(
      () => db.insert(reminder).values({
        id: 'rem-2', workspaceId: wsA, taskId: 'task-secret',
        recipientUserId: alice.id,
        sendAt: new Date('2026-09-02T01:00:00.000Z'),
        originalSendAt: original,
      }),
      'a shifted reminder must not become a second reminder',
    );
  });
});

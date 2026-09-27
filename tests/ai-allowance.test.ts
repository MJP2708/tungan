// The AI spending rules, against a real Postgres: hard caps, a kill switch,
// no negative balances, and the same message never charged twice.
//
// Setup is the same as tests/reminders-dispatch.test.ts.

import test, { before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL;
if (URL_) {
  process.env.DATABASE_URL = URL_;
  // A key must exist for AI to be considered configured at all.
  process.env.TYPESAFE_API_KEY ??= 'test-key';
}

describe('ai allowance', { skip: !URL_ ? 'TEST_DATABASE_URL not set' : false }, () => {
  let db: typeof import('../lib/db/index.ts').db;
  let schema: typeof import('../lib/db/schema.ts');
  let allowance: typeof import('../lib/ai/allowance.ts');
  let eq: typeof import('drizzle-orm').eq;
  let pool: import('pg').Pool;

  const ws = 'ws-ai';

  before(async () => {
    schema = await import('../lib/db/schema.ts');
    ({ eq } = await import('drizzle-orm'));
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pg = (await import('pg')).default;
    const dbModule = await import('../lib/db/index.ts');
    db = dbModule.db;
    pool = new pg.Pool({ connectionString: URL_ });
    dbModule.__setDb(drizzle(pool, { schema }) as never);
    allowance = await import('../lib/ai/allowance.ts');
  });

  beforeEach(async () => {
    delete process.env.AI_KILL_SWITCH;
    await db().delete(schema.aiUsage);
    await db().delete(schema.workspace);
    await db().insert(schema.workspace).values({
      id: ws, name: 'ทีมทดสอบ', aiEnabled: true, aiDailyCap: 2, aiAllowance: 3,
    });
  });

  after(async () => {
    await pool.end();
  });

  test('a team that has not turned AI on spends nothing', async () => {
    await db().update(schema.workspace).set({ aiEnabled: false }).where(eq(schema.workspace.id, ws));
    assert.equal(await allowance.spendAiRead({ workspaceId: ws, sourceId: 'm-1' }), 'off');
    assert.equal((await db().select().from(schema.aiUsage)).length, 0);
  });

  test('the kill switch stops everything, without touching the database', async () => {
    process.env.AI_KILL_SWITCH = '1';
    assert.equal(await allowance.spendAiRead({ workspaceId: ws, sourceId: 'm-1' }), 'off');
    assert.equal((await db().select().from(schema.aiUsage)).length, 0);
  });

  test('the same message is never charged twice', async () => {
    assert.equal(await allowance.spendAiRead({ workspaceId: ws, sourceId: 'm-1' }), 'ok');
    // LINE redelivering the same message, or any retry.
    assert.equal(await allowance.spendAiRead({ workspaceId: ws, sourceId: 'm-1' }), 'already');
    assert.equal((await db().select().from(schema.aiUsage)).length, 1);
  });

  test('the daily cap stops the day, and the allowance stops the rest', async () => {
    assert.equal(await allowance.spendAiRead({ workspaceId: ws, sourceId: 'a' }), 'ok');
    assert.equal(await allowance.spendAiRead({ workspaceId: ws, sourceId: 'b' }), 'ok');
    // Third today, cap is 2.
    assert.equal(await allowance.spendAiRead({ workspaceId: ws, sourceId: 'c' }), 'over_daily');

    // Tomorrow the day resets, but the allowance of 3 does not.
    const tomorrow = new Date(Date.now() + 26 * 3600e3);
    assert.equal(await allowance.spendAiRead({ workspaceId: ws, sourceId: 'c' }, tomorrow), 'ok');
    assert.equal(await allowance.spendAiRead({ workspaceId: ws, sourceId: 'd' }, tomorrow), 'over_allowance');
  });

  test('what the UI shows never goes below zero', async () => {
    await allowance.spendAiRead({ workspaceId: ws, sourceId: 'a' });
    const left = await allowance.aiAllowanceFor(ws);
    assert.deepEqual(
      { enabled: left.enabled, remaining: left.remaining, usedToday: left.usedToday },
      { enabled: true, remaining: 2, usedToday: 1 },
    );

    // An allowance lowered below what was already spent reads as 0, not -1.
    await db().update(schema.workspace).set({ aiAllowance: 0 }).where(eq(schema.workspace.id, ws));
    assert.equal((await allowance.aiAllowanceFor(ws)).remaining, 0);
  });

  test('a read that the model never answered is given back', async () => {
    await allowance.spendAiRead({ workspaceId: ws, sourceId: 'm-1' });
    await allowance.refundAiRead(ws, 'm-1');
    assert.equal((await allowance.aiAllowanceFor(ws)).remaining, 3);
  });
});

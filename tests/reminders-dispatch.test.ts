// GATE 3: reminders actually go out — once, to one person, counted once.
//
// The rest of the reminder code is pure and tested (policy, schedule). This
// covers the part that is not: the claim query with its lease, the digest
// grouping, and the accounting that decides what a month costs. It runs
// against a real Postgres because that SQL (FOR UPDATE SKIP LOCKED) has no
// meaning anywhere else.
//
// Skipped when TEST_DATABASE_URL is not set:
//   docker run -d --name tungan-test -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=tungan_test -p 55432:5432 postgres:18
//   DATABASE_URL_UNPOOLED=postgres://postgres:test@localhost:55432/tungan_test \
//     npx drizzle-kit migrate
//   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/tungan_test npm test

import test, { before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL;
// lib/db reads this at first use; a non-neon URL makes it use node-postgres.
if (URL_) {
  process.env.DATABASE_URL = URL_;
  process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN ??= 'test-token';
  // What production has, so the message carries a real LIFF link.
  process.env.NEXT_PUBLIC_LIFF_ID ??= '1234567890-testliff';
}

describe('reminder dispatch', { skip: !URL_ ? 'TEST_DATABASE_URL not set' : false }, () => {
  let db: typeof import('../lib/db/index.ts').db;
  let schema: typeof import('../lib/db/schema.ts');
  let dispatchDueReminders: typeof import('../lib/reminders/dispatch.ts').dispatchDueReminders;
  let eq: typeof import('drizzle-orm').eq;

  const ws = 'ws-1';
  const boss = 'u-boss';
  const worker = 'u-worker';
  const stranger = 'u-stranger';

  /**
   * A fetch that records pushes instead of sending them, and answers LINE's
   * profile endpoint — which is how "have they added the OA?" is checked.
   * U-stranger really has not: LINE answers 404 for them.
   */
  function recordingFetch(status = 200) {
    const calls: Array<{ to: string; text: string }> = [];
    const impl = (async (url: string, init?: { body?: string }) => {
      if (String(url).includes('/v2/bot/profile/')) {
        const known = !String(url).endsWith('U-stranger');
        return { ok: known, status: known ? 200 : 404, json: async () => ({}) };
      }
      const body = JSON.parse(init?.body ?? '{}') as { to: string; messages: Array<{ text: string }> };
      calls.push({ to: body.to, text: (body.messages ?? []).map((m) => m.text).join('\n') });
      return { ok: status < 400, status, json: async () => ({}) };
    }) as unknown as typeof fetch;
    return { calls, impl };
  }

  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000);

  async function addReminder(id: string, recipient: string, taskId: string, when = at(-5)) {
    await db().insert(schema.reminder).values({
      id, workspaceId: ws, taskId, recipientUserId: recipient, sendAt: when, originalSendAt: when,
    });
  }

  let pool: import('pg').Pool;

  before(async () => {
    schema = await import('../lib/db/schema.ts');
    ({ eq } = await import('drizzle-orm'));
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pg = (await import('pg')).default;
    const dbModule = await import('../lib/db/index.ts');
    db = dbModule.db;
    // lib/db reaches for `require('pg')`, which only resolves inside Next's
    // bundler; __setDb is the seam it provides for exactly this.
    pool = new pg.Pool({ connectionString: URL_ });
    dbModule.__setDb(drizzle(pool, { schema }) as never);
    ({ dispatchDueReminders } = await import('../lib/reminders/dispatch.ts'));
  });

  beforeEach(async () => {
    for (const t of [schema.messageUsage, schema.reminder, schema.task, schema.workspaceMember, schema.workspace, schema.lineUser]) {
      await db().delete(t);
    }
    await db().insert(schema.lineUser).values([
      { id: boss, lineUserId: 'U-boss', displayName: 'หัวหน้า', isOaFriend: true },
      { id: worker, lineUserId: 'U-worker', displayName: 'ผู้รับงาน', isOaFriend: true },
      // Has never added the OA: a push to them cannot be delivered.
      { id: stranger, lineUserId: 'U-stranger', displayName: 'คนนอก', isOaFriend: false },
    ]);
    await db().insert(schema.workspace).values({ id: ws, name: 'ทีมทดสอบ' });
    await db().insert(schema.workspaceMember).values([
      { workspaceId: ws, userId: boss, role: 'owner' },
      { workspaceId: ws, userId: worker, role: 'member' },
    ]);
    await db().insert(schema.task).values([
      { id: 't-1', workspaceId: ws, title: 'ส่งใบเสนอราคา', assigneeUserId: worker, dueAt: at(60) },
      { id: 't-2', workspaceId: ws, title: 'โทรหาลูกค้า', assigneeUserId: worker, dueAt: at(90) },
    ]);
  });

  after(async () => {
    await pool.end();
  });

  test('two due reminders for one person cost one message, not two', async () => {
    await addReminder('r-1', worker, 't-1');
    await addReminder('r-2', worker, 't-2');
    const { calls, impl } = recordingFetch();

    const result = await dispatchDueReminders({ fetchImpl: impl });

    assert.equal(result.claimed, 2);
    assert.equal(result.recipients, 1);
    assert.equal(result.sent, 1);
    assert.equal(calls.length, 1, 'one push, not one per reminder');
    assert.equal(calls[0].to, 'U-worker');
    assert.match(calls[0].text, /ส่งใบเสนอราคา/);
    assert.match(calls[0].text, /โทรหาลูกค้า/);
    // A digest covers several tasks, so it opens the app, not one task.
    assert.match(calls[0].text, /เปิดในแอป: https:\/\/liff\.line\.me\/1234567890-testliff$/);

    const usage = await db().select().from(schema.messageUsage);
    assert.equal(usage.length, 1);
    assert.equal(usage[0].recipientCount, 1, 'billed per recipient');

    const rows = await db().select().from(schema.reminder);
    assert.ok(rows.every((r) => r.state === 'sent'), 'both rows marked sent');
  });

  test('one reminder links straight to that task', async () => {
    await addReminder('r-1', worker, 't-1');
    const { calls, impl } = recordingFetch();

    await dispatchDueReminders({ fetchImpl: impl });

    assert.match(calls[0].text, /https:\/\/liff\.line\.me\/1234567890-testliff\?task=t-1$/);
  });

  test('a second run sends nothing: no double nudging', async () => {
    await addReminder('r-1', worker, 't-1');
    const first = recordingFetch();
    await dispatchDueReminders({ fetchImpl: first.impl });
    const second = recordingFetch();
    const result = await dispatchDueReminders({ fetchImpl: second.impl });

    assert.equal(result.claimed, 0);
    assert.equal(second.calls.length, 0);
  });

  test('two people get one message each', async () => {
    await addReminder('r-1', worker, 't-1');
    await addReminder('r-2', boss, 't-2');
    const { calls, impl } = recordingFetch();

    const result = await dispatchDueReminders({ fetchImpl: impl });

    assert.equal(result.recipients, 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((c) => c.to).sort(), ['U-boss', 'U-worker']);
  });

  test('someone who has not added the OA is recorded as failed, not sent', async () => {
    await db().insert(schema.workspaceMember).values({ workspaceId: ws, userId: stranger, role: 'member' });
    await addReminder('r-1', stranger, 't-1');
    const { calls, impl } = recordingFetch();

    const result = await dispatchDueReminders({ fetchImpl: impl });

    assert.equal(calls.length, 0, 'never call LINE for someone who cannot receive');
    assert.equal(result.notFriend, 1);
    const [row] = await db().select().from(schema.reminder).where(eq(schema.reminder.id, 'r-1'));
    assert.equal(row.state, 'failed');
    assert.match(row.failureReason ?? '', /เพื่อน/);
    assert.equal((await db().select().from(schema.messageUsage)).length, 0, 'nothing billed');
  });

  test('a stale "not a friend" flag is rechecked with LINE, not trusted', async () => {
    // They did add the OA, but the follow event never reached us — a webhook
    // registered late, or a database restored from before they added it.
    await db().update(schema.lineUser).set({ isOaFriend: false }).where(eq(schema.lineUser.id, worker));
    await addReminder('r-1', worker, 't-1');
    const { calls, impl } = recordingFetch();

    const result = await dispatchDueReminders({ fetchImpl: impl });

    assert.equal(result.sent, 1, 'the reminder goes out');
    assert.equal(calls.length, 1);
    const [row] = await db().select().from(schema.lineUser).where(eq(schema.lineUser.id, worker));
    assert.equal(row.isOaFriend, true, 'and the flag is corrected');
  });

  test('over the monthly cap nothing is sent, and it says why', async () => {
    await db().update(schema.workspace).set({ monthlyMessageCap: 0 }).where(eq(schema.workspace.id, ws));
    await addReminder('r-1', worker, 't-1');
    const { calls, impl } = recordingFetch();

    const result = await dispatchDueReminders({ fetchImpl: impl });

    assert.equal(calls.length, 0);
    assert.equal(result.skippedOverCap, 1);
    const [row] = await db().select().from(schema.reminder).where(eq(schema.reminder.id, 'r-1'));
    assert.equal(row.state, 'failed');
    assert.match(row.failureReason ?? '', /โควตา/);
  });

  test('a reminder that is not due yet is left alone', async () => {
    await addReminder('r-1', worker, 't-1', at(30));
    const { calls, impl } = recordingFetch();

    const result = await dispatchDueReminders({ fetchImpl: impl });

    assert.equal(result.claimed, 0);
    assert.equal(calls.length, 0);
  });
});

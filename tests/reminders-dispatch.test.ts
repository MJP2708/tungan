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
  let billingMonthNow: () => string;

  const ws = 'ws-1';
  const boss = 'u-boss';
  const worker = 'u-worker';
  const stranger = 'u-stranger';

  /**
   * A fetch that records pushes instead of sending them, and answers LINE's
   * profile endpoint — which is how "have they added the OA?" is checked.
   * U-stranger really has not: LINE answers 404 for them.
   */
  function recordingFetch(
    status = 200,
    // LINE's answer about the account's monthly quota; null = LINE does not answer.
    quota: { limit: number | null; used: number } | null = { limit: null, used: 0 },
    pushBody: Record<string, unknown> = {},
  ) {
    const calls: Array<{ to: string; text: string }> = [];
    const impl = (async (url: string, init?: { body?: string }) => {
      if (String(url).endsWith('/v2/bot/message/quota')) {
        return quota
          ? { ok: true, status: 200, json: async () => (quota.limit === null ? { type: 'none' } : { type: 'limited', value: quota.limit }) }
          : { ok: false, status: 500, json: async () => ({}) };
      }
      if (String(url).endsWith('/v2/bot/message/quota/consumption')) {
        return quota
          ? { ok: true, status: 200, json: async () => ({ totalUsage: quota.used }) }
          : { ok: false, status: 500, json: async () => ({}) };
      }
      if (String(url).includes('/v2/bot/profile/')) {
        const known = !String(url).endsWith('U-stranger');
        return { ok: known, status: known ? 200 : 404, json: async () => ({}) };
      }
      const body = JSON.parse(init?.body ?? '{}') as { to: string; messages: Array<{ text: string }> };
      calls.push({ to: body.to, text: (body.messages ?? []).map((m) => m.text).join('\n') });
      return { ok: status < 400, status, json: async () => pushBody };
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
    const { billingMonth } = await import('../lib/line/messaging.ts');
    billingMonthNow = () => billingMonth();
  });

  beforeEach(async () => {
    for (const t of [schema.lineQuota, schema.messageUsage, schema.reminder, schema.task, schema.workspaceMember, schema.workspace, schema.lineUser]) {
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
      { workspaceId: ws, userId: boss, role: 'manager' },
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

  test('a personal reminder says what it is about, in the person\u2019s words', async () => {
    // เตือนฉัน: no task, just what they typed. The DM used to read
    // "• งานที่ต้องทำ", because the text was never stored.
    const when = at(-5);
    await db().insert(schema.reminder).values({
      id: 'r-note', workspaceId: ws, taskId: null, recipientUserId: worker,
      kind: 'manual', note: 'โทรยืนยันคิวกับลูกค้า', sendAt: when, originalSendAt: when,
    });
    const { calls, impl } = recordingFetch();

    await dispatchDueReminders({ fetchImpl: impl });

    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /โทรยืนยันคิวกับลูกค้า/);
    assert.doesNotMatch(calls[0].text, /งานที่ต้องทำ/);
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

  // P0-3 (2026-11-06): every workspace sends from ONE LINE account.
  test('the account quota stops a push even when every workspace is under its own cap', async () => {
    await addReminder('r-1', worker, 't-1');
    // 300 a month, 95% held to the reserve: 285 is the most we spend.
    const { calls, impl } = recordingFetch(200, { limit: 300, used: 285 });

    const result = await dispatchDueReminders({ fetchImpl: impl });

    assert.equal(calls.length, 0, 'nothing pushed');
    assert.equal(result.skippedOverCap, 1);
    const [row] = await db().select().from(schema.reminder).where(eq(schema.reminder.id, 'r-1'));
    assert.equal(row.state, 'failed');
    assert.match(row.failureReason ?? '', /บัญชี LINE/, 'and it says the account ran out, not the team');
  });

  test('pushes made since LINE last counted are added to its count', async () => {
    await db().insert(schema.lineQuota).values({ id: 'oa', monthlyLimit: 300, used: 270, checkedAt: new Date(Date.now() - 60_000) });
    await db().insert(schema.messageUsage).values(Array.from({ length: 15 }, (_, i) => ({
      id: `mu-${i}`, workspaceId: ws, channel: 'push', recipientCount: 1, billingMonth: billingMonthNow(),
    })));
    await addReminder('r-1', worker, 't-1');
    const { calls, impl } = recordingFetch(200, null);

    await dispatchDueReminders({ fetchImpl: impl });

    assert.equal(calls.length, 0, '270 + 15 reaches the limit less the reserve');
  });

  test('when LINE cannot say, the push still goes (the workspace cap still applies)', async () => {
    await addReminder('r-1', worker, 't-1');
    const { calls, impl } = recordingFetch(200, null);
    const result = await dispatchDueReminders({ fetchImpl: impl });
    assert.equal(result.sent, 1);
    assert.equal(calls.length, 1);
  });

  test("LINE's monthly-limit 429 fails the reminder once, and stops every push this month", async () => {
    await addReminder('r-1', worker, 't-1');
    const first = recordingFetch(429, { limit: null, used: 0 }, { message: 'You have reached your monthly limit.' });
    await dispatchDueReminders({ fetchImpl: first.impl });

    const [row] = await db().select().from(schema.reminder).where(eq(schema.reminder.id, 'r-1'));
    assert.equal(row.state, 'failed', 'not retried');
    assert.equal(row.attempts, 1);
    assert.match(row.failureReason ?? '', /บัญชี LINE/);

    await addReminder('r-2', boss, 't-2');
    const second = recordingFetch(200, { limit: null, used: 0 });
    await dispatchDueReminders({ fetchImpl: second.impl });
    assert.equal(second.calls.length, 0, 'LINE is not asked again this month');
  });

  test("LINE's rate-limit 429 backs off and tries again", async () => {
    await addReminder('r-1', worker, 't-1');
    const { impl } = recordingFetch(429, { limit: null, used: 0 }, { message: 'The API rate limit has been exceeded. Try again later.' });
    await dispatchDueReminders({ fetchImpl: impl });
    const [row] = await db().select().from(schema.reminder).where(eq(schema.reminder.id, 'r-1'));
    assert.equal(row.state, 'pending');
    assert.ok(row.claimedUntil && row.claimedUntil.getTime() > Date.now(), 'held back for a while');
  });

  // P0-4 (2026-11-06): LINE accepted the push, then the run died before
  // marking the reminder sent. The next run must not deliver it again.
  test('a push LINE accepted before a crash is delivered once across two runs', async () => {
    await addReminder('r-1', worker, 't-1');
    const delivered: string[] = [];
    const keys = new Set<string>();
    // Like LINE: a second request under a key it has seen is refused with 409.
    const line = (async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
      if (String(url).includes('/message/quota')) return { ok: false, status: 500, json: async () => ({}) };
      const key = init?.headers?.['X-Line-Retry-Key'];
      if (key && keys.has(key)) return { ok: false, status: 409, json: async () => ({ message: 'The retry key is already accepted' }) };
      if (key) keys.add(key);
      delivered.push(String(init?.body));
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;

    await dispatchDueReminders({ fetchImpl: line });
    // What a run that died after the push leaves behind: still pending,
    // lease over, nothing recorded.
    await db().update(schema.reminder)
      .set({ state: 'pending', sentAt: null, claimedUntil: new Date(Date.now() - 60_000) })
      .where(eq(schema.reminder.id, 'r-1'));
    await db().delete(schema.messageUsage);

    const second = await dispatchDueReminders({ fetchImpl: line });

    assert.equal(delivered.length, 1, 'delivered once');
    assert.equal(second.sent, 1, 'the second run counts it as sent');
    const [row] = await db().select().from(schema.reminder).where(eq(schema.reminder.id, 'r-1'));
    assert.equal(row.state, 'sent');
    assert.equal((await db().select().from(schema.messageUsage)).length, 1, 'and records it once');
  });

  test('a snoozed or re-opened reminder goes out under a new key, not the old one', async () => {
    // Its old key would make LINE refuse the new message as a repeat (409),
    // and it would be marked sent without arriving. The route needs a
    // session, so the rule is checked where it lives.
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../app/api/reminders/[id]/route.ts', import.meta.url), 'utf8');
    assert.match(src, /if \(patch\.state === 'pending' \|\| patch\.sendAt\) patch\.pushKey = null;/);
  });

  test('a reminder that is not due yet is left alone', async () => {
    await addReminder('r-1', worker, 't-1', at(30));
    const { calls, impl } = recordingFetch();

    const result = await dispatchDueReminders({ fetchImpl: impl });

    assert.equal(result.claimed, 0);
    assert.equal(calls.length, 0);
  });
});

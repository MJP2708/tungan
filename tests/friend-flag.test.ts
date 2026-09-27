// Whether a reminder can reach someone at all.
//
// Both production accounts carried a stale `is_oa_friend = false`, which
// would have silently suppressed every reminder: nothing is sent, nothing
// fails, and the product looks like it is working. The flag is now treated as
// a cache of LINE's answer, not as the truth.
//
// Real Postgres, LINE stubbed. Skipped without TEST_DATABASE_URL; setup is in
// tests/reminders-dispatch.test.ts.

import test, { before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL;
if (URL_) {
  process.env.DATABASE_URL = URL_;
  process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN ??= 'test-token';
}

describe('the OA friend flag', { skip: !URL_ ? 'TEST_DATABASE_URL not set' : false }, () => {
  let db: typeof import('../lib/db/index.ts').db;
  let schema: typeof import('../lib/db/schema.ts');
  let refreshFriendFlag: typeof import('../lib/line/messaging.ts').refreshFriendFlag;
  let addFriendUrl: typeof import('../lib/line/messaging.ts').addFriendUrl;
  let eq: typeof import('drizzle-orm').eq;
  let pool: import('pg').Pool;

  const USER = 'u-1';
  const stored = async () =>
    (await db().select().from(schema.lineUser).where(eq(schema.lineUser.id, USER)))[0].isOaFriend;
  /** LINE's profile endpoint, answering however the test needs. */
  const lineSays = (status: number, body: unknown = {}) =>
    (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;

  before(async () => {
    schema = await import('../lib/db/schema.ts');
    ({ eq } = await import('drizzle-orm'));
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pg = (await import('pg')).default;
    const dbModule = await import('../lib/db/index.ts');
    db = dbModule.db;
    pool = new pg.Pool({ connectionString: URL_ });
    dbModule.__setDb(drizzle(pool, { schema }) as never);
    ({ refreshFriendFlag, addFriendUrl } = await import('../lib/line/messaging.ts'));
  });

  beforeEach(async () => {
    await db().delete(schema.lineUser);
    await db().insert(schema.lineUser).values({
      id: USER, lineUserId: 'U-1', displayName: 'เมย์', isOaFriend: false,
    });
  });

  after(async () => {
    await pool.end();
  });

  test('a stale no is corrected the moment LINE says otherwise', async () => {
    const friend = await refreshFriendFlag(USER, 'U-1', { fetchImpl: lineSays(200, { displayName: 'เมย์' }) });
    assert.equal(friend, true);
    assert.equal(await stored(), true, 'and it is remembered, so the next send is direct');
  });

  test('LINE’s 404 is the one answer that means "not a friend"', async () => {
    assert.equal(await refreshFriendFlag(USER, 'U-1', { fetchImpl: lineSays(404) }), false);
    assert.equal(await stored(), false);
  });

  test('LINE being down is not an answer about anyone', async () => {
    const broken = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    assert.equal(await refreshFriendFlag(USER, 'U-1', { fetchImpl: broken }), false);
    assert.equal(await stored(), false, 'nothing is written on a guess');
  });

  test('the add-friend link comes from LINE, and is not invented when it cannot answer', async () => {
    // Failure first: a null answer must not be cached as "there is no link".
    assert.equal(await addFriendUrl({ fetchImpl: lineSays(500) }), null);
    assert.equal(
      await addFriendUrl({ fetchImpl: lineSays(200, { basicId: '@123abcde' }) }),
      'https://line.me/R/ti/p/@123abcde',
    );
  });
});

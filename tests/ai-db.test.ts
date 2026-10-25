// AI (2026-10-25) against a real Postgres: a weak LINE message read with the
// model's help, one charge per source, a retry answered from the stored
// answer, a failure given back, and training kept only with consent — and
// gone on unsend or opt-out. The model is a stubbed fetch, never a network.
// Skipped without TEST_DATABASE_URL (setup in tests/reminders-dispatch.test.ts).

import test, { before, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const URL_ = process.env.TEST_DATABASE_URL;
if (URL_) {
  process.env.DATABASE_URL = URL_;
  process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN ??= 'test-token';
  process.env.ML_SERVICE_URL = 'https://ml.test';
  process.env.ML_SERVICE_TOKEN = 'test-token';
}

describe('ai: reading, charging once, training consent', { skip: !URL_ ? 'TEST_DATABASE_URL not set' : false }, () => {
  let db: typeof import('../lib/db/index.ts').db;
  let schema: typeof import('../lib/db/schema.ts');
  let eq: typeof import('drizzle-orm').eq;
  let handleEvent: typeof import('../lib/line/handle-event.ts').handleEvent;
  let assist: typeof import('../lib/ai/assist.ts');
  let training: typeof import('../lib/ai/training.ts');
  let purgeExpiredContent: typeof import('../lib/retention.ts').purgeExpiredContent;
  let pool: import('pg').Pool;

  const A = 'ws-a';
  const LINE_GROUP = 'C000000000000000000000000000000A';
  const boss = 'u-boss';
  const may = 'u-may';

  let sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  let modelCalls = 0;
  let modelAnswer: unknown = null;
  let modelDown = false;
  let n = 0;

  const say = (text: string) =>
    handleEvent({
      type: 'message',
      webhookEventId: `evt-${(n += 1)}`,
      replyToken: `reply-${n}`,
      source: { type: 'group', groupId: LINE_GROUP, userId: 'U-boss' },
      message: { id: `m-${n}`, type: 'text', text },
    } as never);
  const tap = (data: string) =>
    handleEvent({
      type: 'postback',
      webhookEventId: `evt-${(n += 1)}`,
      replyToken: `reply-${n}`,
      source: { type: 'group', groupId: LINE_GROUP, userId: 'U-boss' },
      postback: { data },
    } as never);
  const usageRows = async () => db().select().from(schema.aiUsage);

  before(async () => {
    schema = await import('../lib/db/schema.ts');
    ({ eq } = await import('drizzle-orm'));
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pg = (await import('pg')).default;
    const dbModule = await import('../lib/db/index.ts');
    db = dbModule.db;
    pool = new pg.Pool({ connectionString: URL_ });
    dbModule.__setDb(drizzle(pool, { schema }) as never);
    ({ handleEvent } = await import('../lib/line/handle-event.ts'));
    assist = await import('../lib/ai/assist.ts');
    training = await import('../lib/ai/training.ts');
    ({ purgeExpiredContent } = await import('../lib/retention.ts'));
    globalThis.fetch = (async (url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      if (String(url).startsWith('https://ml.test')) {
        modelCalls += 1;
        if (modelDown) return { ok: false, status: 503, json: async () => ({}) };
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: JSON.stringify(modelAnswer) } }] }),
        };
      }
      sent.push({ url: String(url), body });
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
  });

  beforeEach(async () => {
    sent = [];
    modelCalls = 0;
    modelDown = false;
    modelAnswer = null;
    for (const t of [schema.aiTrainingExample, schema.aiUsage, schema.auditLog, schema.messageUsage,
      schema.taskEvent, schema.reminder, schema.task, schema.inboxItem, schema.lineEvent,
      schema.groupWorkspace, schema.lineGroupMember, schema.lineGroup, schema.workspaceMember,
      schema.workspace, schema.lineUser]) {
      await db().delete(t);
    }
    await db().insert(schema.lineUser).values([
      { id: boss, lineUserId: 'U-boss', displayName: 'บอส', isOaFriend: true },
      { id: may, lineUserId: 'U-may', displayName: 'เมย์', isOaFriend: true },
    ]);
    await db().insert(schema.workspace).values({ id: A, name: 'กลุ่มเอ', createdByUserId: boss, aiEnabled: true });
    await db().insert(schema.workspaceMember).values([
      { workspaceId: A, userId: boss, role: 'manager' },
      { workspaceId: A, userId: may, role: 'member' },
    ]);
    await db().insert(schema.lineGroup).values({ id: 'g-a', lineGroupId: LINE_GROUP, name: 'กลุ่มเอ' });
    await db().insert(schema.groupWorkspace).values({ lineGroupId: 'g-a', workspaceId: A });
  });

  after(async () => {
    await pool.end();
  });

  const tomorrow = () => {
    const d = new Date(Date.now() + 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(d); // YYYY-MM-DD
  };

  test('a message the rules cannot read is read with the model, marked as such, and charged once', async () => {
    modelAnswer = { tasks: [{ title: 'ดูหน้าร้านให้เรียบร้อย', assignee: null, dueDate: tomorrow(), dueTime: '10:00', reason: 'บอกว่าพรุ่งนี้' }] };
    await say('@ทันงาน ช่วยดูหน้าร้านให้เรียบร้อยด้วยนะ');
    const [draft] = await db().select().from(schema.inboxItem);
    assert.equal(draft.aiAssisted, true);
    assert.equal(draft.aiReason, 'บอกว่าพรุ่งนี้');
    assert.ok(draft.suggestedDueAt, 'the deadline came from the model');
    assert.equal(draft.sourceMessageId, `m-${n}`);
    assert.match(JSON.stringify(sent), /AI ช่วยอ่าน/);
    assert.equal(modelCalls, 1);
    assert.equal((await usageRows()).length, 1);
  });

  test('a message the rules read fine never reaches the model', async () => {
    await say('@ทันงาน เมย์ ส่งรายงาน พรุ่งนี้ 10 โมง');
    assert.equal(modelCalls, 0);
    assert.equal((await usageRows()).length, 0);
    const [draft] = await db().select().from(schema.inboxItem);
    assert.equal(draft.aiAssisted, false);
  });

  test('with AI off for the team, or the model down, the rules reading stands and nothing is charged', async () => {
    modelDown = true;
    await say('@ทันงาน ช่วยดูหน้าร้านให้เรียบร้อยด้วยนะ');
    assert.equal(modelCalls, 1);
    assert.equal((await usageRows()).length, 0, 'given back');
    const [draft] = await db().select().from(schema.inboxItem);
    assert.equal(draft.aiAssisted, false);
    assert.equal(draft.suggestedDueAt, null);

    await db().update(schema.workspace).set({ aiEnabled: false }).where(eq(schema.workspace.id, A));
    modelDown = false;
    await say('@ทันงาน ช่วยจัดชั้นวางของหน่อย');
    assert.equal(modelCalls, 1, 'not asked');
  });

  test('a retry under the same key is answered from the stored answer: one charge, one call', async () => {
    modelAnswer = { summary: 'กำลังทำ รอตรวจพรุ่งนี้', nextStep: null };
    const input = { title: 'x', status: 'กำลังทำ', due: 'พรุ่งนี้', assignee: 'เมย์', history: [] };
    const first = await assist.summarizeTask({ workspaceId: A, idempotencyKey: 'k1', input });
    modelAnswer = { summary: 'something else', nextStep: null };
    const again = await assist.summarizeTask({ workspaceId: A, idempotencyKey: 'k1', input });
    assert.deepEqual(again, first);
    assert.equal(modelCalls, 1);
    assert.equal((await usageRows()).length, 1);

    // After seven days only the count is left.
    await purgeExpiredContent(new Date(Date.now() + 8 * 86400000));
    assert.equal((await usageRows())[0].answer, null);
    assert.equal((await usageRows()).length, 1);
  });

  test('training: nothing is kept without consent; with it, a confirmed draft is kept, unsend and opt-out delete it', async () => {
    modelAnswer = { tasks: [{ title: 'ดูหน้าร้าน', assignee: null, dueDate: tomorrow(), dueTime: null, reason: 'r' }] };
    await say('@ทันงาน ช่วยดูหน้าร้านหน่อย');
    let [draft] = await db().select().from(schema.inboxItem);
    await tap(`action=confirm&inbox=${draft.id}`);
    assert.equal((await db().select().from(schema.aiTrainingExample)).length, 0, 'not opted in');
    [draft] = await db().select().from(schema.inboxItem);
    assert.equal(draft.rawMessage, null, 'confirm clears the text');
    assert.equal(draft.aiReading, null, 'and what the model read from it');

    await training.setTrainingOptIn({ workspaceId: A, actorUserId: boss, on: true });
    await say('@ทันงาน ช่วยดูหน้าร้านอีกที');
    const fresh = (await db().select().from(schema.inboxItem)).find((d) => d.state === 'pending')!;
    const messageId = fresh.sourceMessageId!;
    await tap(`action=confirm&inbox=${fresh.id}`);
    const [example] = await db().select().from(schema.aiTrainingExample);
    assert.equal(example.sourceText, '@ทันงาน ช่วยดูหน้าร้านอีกที');
    assert.equal(example.consentVersion, training.TRAINING_CONSENT_VERSION);
    assert.ok(example.aiReading, 'what the model read is kept beside it');
    assert.equal(example.corrected, false);

    await handleEvent({
      type: 'unsend',
      webhookEventId: `evt-${(n += 1)}`,
      source: { type: 'group', groupId: LINE_GROUP, userId: 'U-boss' },
      unsend: { messageId },
    } as never);
    assert.equal((await db().select().from(schema.aiTrainingExample)).length, 0, 'unsend deletes it');

    await say('@ทันงาน ช่วยดูหน้าร้านรอบสาม');
    const third = (await db().select().from(schema.inboxItem)).find((d) => d.state === 'pending')!;
    await tap(`action=confirm&inbox=${third.id}`);
    assert.equal((await db().select().from(schema.aiTrainingExample)).length, 1);
    const off = await training.setTrainingOptIn({ workspaceId: A, actorUserId: boss, on: false });
    assert.equal(off.deleted, 1);
    assert.equal((await db().select().from(schema.aiTrainingExample)).length, 0, 'opt-out deletes everything');
  });
});

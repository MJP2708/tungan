// Phase 6 (2026-10-25): AI — reading a LINE message the rules cannot, the
// suggestion beside งานฉัน, summaries, charging once, and training only with
// consent. Needs the model stand-in running and the app pointed at it:
//   ML_STAND_IN_TOKEN=e2e-ml-token PORT=8790 node tools/ml/stand-in.mjs
//   … ML_SERVICE_URL=http://127.0.0.1:8790 ML_SERVICE_TOKEN=e2e-ml-token npx next start -p 3108
import crypto from 'node:crypto';
import { launch, person, step, summary, q, expect, sleep, BASE } from './lib.mjs';

const ML = process.env.ML_STAND_IN ?? 'http://127.0.0.1:8790';
const browser = await launch();
const boss = await person(browser, 'tok-boss-e2e'); // Manager of ws-team
const may = await person(browser, 'tok-may-e2e'); // Member of ws-team
const GROUP = 'C00000000000000000000000000000001';
const BOSS_LINE = 'U00000000000000000000000000000b05';

async function webhook(events) {
  const body = JSON.stringify({ destination: 'Ue2e', events });
  const sig = crypto.createHmac('sha256', 'e2e-channel-secret').update(body).digest('base64');
  return fetch(BASE + '/api/webhooks/line', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': sig },
    body,
  });
}
const evt = (extra) => {
  const id = `e2e-p6-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { mode: 'active', timestamp: Date.now(), webhookEventId: id, deliveryContext: { isRedelivery: false }, replyToken: `rt-${id}`, ...extra };
};
const say = async (text) => {
  const messageId = `m-p6-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await webhook([evt({ type: 'message', source: { type: 'group', groupId: GROUP, userId: BOSS_LINE }, message: { id: messageId, type: 'text', text } })]);
  expect(res.status === 200, `webhook ${res.status}`);
  await sleep(1500);
  return messageId;
};
const stand = async () => (await fetch(ML + '/calls')).json();
const usage = async () => (await q("select count(*)::int n from ai_usage where workspace_id='ws-team'"))[0].n;

await step('only a Manager turns AI on for the team', may.page, async () => {
  const no = await may.page.request.patch(BASE + '/api/workspaces/ws-team', { data: { aiEnabled: true } });
  expect(no.status() === 403, `member ${no.status()}`);
  const yes = await boss.page.request.patch(BASE + '/api/workspaces/ws-team', { data: { aiEnabled: true } });
  expect(yes.ok(), `manager ${yes.status()}`);
});

await step('a message the rules cannot read is read with AI help, marked, and charged once', boss.page, async () => {
  const before = (await stand()).calls;
  const messageId = await say('@ทันงาน ช่วยจัดหน้าร้านให้เรียบร้อยก่อนประชุมนะ');
  const [d] = await q('select * from inbox_item where source_message_id=$1', [messageId]);
  expect(d, 'no draft');
  expect(d.ai_assisted === true && d.suggested_due_at, `not read with AI: ${JSON.stringify({ a: d.ai_assisted, due: d.suggested_due_at })}`);
  expect((await stand()).calls === before + 1, 'model not asked exactly once');
  expect((await usage()) === 1, `usage ${await usage()}`);
  // A redelivery of the same message is not read or charged again.
  await webhook([evt({ type: 'message', deliveryContext: { isRedelivery: true }, source: { type: 'group', groupId: GROUP, userId: BOSS_LINE }, message: { id: messageId, type: 'text', text: '@ทันงาน ช่วยจัดหน้าร้านให้เรียบร้อยก่อนประชุมนะ' } })]);
  await sleep(1200);
  expect((await usage()) === 1, 'charged twice');
  // The app shows the draft as AI-read.
  await boss.page.goto(BASE + '/?p=inbox');
  await boss.page.getByText('AI ช่วยอ่าน · ตรวจก่อนยืนยัน').first().waitFor({ timeout: 8000 });
});

await step('a message the rules read fine never reaches the model; a model failure leaves the rules reading and charges nothing', null, async () => {
  const before = (await stand()).calls;
  const u = await usage();
  await say('@ทันงาน เมย์ ส่งรายงาน พรุ่งนี้ 10 โมง');
  expect((await stand()).calls === before, 'asked the model about a readable message');
  const failId = await say('@ทันงาน STANDIN_FAIL ช่วยดูของหน่อย');
  const [d] = await q('select ai_assisted from inbox_item where source_message_id=$1', [failId]);
  expect(d && d.ai_assisted === false, 'draft missing or marked AI');
  expect((await usage()) === u, 'a failed read was charged');
});

await step('priorities: a suggestion with a reason; a retry under the same key is neither asked nor charged again', boss.page, async () => {
  await q(`insert into task (id, workspace_id, title, assignee_user_id, created_by_user_id, status, review_state, due_at)
           values ('t-p6-mine', 'ws-team', 'E2E งานของบอส', 'u-boss', 'u-boss', 'progress', 'working', now() - interval '1 hour')`);
  const before = (await stand()).calls;
  const u = await usage();
  const key = crypto.randomUUID();
  const ask = () => boss.page.request.post(BASE + '/api/me/priorities', { data: { workspaceId: 'ws-team' }, headers: { 'idempotency-key': key } });
  const a = await (await ask()).json();
  const b = await (await ask()).json();
  expect(Array.isArray(a.suggestions) && a.suggestions.length === 1 && a.suggestions[0].reason, `answer ${JSON.stringify(a)}`);
  expect(JSON.stringify(a) === JSON.stringify(b), 'retry answered differently');
  expect((await stand()).calls === before + 1, 'asked twice');
  expect((await usage()) === u + 1, 'charged twice');
  // A workspace the caller is not in cannot pay.
  const other = await may.page.request.post(BASE + '/api/me/priorities', { data: { workspaceId: 'ws-boss-own' } });
  expect(other.status() === 403 || other.status() === 404, `other workspace ${other.status()}`);
  // On screen, beside งานฉัน.
  await boss.page.goto(BASE + '/?p=mine');
  await boss.page.getByRole('button', { name: 'ควรทำอะไรก่อน' }).click();
  await boss.page.locator('.ai-picks li').first().waitFor({ timeout: 8000 });
});

await step('a task summary sends only what the reader may see', may.page, async () => {
  await q(`insert into task (id, workspace_id, title, assignee_user_id, created_by_user_id, status, review_state)
           values ('t-p6', 'ws-team', 'E2E งานบอสติด', 'u-boss', 'u-boss', 'blocked', 'working')`);
  await q(`insert into task_event (id, task_id, workspace_id, actor_user_id, kind, detail, visibility)
           values ('ev-p6', 't-p6', 'ws-team', 'u-boss', 'blocked', 'ติดปัญหา: ความลับของบอส', 'private')`);
  const res = await may.page.request.post(BASE + '/api/tasks/t-p6/ai-summary', { data: {}, headers: { 'idempotency-key': crypto.randomUUID() } });
  expect(res.ok(), `summary ${res.status()}`);
  expect(!(await stand()).last.includes('ความลับของบอส'), 'the private note was sent to the model');
  await boss.page.request.post(BASE + '/api/tasks/t-p6/ai-summary', { data: {}, headers: { 'idempotency-key': crypto.randomUUID() } });
  expect((await stand()).last.includes('ความลับของบอส'), 'the worker’s own note should reach their own summary');
});

await step('the group’s week, summarised on ภาพรวม', boss.page, async () => {
  await boss.page.goto(BASE + '/?p=reports');
  await boss.page.getByRole('button', { name: 'สรุปสัปดาห์นี้' }).click();
  await boss.page.getByText('สรุปสัปดาห์นี้โดย AI').waitFor({ timeout: 8000 });
  await boss.page.getByText(/ตัวแทนโมเดล: ปิด/).waitFor({ timeout: 8000 });
});

await step('training: a Member cannot opt in; a Manager must accept the wording; a confirmed draft is kept, unsend and opt-out delete', boss.page, async () => {
  const no = await may.page.request.patch(BASE + '/api/workspaces/ws-team', { data: { aiTrainingOptIn: true, consentVersion: '2026-10-25' } });
  expect(no.status() === 403, `member ${no.status()}`);
  const noConsent = await boss.page.request.patch(BASE + '/api/workspaces/ws-team', { data: { aiTrainingOptIn: true } });
  expect(noConsent.status() === 400, `without consent ${noConsent.status()}`);
  // Nothing is kept before consent.
  const early = await say('@ทันงาน ช่วยเช็กสต็อกก่อนประชุมนะ');
  const [e] = await q('select id from inbox_item where source_message_id=$1', [early]);
  await webhook([evt({ type: 'postback', source: { type: 'group', groupId: GROUP, userId: BOSS_LINE }, postback: { data: `action=confirm&inbox=${e.id}` } })]);
  await sleep(1500);
  expect((await q('select count(*)::int n from ai_training_example'))[0].n === 0, 'kept without consent');

  const yes = await boss.page.request.patch(BASE + '/api/workspaces/ws-team', { data: { aiTrainingOptIn: true, consentVersion: '2026-10-25' } });
  expect(yes.ok(), `opt in ${yes.status()}`);
  const [ws] = await q("select ai_training_opt_in, ai_training_consent_by, ai_training_consent_version from workspace where id='ws-team'");
  expect(ws.ai_training_opt_in && ws.ai_training_consent_by === 'u-boss' && ws.ai_training_consent_version === '2026-10-25', JSON.stringify(ws));

  const mid = await say('@ทันงาน ช่วยนับของในคลังก่อนประชุมนะ');
  const [d] = await q('select id from inbox_item where source_message_id=$1', [mid]);
  // Confirmed in the app this time.
  const ok = await boss.page.request.post(BASE + `/api/inbox/${d.id}/confirm`, { data: {}, headers: { 'idempotency-key': crypto.randomUUID() } });
  expect(ok.ok(), `confirm ${ok.status()}`);
  const [ex] = await q('select * from ai_training_example where line_message_id=$1', [mid]);
  expect(ex && ex.source_text.includes('นับของในคลัง') && ex.ai_reading, 'not kept');

  await webhook([evt({ type: 'unsend', source: { type: 'group', groupId: GROUP, userId: BOSS_LINE }, unsend: { messageId: mid } })]);
  await sleep(1500);
  expect((await q('select count(*)::int n from ai_training_example'))[0].n === 0, 'unsend did not delete it');

  const again = await say('@ทันงาน ช่วยจัดโต๊ะก่อนประชุมนะ');
  const [g] = await q('select id from inbox_item where source_message_id=$1', [again]);
  await boss.page.request.post(BASE + `/api/inbox/${g.id}/confirm`, { data: { title: 'จัดโต๊ะประชุม' }, headers: { 'idempotency-key': crypto.randomUUID() } });
  const [fixed] = await q('select corrected from ai_training_example where line_message_id=$1', [again]);
  expect(fixed && fixed.corrected === true, 'a corrected title not marked corrected');
  const off = await boss.page.request.patch(BASE + '/api/workspaces/ws-team', { data: { aiTrainingOptIn: false } });
  expect((await off.json()).deleted === 1, 'opt-out did not report the deletion');
  expect((await q('select count(*)::int n from ai_training_example'))[0].n === 0, 'opt-out kept examples');
});

await browser.close();
summary();

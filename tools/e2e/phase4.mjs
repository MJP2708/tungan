// Phase 4: announcements (once per person, X to close, owners/admins only)
// and ทุกคน / @All tasks (one copy each, shown once, progress in the sheet).
import crypto from 'node:crypto';
import { launch, person, step, summary, q, expect, sleep, BASE, pool } from './lib.mjs';
const browser = await launch();
const boss = await person(browser, 'tok-boss-e2e');
const may = await person(browser, 'tok-may-e2e');
const popup = (page) => page.locator('.announcement-dialog');

await step('a member cannot post an announcement (checked on the server)', may.page, async () => {
  const res = await may.page.request.post(BASE + '/api/workspaces/ws-team/announcements', {
    data: { title: 'ไม่ควรได้', body: '' },
  });
  expect(res.status() === 403, `status ${res.status()}`);
  expect((await q("select count(*)::int n from announcement"))[0].n === 0, 'stored anyway');
});

await step('the owner posts one from ทีม → ประกาศ', boss.page, async () => {
  const p = boss.page;
  await p.goto(BASE + '/?p=manage', { waitUntil: 'networkidle' });
  await p.locator('.manage-tabs button', { hasText: 'ประกาศ' }).click();
  const form = p.locator('.announce-composer');
  await form.locator('input[name="announceTitle"]').fill('E2E ประชุมทีมย้ายเป็นศุกร์ 10:00');
  await form.locator('textarea[name="announceBody"]').fill('ห้องประชุมใหญ่ ชั้น 3');
  await form.locator('button[type="submit"]').click();
  await sleep(1000);
  const [a] = await q("select * from announcement where title like 'E2E ประชุม%'");
  expect(a && a.author_user_id === 'u-boss', 'not stored');
  await p.locator('.announce-item', { hasText: 'E2E ประชุมทีม' }).waitFor({ timeout: 5000 });
  expect(!(await popup(p).isVisible()), 'the author got a popup for their own announcement');
});

await step('เมย์ sees it as a popup when she opens the app; X closes it for good', may.page, async () => {
  const p = may.page;
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await popup(p).waitFor({ timeout: 6000 });
  expect((await popup(p).innerText()).includes('E2E ประชุมทีมย้ายเป็นศุกร์'), 'wrong popup');
  await popup(p).getByRole('button', { name: 'Close' }).click();
  await sleep(800);
  expect(!(await popup(p).isVisible()), 'still open');
  const [r] = await q("select * from announcement_read where user_id='u-may'");
  expect(r, 'closing was not recorded');
  await p.reload({ waitUntil: 'networkidle' });
  await sleep(800);
  expect(!(await popup(p).isVisible()), 'it came back after a reload');
});

await step('two new announcements come one after the other with รับทราบ', may.page, async () => {
  for (const title of ['E2E ประกาศหนึ่ง', 'E2E ประกาศสอง']) {
    const res = await boss.page.request.post(BASE + '/api/workspaces/ws-team/announcements', { data: { title, body: '' } });
    expect(res.status() === 201, `post ${res.status()}`);
    await sleep(20);
  }
  const p = may.page;
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await popup(p).waitFor({ timeout: 6000 });
  expect((await popup(p).innerText()).includes('E2E ประกาศหนึ่ง'), 'oldest first');
  expect((await popup(p).innerText()).includes('1/2'), 'shows how many');
  await popup(p).getByRole('button', { name: /รับทราบ/ }).click();
  await sleep(500);
  expect((await popup(p).innerText()).includes('E2E ประกาศสอง'), 'the next one follows');
  await popup(p).getByRole('button', { name: /รับทราบ/ }).click();
  await sleep(800);
  expect(!(await popup(p).isVisible()), 'none left');
  expect((await q("select count(*)::int n from announcement_read where user_id='u-may'"))[0].n === 3, 'all three recorded');
});

const TITLE = 'E2E ส่ง timesheet ทุกคน';
await step('the owner gives a task to ทุกคน: one copy each, linked', boss.page, async () => {
  const p = boss.page;
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'สร้างงาน' }).first().click();
  const dlg = p.locator('.task-create-dialog');
  await dlg.locator('input[name="title"]').fill(TITLE);
  await dlg.locator('.themed-field-trigger').first().click();
  await p.getByRole('option', { name: /ทุกคนในพื้นที่งาน/ }).click();
  await dlg.getByRole('button', { name: /^พรุ่งนี้/ }).first().click();
  await dlg.locator('button[type="submit"]').click();
  await dlg.waitFor({ state: 'hidden' });
  await sleep(800);
  const rows = await q('select * from task where title=$1', [TITLE]);
  expect(rows.length === 2, `copies ${rows.length}`);
  expect(rows.map((r) => r.assignee_user_id).sort().join() === ['u-may', 'u-nont'].sort().join(), 'wrong people');
  expect(rows[0].batch_id && rows[0].batch_id === rows[1].batch_id, 'not linked');
});

await step('งาน lists it once for the owner, with progress', boss.page, async () => {
  const p = boss.page;
  await p.goto(BASE + '/?p=tasks', { waitUntil: 'networkidle' });
  const rows = p.locator('.task-row', { hasText: TITLE });
  expect((await rows.count()) === 1, `rows ${await rows.count()}`);
  expect((await rows.first().innerText()).includes('ทุกคน · เสร็จ 0/2'), await rows.first().innerText());
});

await step('เมย์ has her own copy; the sheet shows everyone and updates when she finishes', may.page, async () => {
  const p = may.page;
  await p.goto(BASE + '/?p=tasks', { waitUntil: 'networkidle' });
  await p.locator('.task-row', { hasText: TITLE }).first().click();
  const sheet = p.locator('.task-detail');
  await sheet.waitFor();
  expect((await sheet.locator('.batch-person').count()) === 2, 'not everyone listed');
  // Done through the API to keep the step short; the UI path is phase 1.
  const [mine] = await q("select id from task where title=$1 and assignee_user_id='u-may'", [TITLE]);
  await q("update task set status='done' where id=$1", [mine.id]);
  await boss.page.goto(BASE + '/?p=tasks', { waitUntil: 'networkidle' });
  const row = boss.page.locator('.task-row', { hasText: TITLE }).first();
  expect((await row.innerText()).includes('เสร็จ 1/2'), await row.innerText());
});

await step('@All in the LINE group becomes a ทุกคน draft; confirming in the app makes the copies', boss.page, async () => {
  const id = `e2e-all-${Date.now()}`;
  const text = '@ทันงาน @All อัปเดตสต็อกในชีต พรุ่งนี้';
  const body = JSON.stringify({ destination: 'Ue2e', events: [{
    type: 'message', mode: 'active', timestamp: Date.now(), webhookEventId: id,
    deliveryContext: { isRedelivery: false }, replyToken: `rt-${id}`,
    source: { type: 'group', groupId: 'C00000000000000000000000000000001', userId: 'U00000000000000000000000000000b05' },
    message: { id: `m-${id}`, type: 'text', text, mention: { mentionees: [
      { index: 0, length: 7, type: 'user', isSelf: true }, { index: 8, length: 4, type: 'all' },
    ] } },
  }] });
  const sig = crypto.createHmac('sha256', 'e2e-channel-secret').update(body).digest('base64');
  const res = await fetch(BASE + '/api/webhooks/line', { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': sig }, body });
  expect(res.status === 200, `webhook ${res.status}`);
  await sleep(2000);
  const [draft] = await q("select * from inbox_item where suggested_title like '%สต็อก%'");
  expect(draft && draft.assign_all, 'not a ทุกคน draft');
  const p = boss.page;
  await p.goto(BASE + '/?p=inbox', { waitUntil: 'networkidle' });
  const card = p.locator('.capture-card', { hasText: 'สต็อก' });
  expect((await card.innerText()).includes('ทุกคนในพื้นที่งาน'), 'the card does not say ทุกคน');
  await card.getByRole('button', { name: /ยืนยันสร้างงาน/ }).click();
  await sleep(1200);
  const rows = await q("select assignee_user_id, batch_id from task where title like '%สต็อก%'");
  expect(rows.length === 2 && rows[0].batch_id, `copies ${rows.length}`);
});

for (const [who, p] of [['boss', boss], ['เมย์', may]]) {
  if (p.errors.length) console.log(`errors seen by ${who}:`, [...new Set(p.errors)]);
}
await browser.close(); await pool.end();
process.exit(summary() ? 1 : 0);

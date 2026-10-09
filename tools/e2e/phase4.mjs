// Phase 4: announcements (once per person, X to close, owners/admins only)
// and ทุกคน / @All tasks (one copy each, shown once, progress in the sheet).
import crypto from 'node:crypto';
import { launch, person, step, summary, q, expect, sleep, BASE, pool } from './lib.mjs';
const browser = await launch();
const boss = await person(browser, 'tok-boss-e2e');
const may = await person(browser, 'tok-may-e2e');
const popup = (page) => page.locator('.announcement-dialog');
/** Close every announcement waiting for this person, as they would. */
async function closeAnnouncements(page) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  for (let i = 0; i < 10 && (await popup(page).isVisible().catch(() => false)); i += 1) {
    await popup(page).getByRole('button', { name: /รับทราบ/ }).click();
    await sleep(400);
  }
}

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
  // A link that is not a web link is refused before anything is sent.
  await form.locator('input[name="announceLink"]').fill('meet.google.com/abc');
  await form.locator('button[type="submit"]').click();
  await sleep(600);
  expect((await q("select count(*)::int n from announcement"))[0].n === 0, 'a bad link was stored');
  await form.locator('input[name="announceLink"]').fill('https://meet.google.com/e2e-test-abc');
  await form.locator('button[type="submit"]').click();
  await sleep(1000);
  const [a] = await q("select * from announcement where title like 'E2E ประชุม%'");
  expect(a && a.author_user_id === 'u-boss', 'not stored');
  expect(a.link === 'https://meet.google.com/e2e-test-abc', `link ${a.link}`);
  await p.locator('.announce-item', { hasText: 'E2E ประชุมทีม' }).waitFor({ timeout: 5000 });
  // The author gets the same notice as everyone, right away; X closes it.
  await popup(p).waitFor({ timeout: 5000 });
  expect((await popup(p).innerText()).includes('E2E ประชุมทีม'), 'the author did not get the notice');
  await popup(p).getByRole('button', { name: 'Close' }).click();
  await sleep(600);
});

await step('เมย์ sees it as a popup when she opens the app; X closes it for good', may.page, async () => {
  const p = may.page;
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await popup(p).waitFor({ timeout: 6000 });
  expect((await popup(p).innerText()).includes('E2E ประชุมทีมย้ายเป็นศุกร์'), 'wrong popup');
  const join = popup(p).locator('a.announcement-join');
  expect((await join.getAttribute('href')) === 'https://meet.google.com/e2e-test-abc', 'no join link');
  expect((await join.innerText()).includes('Google Meet'), 'join button does not say where');
  await popup(p).getByRole('button', { name: 'Close' }).click();
  await sleep(800);
  expect(!(await popup(p).isVisible()), 'still open');
  const [r] = await q("select * from announcement_read where user_id='u-may'");
  expect(r, 'closing was not recorded');
  await p.reload({ waitUntil: 'networkidle' });
  await sleep(800);
  expect(!(await popup(p).isVisible()), 'it came back after a reload');
});

await step('read receipts: the owner sees who has not seen it; a member gets the count only', boss.page, async () => {
  const [{ n }] = await q("select count(*)::int n from workspace_member where workspace_id='ws-team'");
  const p = boss.page;
  await p.goto(BASE + '/?p=manage', { waitUntil: 'networkidle' });
  await p.locator('.manage-tabs button', { hasText: 'ประกาศ' }).click();
  const item = p.locator('.announce-item', { hasText: 'E2E ประชุมทีม' });
  await item.waitFor({ timeout: 5000 });
  // The owner and เมย์ have both closed it.
  expect((await item.innerText()).includes(`รับทราบแล้ว 2/${n}`), `count: ${await item.innerText()}`);
  if (n > 2) {
    await item.locator('.announce-unread summary').click();
    expect((await item.locator('.announce-unread').innerText()).includes(`ยังไม่เห็น ${n - 2} คน`), 'names missing');
  }
  const res = await may.page.request.get(BASE + '/api/workspaces/ws-team/announcements');
  const [mine] = (await res.json()).announcements.filter((x) => x.title.startsWith('E2E ประชุม'));
  expect(mine.readCount === 2 && mine.unreadNames === null, `member got ${JSON.stringify(mine)}`);
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

await step('an announcement typed in LINE pops up in the app', may.page, async () => {
  const id = `e2e-ann-${Date.now()}`;
  const body = JSON.stringify({ destination: 'Ue2e', events: [{
    type: 'message', mode: 'active', timestamp: Date.now(), webhookEventId: id,
    deliveryContext: { isRedelivery: false }, replyToken: `rt-${id}`,
    source: { type: 'group', groupId: 'C00000000000000000000000000000001', userId: 'U00000000000000000000000000000b05' },
    message: { id: `m-${id}`, type: 'text', text: '@ทันงาน ประกาศ: E2E หยุดทำการวันศุกร์\nสำนักงานปิด 1 วัน' },
  }] });
  const sig = crypto.createHmac('sha256', 'e2e-channel-secret').update(body).digest('base64');
  const res = await fetch(BASE + '/api/webhooks/line', { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': sig }, body });
  expect(res.status === 200, `webhook ${res.status}`);
  await sleep(1500);
  const [a] = await q("select * from announcement where title='E2E หยุดทำการวันศุกร์'");
  expect(a && a.body === 'สำนักงานปิด 1 วัน', 'not stored from LINE');
  const p = may.page;
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await popup(p).waitFor({ timeout: 6000 });
  expect((await popup(p).innerText()).includes('E2E หยุดทำการวันศุกร์'), 'the LINE announcement did not pop up');
  await popup(p).getByRole('button', { name: 'Close' }).click();
  await sleep(500);
});

const TITLE = 'E2E ส่ง timesheet ทุกคน';
await step('the owner gives a task to ทุกคน: one copy each, linked', boss.page, async () => {
  const p = boss.page;
  // The owner has notices of their own waiting now (they see what they post).
  await closeAnnouncements(p);
  await closeAnnouncements(may.page);
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

await step('adding the bot to a new group links it by itself; the first to tag it owns it', boss.page, async () => {
  const GROUP = 'C0000000000000000000000000000e2e';
  const send = async (evt) => {
    const body = JSON.stringify({ destination: 'Ue2e', events: [{
      mode: 'active', timestamp: Date.now(), webhookEventId: `auto-${Date.now()}-${Math.random()}`,
      deliveryContext: { isRedelivery: false }, replyToken: `rt-${Date.now()}`,
      source: { type: 'group', groupId: GROUP, userId: 'U00000000000000000000000000000b05' }, ...evt,
    }] });
    const sig = crypto.createHmac('sha256', 'e2e-channel-secret').update(body).digest('base64');
    const res = await fetch(BASE + '/api/webhooks/line', { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': sig }, body });
    expect(res.status === 200, `webhook ${res.status}`);
    await sleep(1500);
  };
  await send({ type: 'join' });
  await send({ type: 'message', message: { id: `auto-m-${Date.now()}`, type: 'text', text: '@ทันงาน เริ่มใช้ทันงาน พรุ่งนี้' } });
  const [bound] = await q("select gw.workspace_id from group_workspace gw join line_group g on g.id=gw.line_group_id where g.line_group_id=$1", [GROUP]);
  expect(bound, 'not linked');
  const [m] = await q("select role from workspace_member where workspace_id=$1 and user_id='u-boss'", [bound.workspace_id]);
  expect(m && m.role === 'owner', `role ${m?.role}`);
  // And it is simply there in the app's workspace list — no button pressed.
  const p = boss.page;
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('.mobile-project.themed-workspace-trigger').click();
  await p.getByRole('option', { name: /ทีมจาก LINE/ }).first().waitFor({ timeout: 5000 });
  await p.keyboard.press('Escape');
});

/** Open ปฏิทิน on ทีมทดสอบ and pick tomorrow. */
async function calendarTomorrow(page) {
  // Switching workspace goes back to วันนี้, so switch first, then open ปฏิทิน.
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.locator('.mobile-project.themed-workspace-trigger').click();
  await page.getByRole('option', { name: /^ทีมทดสอบ/ }).first().click();
  await sleep(800);
  await page.goto(BASE + '/?p=calendar', { waitUntil: 'networkidle' });
  await sleep(500);
  await page.locator('.month-day.is-today ~ .month-day').first().click();
  await sleep(500);
}

await step('ปฏิทิน: the owner adds a team event; everyone gets a LINE notification planned', boss.page, async () => {
  const p = boss.page;
  await calendarTomorrow(p);
  await p.locator('.calendar-add').click();
  const dialog = p.locator('.event-dialog');
  await dialog.locator('input').first().fill('E2E ประชุมทีมพรุ่งนี้');
  await dialog.getByRole('button', { name: 'ทุกคน', exact: true }).click();
  // Everyone in the workspace, one LINE message each — said before saving.
  // "Everyone" = members and people seen in the team's LINE group, as for ทุกคน tasks.
  const members = (await q(`select user_id from workspace_member where workspace_id='ws-team'
    union select m.user_id from line_group_member m join group_workspace g on g.line_group_id = m.line_group_id
    where g.workspace_id='ws-team' order by user_id`)).map((r) => r.user_id);
  const costLine = await dialog.locator('.event-cost').innerText();
  expect(costLine.includes(`${members.length} คน`), `cost line "${costLine}" for ${members.length} members`);
  await dialog.getByRole('button', { name: 'เพิ่มกิจกรรม' }).click();
  await sleep(1200);
  const [e] = await q("select * from calendar_event where title='E2E ประชุมทีมพรุ่งนี้'");
  expect(e && e.workspace_id === 'ws-team' && e.audience === 'everyone' && e.notify_minutes === 30, `event ${JSON.stringify(e)}`);
  const n = await q("select recipient_user_id, send_at from reminder where event_id=$1 order by recipient_user_id", [e.id]);
  expect(JSON.stringify(n.map((r) => r.recipient_user_id)) === JSON.stringify(members), `notifications ${JSON.stringify(n)} for ${members}`);
  expect(new Date(n[0].send_at).getTime() === new Date(e.starts_at).getTime() - 30 * 60000, 'not 30 minutes before');
  await p.locator('.event-row', { hasText: 'E2E ประชุมทีมพรุ่งนี้' }).waitFor({ timeout: 5000 });
});

await step('ปฏิทิน: เมย์ sees it read-only; it is not in her เตือนฉัน list', may.page, async () => {
  const p = may.page;
  await calendarTomorrow(p);
  await p.locator('.event-row', { hasText: 'E2E ประชุมทีมพรุ่งนี้' }).click();
  await p.locator('.event-dialog').waitFor({ timeout: 5000 });
  expect((await p.locator('.event-dialog input').count()) === 0, 'a member can edit the owner\'s event');
  await p.keyboard.press('Escape');
  const res = await p.request.get(BASE + '/api/reminders?workspaceId=ws-team');
  const titles = (await res.json()).reminders.map((r) => r.title);
  expect(!titles.includes(null) && !titles.some((x) => /ประชุมทีมพรุ่งนี้/.test(x ?? '')), `reminders list ${titles}`);
});

await step('ปฏิทิน: a personal reminder added from the calendar; the owner deletes the event and its notifications go', boss.page, async () => {
  const p = boss.page;
  await calendarTomorrow(p);
  await p.locator('.calendar-add').click();
  const dialog = p.locator('.event-dialog');
  await dialog.getByRole('button', { name: 'เตือนฉัน' }).click();
  await dialog.locator('input').first().fill('E2E โทรหาลูกค้าจากปฏิทิน');
  await dialog.getByRole('button', { name: 'ตั้งเตือน' }).click();
  await sleep(1000);
  const [r] = await q("select * from reminder where note='E2E โทรหาลูกค้าจากปฏิทิน'");
  expect(r && r.recipient_user_id === 'u-boss' && r.event_id === null, `reminder ${JSON.stringify(r)}`);
  await p.locator('.event-row.is-reminder', { hasText: 'E2E โทรหาลูกค้าจากปฏิทิน' }).waitFor({ timeout: 5000 });

  await p.locator('.event-row', { hasText: 'E2E ประชุมทีมพรุ่งนี้' }).click();
  const del = p.locator('.event-dialog').getByRole('button', { name: /ลบกิจกรรมนี้/ });
  await del.click();
  await p.locator('.event-dialog').getByRole('button', { name: /แตะอีกครั้งเพื่อลบ/ }).click();
  await sleep(1000);
  expect((await q("select count(*)::int n from calendar_event where title='E2E ประชุมทีมพรุ่งนี้'"))[0].n === 0, 'event still there');
  expect((await q("select count(*)::int n from reminder where kind='event'"))[0].n === 0, 'its notifications are still planned');
});

for (const [who, p] of [['boss', boss], ['เมย์', may]]) {
  if (p.errors.length) console.log(`errors seen by ${who}:`, [...new Set(p.errors)]);
}
await browser.close(); await pool.end();
process.exit(summary() ? 1 : 0);

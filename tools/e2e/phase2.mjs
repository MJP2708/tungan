// Phase 2: reminders, LINE webhook → drafts → confirm, forward, guards, sweep,
// settings, group setup, team, calendar, reports, cron, logout.
import crypto from 'node:crypto';
import { launch, person, step, summary, q, expect, sleep, BASE, pool } from './lib.mjs';
const browser = await launch();
const boss = await person(browser, 'tok-boss-e2e');
const may = await person(browser, 'tok-may-e2e');
const bkkHour = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }).format(new Date());
const afterFive = bkkHour >= 17;

// ── Reminders ──────────────────────────────────────────────────────────────
const NOTE = 'E2E โทรยืนยันคิวกับลูกค้า';
await step('เมย์ sets a personal reminder; its words are stored', may.page, async () => {
  const p = may.page;
  await p.goto(BASE + '/?p=reminders', { waitUntil: 'networkidle' });
  if (afterFive) {
    const active = await p.locator('.quick-day-switch button.active').innerText();
    expect(active.includes('พรุ่งนี้'), `after 17:00 the default day was "${active}"`);
  }
  await p.getByLabel('เรื่องที่อยากให้เตือน').fill(NOTE);
  await p.locator('.quick-day-switch button', { hasText: 'พรุ่งนี้' }).click();
  await p.locator('.quick-reminder-submit').click();
  await sleep(1200);
  const [r] = await q("select * from reminder where note=$1", [NOTE]);
  expect(r, 'no reminder row with that note');
  expect(r.recipient_user_id === 'u-may', 'recipient');
  await p.getByText(NOTE).first().waitFor({ timeout: 5000 });
});

if (afterFive) {
  await step('a reminder for a time already gone is refused, with the reason', may.page, async () => {
    const p = may.page;
    await p.getByLabel('เรื่องที่อยากให้เตือน').fill('E2E ไม่ควรถูกสร้าง');
    await p.locator('.quick-day-switch button', { hasText: 'วันนี้' }).click();
    await p.locator('.quick-reminder-submit').click();
    await sleep(800);
    expect((await q("select count(*)::int n from reminder where note='E2E ไม่ควรถูกสร้าง'"))[0].n === 0, 'a past reminder was created');
    await p.getByText('เวลานี้ผ่านไปแล้ว').first().waitFor({ timeout: 4000 });
  });
}

await step('snooze moves it and counts the snooze', may.page, async () => {
  const p = may.page;
  await p.goto(BASE + '/?p=reminders', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /เลื่อน 10 นาที/ }).first().click();
  await sleep(1000);
  const [r] = await q("select snooze_count from reminder where note=$1", [NOTE]);
  expect(r.snooze_count === 1, `snooze_count ${r.snooze_count}`);
});

await step('boss cannot see เมย์\'s reminders', boss.page, async () => {
  const res = await boss.page.request.get(BASE + '/api/reminders?workspaceId=ws-team');
  const body = await res.json();
  expect(res.ok(), `status ${res.status()}`);
  expect(!JSON.stringify(body).includes(NOTE), 'boss saw เมย์\'s personal reminder');
});

await step('delete takes two taps, then the reminder is gone', may.page, async () => {
  const p = may.page;
  const del = p.locator('.reminder-delete-link').first();
  await del.click();
  await p.getByText('แตะอีกครั้งเพื่อลบ').first().waitFor({ timeout: 3000 });
  expect((await q("select count(*)::int n from reminder where note=$1", [NOTE]))[0].n === 1, 'deleted on the first tap');
  await del.click();
  await sleep(1000);
  expect((await q("select count(*)::int n from reminder where note=$1", [NOTE]))[0].n === 0, 'still there after two taps');
});

// ── LINE webhook → drafts ──────────────────────────────────────────────────
let evt = 0;
async function lineSays(text, mentionees = [], { eventId } = {}) {
  evt += 1;
  const id = eventId ?? `e2e-evt-${Date.now()}-${evt}`;
  const body = JSON.stringify({ destination: 'Ue2e', events: [{
    type: 'message', mode: 'active', timestamp: Date.now(), webhookEventId: id,
    deliveryContext: { isRedelivery: Boolean(eventId) }, replyToken: `rt-${id}`,
    source: { type: 'group', groupId: 'C00000000000000000000000000000001', userId: 'U00000000000000000000000000000b05' },
    message: { id: `m-${id}`, type: 'text', text, mention: { mentionees } },
  }] });
  const sig = crypto.createHmac('sha256', 'e2e-channel-secret').update(body).digest('base64');
  const res = await fetch(BASE + '/api/webhooks/line', { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': sig }, body });
  return { status: res.status, id, body };
}
const MSG1 = '@ทันงาน @เมย์ ส่งรายงานประจำสัปดาห์ พรุ่งนี้ 10 โมง';
let first;
await step('a forged webhook (bad signature) is rejected', null, async () => {
  const res = await fetch(BASE + '/api/webhooks/line', { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': 'bad' }, body: '{"events":[]}' });
  expect(res.status === 401 || res.status === 403, `status ${res.status}`);
});
await step('three tagged messages in the group become three drafts', null, async () => {
  first = await lineSays(MSG1, [
    { index: 0, length: 7, type: 'user', isSelf: true },
    { index: 8, length: 5, type: 'user', userId: 'U00000000000000000000000000000a11' },
  ]);
  expect(first.status === 200, `webhook ${first.status}`);
  await lineSays('@ทันงาน โทรหาลูกค้า ABC พรุ่งนี้บ่าย 2', [{ index: 0, length: 7, type: 'user', isSelf: true }]);
  await lineSays('@ทันงาน จองห้องประชุมใหญ่ พรุ่งนี้', [{ index: 0, length: 7, type: 'user', isSelf: true }]);
  await sleep(2500);
  const drafts = await q("select * from inbox_item where workspace_id='ws-team' and state='pending' order by created_at");
  expect(drafts.length === 3, `drafts ${drafts.length}`);
  const d1 = drafts.find((d) => d.suggested_title.includes('รายงาน'));
  expect(d1 && d1.suggested_assignee_user_id === 'u-may', `assignee ${d1?.suggested_assignee_user_id}`);
  expect(d1.suggested_due_at, 'no deadline read');
});
await step('LINE redelivering the same event makes no second draft', null, async () => {
  const before = (await q("select count(*)::int n from inbox_item"))[0].n;
  const sig = crypto.createHmac('sha256', 'e2e-channel-secret').update(first.body).digest('base64');
  await fetch(BASE + '/api/webhooks/line', { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': sig }, body: first.body });
  await sleep(1500);
  expect((await q("select count(*)::int n from inbox_item"))[0].n === before, 'duplicate draft');
});
await step('an untagged message is ignored', null, async () => {
  const before = (await q("select count(*)::int n from inbox_item"))[0].n;
  await lineSays('ใครว่างช่วยดูงานนี้หน่อย');
  await sleep(1200);
  expect((await q("select count(*)::int n from inbox_item"))[0].n === before, 'untagged text became a draft');
});
await step('boss sees the drafts in จาก LINE, with a badge', boss.page, async () => {
  const p = boss.page;
  await p.goto(BASE + '/?p=inbox', { waitUntil: 'networkidle' });
  await p.locator('.capture-card').first().waitFor();
  expect((await p.locator('.capture-card').count()) === 3, `cards ${await p.locator('.capture-card').count()}`);
  const badge = await p.locator('nav.mobile-nav button', { hasText: 'LINE' }).locator('i').innerText();
  expect(badge.trim() === '3', `badge ${badge}`);
});
await step('boss edits a draft before creating it', boss.page, async () => {
  const p = boss.page;
  const card = p.locator('.capture-card', { hasText: 'รายงาน' }).first();
  await card.getByRole('button', { name: /แก้ชื่อ/ }).click();
  const dlg = p.locator('.task-create-dialog');
  await dlg.locator('input[name="title"]').fill('E2E ส่งรายงานสัปดาห์ (แก้แล้ว)');
  await dlg.locator('button[type="submit"]').click();
  await dlg.waitFor({ state: 'hidden' });
  await sleep(1000);
  const [t] = await q("select * from task where title='E2E ส่งรายงานสัปดาห์ (แก้แล้ว)'");
  expect(t, 'no task with the edited title');
  expect(t.assignee_user_id === 'u-may', `assignee ${t.assignee_user_id}`);
  const [d] = await q("select state from inbox_item where suggested_title like '%รายงาน%'");
  expect(d.state === 'created', `draft state ${d.state}`);
});
await step('ไม่ใช่งาน dismisses a draft', boss.page, async () => {
  const p = boss.page;
  await p.goto(BASE + '/?p=inbox', { waitUntil: 'networkidle' });
  await p.locator('.capture-card', { hasText: 'จองห้อง' }).getByRole('button', { name: /ไม่ใช่งาน/ }).click();
  await sleep(1000);
  const [d] = await q("select state from inbox_item where suggested_title like '%จองห้อง%'");
  expect(d.state === 'dismissed', `state ${d.state}`);
});
await step('ยืนยันสร้างงาน creates exactly one task', boss.page, async () => {
  const p = boss.page;
  await p.goto(BASE + '/?p=inbox', { waitUntil: 'networkidle' });
  const btn = p.locator('.capture-card', { hasText: 'โทรหาลูกค้า' }).getByRole('button', { name: /ยืนยันสร้างงาน/ });
  await btn.click();
  await sleep(1200);
  const n = (await q("select count(*)::int n from task where title like '%โทรหาลูกค้า ABC%'"))[0].n;
  expect(n === 1, `tasks ${n}`);
});

// ── Forward a message by hand ──────────────────────────────────────────────
await step('นำข้อความเข้า turns a pasted message into a task', boss.page, async () => {
  const p = boss.page;
  await p.goto(BASE + '/?p=inbox', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'นำข้อความเข้า' }).click();
  const form = p.locator('form', { has: p.locator('textarea[name="message"]') });
  await form.locator('textarea[name="message"]').fill('พี่ช่วยเช็คสต็อกของหน้าร้านพรุ่งนี้ด้วยนะ');
  const title = form.locator('input[name="title"]');
  await title.fill('E2E เช็คสต็อกหน้าร้าน');
  if (afterFive) {
    const day = await form.locator('button.active, [aria-pressed="true"]').first().innerText().catch(() => '');
    expect(!day.trim().startsWith('วันนี้'), `after 17:00 the forward form defaulted to "${day}"`);
  }
  await form.locator('button[type="submit"]').click();
  await sleep(1200);
  const [t] = await q("select * from task where title='E2E เช็คสต็อกหน้าร้าน'");
  expect(t, 'no task');
  expect(new Date(t.due_at) > new Date(), 'born late');
});

// ── Create-task guard ──────────────────────────────────────────────────────
if (afterFive) {
  await step('a new task for a time already gone is refused, with the reason', boss.page, async () => {
    const p = boss.page;
    await p.goto(BASE + '/', { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'สร้างงาน' }).first().click();
    const dlg = p.locator('.task-create-dialog');
    const chosen = await dlg.locator('button', { hasText: /^พรุ่งนี้/ }).first().getAttribute('class');
    expect(/active|selected/.test(chosen ?? ''), `after 17:00 the default day was not พรุ่งนี้ (${chosen})`);
    await dlg.locator('input[name="title"]').fill('E2E ไม่ควรถูกสร้าง');
    await dlg.locator('button', { hasText: /^วันนี้/ }).first().click();
    await dlg.locator('button[type="submit"]').click();
    await dlg.getByText('เวลานี้ผ่านไปแล้ว').waitFor({ timeout: 4000 });
    expect((await q("select count(*)::int n from task where title='E2E ไม่ควรถูกสร้าง'"))[0].n === 0, 'created anyway');
    await dlg.getByRole('button', { name: 'ยกเลิก' }).click();
  });
}

// ── วันนี้: end-of-day sweep ───────────────────────────────────────────────
if (afterFive) {
  await step('after the cutoff วันนี้ lists work nobody touched today', boss.page, async () => {
    const p = boss.page;
    await p.goto(BASE + '/', { waitUntil: 'networkidle' });
    const card = p.locator('.sweep-card');
    await card.waitFor({ timeout: 6000 });
    await card.getByText('งานค้างจากเมื่อวาน').click();
    await p.locator('.task-detail').waitFor();
    await p.keyboard.press('Escape');
  });
}

// ── Settings ───────────────────────────────────────────────────────────────
await step('a nickname saved in ตั้งค่า survives a reload', boss.page, async () => {
  const p = boss.page;
  await p.goto(BASE + '/?p=settings', { waitUntil: 'networkidle' });
  const input = p.locator('input[name="displayName"]');
  await input.fill('บอส E2E');
  await p.getByRole('button', { name: 'บันทึกชื่อ' }).click();
  await sleep(1200);
  const [m] = await q("select nickname from workspace_member where user_id='u-boss' and workspace_id='ws-team'");
  expect(m.nickname === 'บอส E2E', `stored "${m.nickname}"`);
  await p.reload({ waitUntil: 'networkidle' });
  await sleep(600);
  expect((await p.locator('input[name="displayName"]').inputValue()) === 'บอส E2E', 'not shown after reload');
});
await step('renaming the workspace is stored', boss.page, async () => {
  const p = boss.page;
  await p.getByRole('button', { name: 'เปลี่ยนชื่อ' }).first().click();
  const dlg = p.locator('.action-sheet-dialog');
  await dlg.locator('input').first().fill('ทีมทดสอบ E2E');
  await dlg.locator('button[type="submit"]').click();
  await sleep(1000);
  const [w] = await q("select name from workspace where id='ws-team'");
  expect(w.name === 'ทีมทดสอบ E2E', `name ${w.name}`);
});

// ── Group setup ────────────────────────────────────────────────────────────
await step('one tap gives an unconnected group its own workspace', boss.page, async () => {
  const p = boss.page;
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'สร้างพื้นที่งานของกลุ่มนี้' }).first().click();
  await sleep(1500);
  const [b] = await q("select w.name from group_workspace gw join workspace w on w.id=gw.workspace_id where gw.line_group_id='g-client'");
  expect(b, 'not bound');
  expect(b.name.includes('ลูกค้า ABC'), `named ${b.name}`);
});

// ── Team, calendar, reports ────────────────────────────────────────────────
await step('switching workspace in the picker loads that workspace', boss.page, async () => {
  const p = boss.page;
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.locator('.mobile-project.themed-workspace-trigger').click();
  await p.getByRole('option', { name: /ทีมทดสอบ E2E/ }).first().click();
  await sleep(1200);
  await p.goto(BASE + '/?p=tasks', { waitUntil: 'networkidle' });
  await p.locator('.task-row', { hasText: 'งานค้างจากเมื่อวาน' }).first().waitFor({ timeout: 6000 });
});
await step('a reload reopens the same workspace', boss.page, async () => {
  const p = boss.page;
  await p.reload({ waitUntil: 'networkidle' });
  await sleep(600);
  const name = await p.locator('.mobile-project.themed-workspace-trigger').innerText();
  expect(name.includes('ทีมทดสอบ E2E'), 'reopened in ' + name.replace(/\s+/g, ' '));
});
await step('ทีม lists เมย์, and ทีมย่อย is no longer offered', boss.page, async () => {
  const p = boss.page;
  await p.goto(BASE + '/?p=manage', { waitUntil: 'networkidle' });
  await p.getByText('เมย์').first().waitFor({ timeout: 6000 });
  const tabs = await p.locator('.manage-tabs button').allInnerTexts();
  expect(!tabs.some((t) => t.includes('ทีมย่อย')), 'ทีมย่อย still offered');
});
await step('a new workspace opens empty, and the old one keeps its members', boss.page, async () => {
  const p = boss.page;
  await p.locator('.manage-tabs button', { hasText: 'พื้นที่งาน' }).click();
  await p.getByRole('button', { name: /เพิ่มพื้นที่/ }).click();
  await p.locator('input[name="projectName"]').fill('E2E พื้นที่ใหม่');
  await p.getByRole('button', { name: 'สร้างพื้นที่' }).click();
  await sleep(1500);
  const [w] = await q("select id from workspace where name='E2E พื้นที่ใหม่'");
  expect(w, 'workspace not created');
  await p.goto(BASE + '/?p=tasks', { waitUntil: 'networkidle' });
  await sleep(500);
  expect((await p.locator('.task-row').count()) === 0, 'the new workspace shows the old tasks');
  await p.locator('.mobile-project.themed-workspace-trigger').click();
  await p.getByRole('option', { name: /ทีมทดสอบ E2E/ }).first().click();
  await sleep(1200);
  await p.goto(BASE + '/?p=manage', { waitUntil: 'networkidle' });
  await p.getByText('เมย์').first().waitFor({ timeout: 6000 });
});
await step('กำหนดส่ง and ภาพรวม load without errors', boss.page, async () => {
  const p = boss.page;
  const before = boss.errors.length;
  await p.goto(BASE + '/?p=calendar', { waitUntil: 'networkidle' });
  // The month calendar: today marked once; its count is the list below it,
  // and every task listed is due today (Bangkok) in the database.
  const today = p.locator('.month-day.is-today');
  expect((await today.count()) === 1, 'today is not marked once');
  const shown = Number((await today.locator('small').textContent().catch(() => '0')) || 0);
  const titles = await p.locator('.calendar-agenda .task-row strong').allTextContents();
  expect(shown === titles.length, `today's cell says ${shown}, the list has ${titles.length}`);
  for (const title of titles) {
    const rows = await q(`select 1 from task where title = $1
      and (due_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date`, [title]);
    expect(rows.length > 0, `"${title}" is listed today but not due today`);
  }
  await p.goto(BASE + '/?p=reports', { waitUntil: 'networkidle' });
  await p.getByRole('heading', { name: 'ต้องดูตอนนี้' }).waitFor({ timeout: 6000 });
  await p.getByRole('heading', { name: 'แต่ละคน' }).waitFor({ timeout: 6000 });
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const [res] = await Promise.all([
    p.waitForResponse((r) => r.url().includes('/summary'), { timeout: 8000 }),
    p.getByRole('button', { name: /คัดลอกสรุปงาน/ }).click(),
  ]);
  expect(res.ok(), `summary ${res.status()}`);
  expect(boss.errors.length === before, `errors: ${boss.errors.slice(before).join(' | ')}`);
});

// ── Cron ───────────────────────────────────────────────────────────────────
await step('the reminder cron refuses a wrong secret and runs with the right one', null, async () => {
  const bad = await fetch(BASE + '/api/cron/reminders', { method: 'POST', headers: { authorization: 'Bearer nope' } });
  expect(bad.status === 401, `bad secret ${bad.status}`);
  const when = new Date(Date.now() - 60000).toISOString();
  await q("insert into reminder (id, workspace_id, recipient_user_id, kind, note, send_at, original_send_at) values ('r-e2e-due','ws-team','u-may','manual','E2E ถึงเวลาแล้ว',$1,$1)", [when]);
  const ok = await fetch(BASE + '/api/cron/reminders', { method: 'POST', headers: { authorization: 'Bearer e2e-cron' } });
  const body = await ok.json();
  expect(ok.status === 200, `cron ${ok.status}`);
  expect(body.claimed === 1, `claimed ${JSON.stringify(body)}`);
  // LINE refuses the fake token, so it must NOT be recorded as sent.
  const [r] = await q("select state from reminder where id='r-e2e-due'");
  expect(r.state !== 'sent', 'marked sent although LINE refused');
});

// ── Logout ─────────────────────────────────────────────────────────────────
await step('ออกจากระบบ ends the session', may.page, async () => {
  const p = may.page;
  await p.goto(BASE + '/?p=settings', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /ออกจากระบบ/ }).click();
  await p.waitForURL(/\/login/, { timeout: 8000 });
  const n = (await q("select count(*)::int n from session where user_id='u-may'"))[0].n;
  expect(n === 0, `sessions left ${n}`);
});

for (const [who, p] of [['boss', boss], ['เมย์', may]]) {
  if (p.errors.length) console.log(`errors seen by ${who}:`, [...new Set(p.errors)]);
}
await browser.close(); await pool.end();
process.exit(summary() ? 1 : 0);

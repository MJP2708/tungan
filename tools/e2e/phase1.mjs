// Phase 1: create → accept → blocked → evidence → submit → revision → submit → approve.
import { launch, person, step, summary, q, expect, sleep, BASE, pool } from './lib.mjs';
const browser = await launch();
const boss = await person(browser, 'tok-boss-e2e');
const may = await person(browser, 'tok-may-e2e');
const TITLE = 'E2E ส่งใบเสนอราคา ' + Date.now().toString().slice(-5);
const task = async () => (await q('select * from task where title=$1', [TITLE]))[0];

async function openTask(page, title) {
  await page.goto(BASE + '/?p=tasks', { waitUntil: 'networkidle' });
  await page.locator('.task-row', { hasText: title }).first().click();
  await page.locator('.task-detail').waitFor({ state: 'visible' });
  await sleep(300);
}
const sheet = (page) => page.locator('.task-detail');

await step('boss creates a task for เมย์ due tomorrow', boss.page, async () => {
  const p = boss.page;
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'สร้างงาน' }).first().click();
  const dlg = p.locator('.task-create-dialog');
  await dlg.locator('input[name="title"]').fill(TITLE);
  await dlg.locator('.themed-field-trigger').first().click();
  await p.getByRole('option', { name: /เมย์/ }).first().click();
  await dlg.getByRole('button', { name: /^พรุ่งนี้/ }).first().click();
  await dlg.locator('button[type="submit"]').click();
  await dlg.waitFor({ state: 'hidden' });
  const t = await task();
  expect(t, 'no task row');
  expect(t.assignee_user_id === 'u-may', `assignee ${t.assignee_user_id}`);
  expect(t.due_at, 'no deadline');
  expect(t.created_by_user_id === 'u-boss', 'creator');
});

await step('the task shows in เมย์\'s list', may.page, async () => {
  await may.page.goto(BASE + '/?p=tasks', { waitUntil: 'networkidle' });
  await may.page.locator('.task-row', { hasText: TITLE }).first().waitFor();
});

await step('เมย์ accepts (รับงาน)', may.page, async () => {
  await openTask(may.page, TITLE);
  await sheet(may.page).getByRole('button', { name: 'รับงาน', exact: true }).click();
  await sleep(800);
  expect((await task()).status === 'progress', `status ${(await task()).status}`);
});

await step('เมย์ reports a blocker with a preset reason', may.page, async () => {
  await openTask(may.page, TITLE);
  await sheet(may.page).getByRole('button', { name: 'ติดปัญหา', exact: true }).click();
  const dlg = may.page.locator('.action-sheet-dialog');
  await dlg.locator('[role="radiogroup"] button').first().click();
  await dlg.locator('textarea').fill('รอไฟล์จากลูกค้า');
  await dlg.locator('button[type="submit"]').click();
  await dlg.waitFor({ state: 'hidden' });
  await sleep(600);
  const t = await task();
  expect(t.status === 'blocked', `status ${t.status}`);
  expect(t.blocked_reason, 'no reason stored');
});

await step('เมย์ adds an evidence link', may.page, async () => {
  await openTask(may.page, TITLE);
  const s = sheet(may.page);
  const add = s.getByRole('button', { name: /วางลิงก์หลักฐานชิ้นแรก|เพิ่ม$/ }).first();
  await add.click();
  const dlg = may.page.locator('[data-slot="dialog-content"]').filter({ has: may.page.locator('input[name="url"]') });
  await dlg.locator('input[name="url"]').fill('https://example.com/quote.pdf');
  await dlg.getByRole('button', { name: 'เพิ่มลิงก์' }).click();
  await dlg.waitFor({ state: 'hidden' });
  await sleep(800);
  expect((await task()).evidence_url === 'https://example.com/quote.pdf', `evidence ${(await task()).evidence_url}`);
});

await step('เมย์ submits for review (ส่งตรวจ)', may.page, async () => {
  await openTask(may.page, TITLE);
  await sheet(may.page).getByRole('button', { name: /ส่งตรวจ/ }).first().click();
  await sleep(1000);
  const t = await task();
  expect(t.status === 'review', `status ${t.status}`);
  expect(t.reviewer_user_id === 'u-boss', `reviewer ${t.reviewer_user_id}`);
});

await step('boss asks for a revision with a new deadline', boss.page, async () => {
  await openTask(boss.page, TITLE);
  await sheet(boss.page).getByRole('button', { name: 'ขอแก้' }).first().click();
  const dlg = boss.page.locator('.action-sheet-dialog');
  await dlg.locator('[role="radiogroup"] button').first().click();
  await dlg.locator('textarea').fill('แก้ราคาหน้า 2');
  await dlg.locator('button[type="submit"]').click();
  await dlg.waitFor({ state: 'hidden' });
  await sleep(800);
  const t = await task();
  expect(t.status === 'progress', `status ${t.status}`);
});

await step('เมย์ resubmits, boss approves (อนุมัติ)', boss.page, async () => {
  await openTask(may.page, TITLE);
  await sheet(may.page).getByRole('button', { name: /ส่งตรวจ/ }).first().click();
  // Wait for the database rather than a fixed second: a slow save on a busy
  // machine made this step fail once while the app was right.
  const until = async (status) => {
    for (let i = 0; i < 30 && (await task()).status !== status; i += 1) await sleep(200);
    return task();
  };
  expect((await until('review')).status === 'review', `status after resubmit ${(await task()).status}`);
  await openTask(boss.page, TITLE);
  await sheet(boss.page).getByRole('button', { name: /^อนุมัติ/ }).first().click();
  const t = await until('done');
  expect(t.status === 'done', `status ${t.status}`);
  expect(t.closed_at, 'closed_at not set');
});

await step('the history records each step', null, async () => {
  const kinds = (await q('select kind from task_event where task_id=$1 order by at', [(await task()).id])).map((r) => r.kind);
  for (const k of ['accepted', 'blocked', 'submitted', 'revision', 'approved']) {
    expect(kinds.some((x) => x.includes(k.slice(0, 5))), `missing ${k} in ${kinds.join(',')}`);
  }
});

for (const [who, p] of [['boss', boss], ['เมย์', may]]) {
  if (p.errors.length) console.log(`errors seen by ${who}:`, [...new Set(p.errors)]);
}
await browser.close(); await pool.end();
process.exit(summary() ? 1 : 0);

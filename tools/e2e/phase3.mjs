// Phase 3: ask + answer, handoff + accept, edit, undo.
import { launch, person, step, summary, q, expect, sleep, BASE, pool } from './lib.mjs';
const browser = await launch();
const boss = await person(browser, 'tok-boss-e2e');
const may = await person(browser, 'tok-may-e2e');
const ID = 't-e2e-p3';
await q(`insert into task (id, workspace_id, title, assignee_user_id, primary_assignee_user_id, created_by_user_id, due_at)
         values ($1,'ws-team','E2E งานสำหรับส่งต่อ','u-may','u-may','u-boss', now() + interval '1 day')`, [ID]);
const task = async () => (await q('select * from task where id=$1', [ID]))[0];
const sheet = (page) => page.locator('.task-detail');
async function open(page) {
  // The way a LINE DM opens it: a deep link to the task.
  await page.goto(BASE + `/?task=${ID}`, { waitUntil: 'networkidle' });
  await sheet(page).waitFor({ state: 'visible' });
  await sleep(400);
}

await step('วันนี้ offers each task its next step: รับงาน from the row', may.page, async () => {
  await q(`insert into task (id, workspace_id, title, assignee_user_id, primary_assignee_user_id, created_by_user_id, due_at)
           values ('t-e2e-home','ws-team','E2E งานจากหน้าวันนี้','u-may','u-may','u-boss', now() + interval '1 day')`);
  await may.page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const row = may.page.locator('.today-row', { hasText: 'E2E งานจากหน้าวันนี้' });
  await row.getByRole('button', { name: 'รับงาน', exact: true }).click();
  await sleep(900);
  const [t] = await q("select status, accepted_at from task where id='t-e2e-home'");
  expect(t.status === 'progress' && t.accepted_at, `status ${t.status}`);
});

await step('เมย์ accepts from a deep link', may.page, async () => {
  await open(may.page);
  await sheet(may.page).getByRole('button', { name: 'รับงาน', exact: true }).click();
  await sleep(800);
  expect((await task()).status === 'progress', 'not accepted');
});

await step('เมย์ asks the boss a question (ขอข้อมูลเพิ่ม)', may.page, async () => {
  await open(may.page);
  await sheet(may.page).getByRole('button', { name: /ขอข้อมูลเพิ่ม/ }).click();
  const dlg = may.page.locator('.action-sheet-dialog');
  await dlg.locator('textarea').fill('ลูกค้าต้องการกี่ชุด?');
  await dlg.locator('button[type="submit"]').click();
  await dlg.waitFor({ state: 'hidden' });
  await sleep(800);
  const [qq] = await q('select * from task_question where task_id=$1', [ID]);
  expect(qq, 'no question stored');
  expect(qq.asked_of_user_id === 'u-boss', `asked ${qq.asked_of_user_id}`);
});

await step('the boss answers it from the task', boss.page, async () => {
  await open(boss.page);
  await sheet(boss.page).getByRole('button', { name: 'ตอบ', exact: true }).click();
  const dlg = boss.page.locator('.action-sheet-dialog');
  await dlg.locator('textarea').fill('20 ชุด');
  await dlg.locator('button[type="submit"]').click();
  await dlg.waitFor({ state: 'hidden' });
  await sleep(800);
  const [qq] = await q('select * from task_question where task_id=$1', [ID]);
  expect(qq.answered_at, 'not answered');
  expect(qq.answer === '20 ชุด', `answer ${qq.answer}`);
});

await step('เมย์ hands the work to the boss; it waits for the boss to accept', may.page, async () => {
  await open(may.page);
  const section = sheet(may.page).locator('.delegate-section');
  // ส่งงานต่อ is folded away since the redesign; open it first.
  await section.locator('summary').click();
  await section.locator('.themed-field-trigger').click();
  await may.page.getByRole('option', { name: /หัวหน้าบอส/ }).first().click();
  await section.getByRole('button', { name: 'ส่งต่อ', exact: true }).click();
  await sleep(900);
  const t = await task();
  expect(t.pending_assignee_user_id === 'u-boss', `pending ${t.pending_assignee_user_id}`);
  expect(t.assignee_user_id === 'u-may', 'moved before it was accepted');
});

await step('the hand-off waits in the boss\u2019s รอคุณ on วันนี้', boss.page, async () => {
  await boss.page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const row = boss.page.locator('.today-row', { hasText: 'E2E งานสำหรับส่งต่อ' });
  await row.waitFor({ timeout: 6000 });
  await row.getByRole('button', { name: 'ดู', exact: true }).click();
  await sheet(boss.page).getByRole('button', { name: /รับงานที่ส่งต่อมา/ }).waitFor();
  await boss.page.keyboard.press('Escape');
});

await step('the boss accepts the handoff', boss.page, async () => {
  await open(boss.page);
  await sheet(boss.page).getByRole('button', { name: /รับงานที่ส่งต่อมา/ }).click();
  await sleep(900);
  const t = await task();
  expect(t.assignee_user_id === 'u-boss', `assignee ${t.assignee_user_id}`);
  expect(!t.pending_assignee_user_id, 'still pending');
});

await step('the boss edits the title', boss.page, async () => {
  await open(boss.page);
  await sheet(boss.page).getByRole('button', { name: /แก้ไขงาน/ }).click();
  const dlg = boss.page.locator('.task-create-dialog');
  await dlg.locator('input[name="title"]').fill('E2E งานสำหรับส่งต่อ (แก้ชื่อ)');
  await dlg.locator('button[type="submit"]').click();
  await dlg.waitFor({ state: 'hidden' });
  await sleep(800);
  expect((await task()).title === 'E2E งานสำหรับส่งต่อ (แก้ชื่อ)', `title ${(await task()).title}`);
});

await step('ยกเลิก on the toast undoes the last change', boss.page, async () => {
  await open(boss.page);
  const before = (await task()).status;
  await sheet(boss.page).getByRole('button', { name: 'ติดปัญหา', exact: true }).click();
  const dlg = boss.page.locator('.action-sheet-dialog');
  await dlg.locator('[role="radiogroup"] button').first().click();
  await dlg.locator('button[type="submit"]').click();
  await sleep(900);
  expect((await task()).status === 'blocked', 'not blocked');
  await boss.page.getByRole('button', { name: 'ยกเลิก', exact: true }).last().click();
  await sleep(1000);
  expect((await task()).status === before, `after undo ${(await task()).status}, expected ${before}`);
});

await step('ลบงานนี้ takes two taps, then the task is gone for everyone', boss.page, async () => {
  await open(boss.page);
  const del = sheet(boss.page).getByRole('button', { name: /ลบงานนี้/ });
  await del.click();
  await sheet(boss.page).getByText('แตะอีกครั้งเพื่อลบงานนี้').waitFor({ timeout: 3000 });
  expect(await task(), 'deleted on the first tap');
  await sheet(boss.page).getByRole('button', { name: /แตะอีกครั้งเพื่อลบงานนี้/ }).click();
  await sleep(1000);
  expect(!(await task()), 'still there after two taps');
});

for (const [who, p] of [['boss', boss], ['เมย์', may]]) {
  if (p.errors.length) console.log(`errors seen by ${who}:`, [...new Set(p.errors)]);
}
await browser.close(); await pool.end();
process.exit(summary() ? 1 : 0);

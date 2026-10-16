// Phase 5 (2026-10-17): roles (MEMBER / MANAGER), can() on every entry
// point, personal tasks and งานฉัน — through the real API with real sessions
// and through real signed webhooks, every result checked in the database.
import crypto from 'node:crypto';
import { launch, person, step, summary, q, expect, sleep, BASE, pool } from './lib.mjs';

const browser = await launch();
const boss = await person(browser, 'tok-boss-e2e'); // Manager of ws-team
const may = await person(browser, 'tok-may-e2e'); // Member of ws-team
const GROUP = 'C00000000000000000000000000000001';
const MAY_LINE = 'U00000000000000000000000000000a11';
const soon = () => new Date(Date.now() + 2 * 86400000).toISOString();

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
  const id = `e2e-p5-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { mode: 'active', timestamp: Date.now(), webhookEventId: id, deliveryContext: { isRedelivery: false }, replyToken: `rt-${id}`, ...extra };
};

// A task waiting for review: assigned to เมย์, asked for by her (a Member).
await q(`insert into task (id, workspace_id, title, assignee_user_id, created_by_user_id, status, review_state, due_at)
         values ('t-p5', 'ws-team', 'E2E รอตรวจ', 'u-may', 'u-may', 'review', 'review', now() + interval '1 day')`);
const statusOf = async (id) => (await q('select status, due_at, assignee_user_id from task where id=$1', [id]))[0];

await step('a Member calling the Manager endpoints directly is refused, and nothing changes', may.page, async () => {
  const r = may.page.request;
  const approve = await r.post(BASE + '/api/tasks/t-p5/status', { data: { action: 'approve' } });
  const revision = await r.post(BASE + '/api/tasks/t-p5/status', { data: { action: 'revision', note: 'x', dueAt: soon() } });
  const deadline = await r.patch(BASE + '/api/tasks/t-p5', { data: { dueAt: soon() } });
  const reassign = await r.patch(BASE + '/api/tasks/t-p5', { data: { assigneeUserId: 'u-boss' } });
  const role = await r.patch(BASE + '/api/workspaces/ws-team/members/u-may/role', { data: { role: 'manager' } });
  const roleOther = await r.patch(BASE + '/api/workspaces/ws-team/members/u-boss/role', { data: { role: 'member' } });
  for (const [name, res] of Object.entries({ approve, revision, deadline, reassign, role, roleOther })) {
    expect(res.status() === 403, `${name}: ${res.status()}`);
  }
  const t = await statusOf('t-p5');
  expect(t.status === 'review' && t.assignee_user_id === 'u-may', `changed: ${JSON.stringify(t)}`);
  const [{ n }] = await q("select count(*)::int n from workspace_member where workspace_id='ws-team' and role='manager'");
  expect(n === 1, `managers ${n}`);
});

await step('the same approval as a forged, correctly signed LINE postback from the Member is refused', null, async () => {
  const res = await webhook([evt({ type: 'postback', source: { type: 'group', groupId: GROUP, userId: MAY_LINE }, postback: { data: 'action=status&do=approve&task=t-p5' } })]);
  expect(res.status === 200, `webhook ${res.status}`);
  await sleep(1500);
  expect((await statusOf('t-p5')).status === 'review', 'the postback closed it');
});

await step('the Manager changes the deadline: allowed, and in the audit log', boss.page, async () => {
  const due = soon();
  const res = await boss.page.request.patch(BASE + '/api/tasks/t-p5', { data: { dueAt: due } });
  expect(res.ok(), `patch ${res.status()}`);
  const [log] = await q("select * from audit_log where action='deadline_changed' and target_task_id='t-p5'");
  expect(log && log.actor_user_id === 'u-boss', 'not logged');
});

await step('a private ติดปัญหา note never reaches another Member through any API', may.page, async () => {
  await q(`insert into task (id, workspace_id, title, assignee_user_id, created_by_user_id, status, review_state)
           values ('t-secret', 'ws-team', 'E2E งานบอส', 'u-boss', 'u-boss', 'blocked', 'working')`);
  await q(`insert into task_event (id, task_id, workspace_id, actor_user_id, kind, detail, visibility)
           values ('ev-secret', 't-secret', 'ws-team', 'u-boss', 'blocked', 'ติดปัญหา: ความลับของบอส', 'private')`);
  for (const path of ['/api/tasks/t-secret', '/api/tasks/t-secret/review', '/api/workspaces/ws-team/blocked']) {
    const text = await (await may.page.request.get(BASE + path)).text();
    expect(!text.includes('ความลับของบอส'), `leaked by ${path}`);
  }
  const own = await (await boss.page.request.get(BASE + '/api/tasks/t-secret')).text();
  expect(own.includes('ความลับของบอส'), 'the worker (a Manager here) cannot read their own note');
});

await step('a personal task is only its maker’s: the Manager gets 404 and never sees it in งานฉัน', boss.page, async () => {
  // เมย์'s personal workspace and a personal task in it.
  await q(`insert into workspace (id, name, kind, created_by_user_id) values ('ws-may-own', 'งานของฉัน', 'personal', 'u-may')`);
  await q(`insert into workspace_member (workspace_id, user_id, role) values ('ws-may-own', 'u-may', 'manager')`);
  await q(`insert into task (id, workspace_id, title, assignee_user_id, created_by_user_id, status, review_state)
           values ('t-own', 'ws-may-own', 'E2E นัดหมอฟัน', 'u-may', 'u-may', 'progress', 'working')`);
  const get = await boss.page.request.get(BASE + '/api/tasks/t-own');
  expect(get.status() === 404, `boss GET ${get.status()}`);
  const close = await boss.page.request.post(BASE + '/api/tasks/t-own/status', { data: { action: 'approve' } });
  expect(close.status() === 404, `boss approve ${close.status()}`);
  const bossMine = await (await boss.page.request.get(BASE + '/api/me/tasks')).json();
  expect(!bossMine.tasks.some((t) => t.id === 't-own'), 'in the Manager’s งานฉัน');
});

await step('its maker closes a personal task directly; a group task still cannot be closed by its assignee', may.page, async () => {
  const mine = await (await may.page.request.get(BASE + '/api/me/tasks')).json();
  expect(mine.tasks.some((t) => t.id === 't-own' && t.personal && t.groupName === null), 'not in her งานฉัน');
  const close = await may.page.request.post(BASE + '/api/tasks/t-own/status', { data: { action: 'approve' } });
  expect(close.ok(), `close ${close.status()}`);
  expect((await statusOf('t-own')).status === 'done', 'not closed');
  const group = await may.page.request.post(BASE + '/api/tasks/t-p5/status', { data: { action: 'approve' } });
  expect(group.status() === 403, `group task ${group.status()}`);
});

await step('roles: the Member sees the list read-only; the Manager promotes her, and nobody changes their own role', boss.page, async () => {
  const m = may.page;
  await m.goto(BASE + '/?p=manage', { waitUntil: 'networkidle' });
  await m.locator('.manage-tabs button', { hasText: 'สมาชิก' }).click();
  await m.locator('.role-note').waitFor({ timeout: 5000 });
  expect((await m.locator('.role-change').count()) === 0, 'a Member sees role buttons');

  const p = boss.page;
  await p.goto(BASE + '/?p=manage', { waitUntil: 'networkidle' });
  await p.locator('.manage-tabs button', { hasText: 'สมาชิก' }).click();
  // The role button sits right after its person's row button.
  const roleButtonOf = (name) =>
    p.locator('.member-list > button:not(.role-change)', { hasText: name })
      .locator('xpath=following-sibling::button[1][contains(@class, "role-change")]');
  await roleButtonOf('เมย์').click();
  await p.getByRole('button', { name: 'ยืนยัน' }).click();
  await sleep(1200);
  const [{ role }] = await q("select role from workspace_member where workspace_id='ws-team' and user_id='u-may'");
  expect(role === 'manager', `role ${role}`);
  expect((await q("select count(*)::int n from audit_log where action='role_changed'"))[0].n === 1, 'not logged');
  // Your own row never has the button.
  expect((await roleButtonOf('หัวหน้าบอส').count()) === 0, 'own row has a button');
  const self = await p.request.patch(BASE + '/api/workspaces/ws-team/members/u-boss/role', { data: { role: 'member' } });
  expect(self.status() === 403, `self ${self.status()}`);
});

await step('the last Manager cannot be demoted, and the error says why', boss.page, async () => {
  // เมย์ demotes บอส (two Managers → one), then nobody can demote her.
  const ok = await may.page.request.patch(BASE + '/api/workspaces/ws-team/members/u-boss/role', { data: { role: 'member' } });
  expect(ok.ok(), `demote ${ok.status()}`);
  // บอส set the group up, so as a Member he may still name Managers — but not
  // demote the last one.
  const last = await boss.page.request.patch(BASE + '/api/workspaces/ws-team/members/u-may/role', { data: { role: 'member' } });
  expect(last.status() === 409, `last ${last.status()}`);
  expect(((await last.json()).error ?? '').includes('อย่างน้อยหนึ่งคน'), 'no reason given');
});

await step('งานฉัน shows every task of mine in sections, across groups', may.page, async () => {
  await q(`insert into task (id, workspace_id, title, assignee_user_id, created_by_user_id, status, review_state, due_at)
           values ('t-late', 'ws-team', 'E2E เลยแล้ว', 'u-may', 'u-boss', 'progress', 'working', now() - interval '3 hours'),
                  ('t-back', 'ws-team', 'E2E ส่งกลับ', 'u-may', 'u-boss', 'progress', 'revision', now() + interval '3 days')`);
  const p = may.page;
  await p.goto(BASE + '/?p=mine', { waitUntil: 'networkidle' });
  await p.locator('.mine-section').first().waitFor({ timeout: 6000 });
  const order = await p.locator('.mine-section h3').allTextContents();
  expect(order[0].startsWith('ส่งกลับแก้ไข'), `first section ${order[0]}`);
  expect(order.some((t) => t.startsWith('เลยกำหนด')), `sections ${order}`);
  const text = await p.locator('.mine-page').innerText();
  expect(text.includes('E2E เลยแล้ว') && text.includes('E2E ส่งกลับ'), 'tasks missing');
  expect(!text.includes('E2E งานบอส'), 'someone else’s task listed');
});

await step('"@ทันงาน งานฉัน" in the group is answered, not drafted as a task (reply content: tests/roles-db.test.ts)', null, async () => {
  const before = (await q('select count(*)::int n from inbox_item'))[0].n;
  const res = await webhook([evt({ type: 'message', source: { type: 'group', groupId: GROUP, userId: MAY_LINE }, message: { id: `m-${Date.now()}`, type: 'text', text: '@ทันงาน งานฉัน' } })]);
  expect(res.status === 200, `webhook ${res.status}`);
  await sleep(1500);
  expect((await q('select count(*)::int n from inbox_item'))[0].n === before, 'drafted as a task');
});

for (const [who, p] of [['boss', boss], ['เมย์', may]]) {
  if (p.errors.length) console.log(`errors seen by ${who}:`, [...new Set(p.errors)]);
}
await browser.close(); await pool.end();
process.exit(summary() ? 1 : 0);

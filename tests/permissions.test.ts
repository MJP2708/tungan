// can() — the only place a role is decided (lib/permissions.ts, 2026-10-17).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { can, roleOf, type Action, type GroupFacts, type TaskFacts } from '../lib/permissions.ts';

const team = (role: GroupFacts['role'], over: Partial<GroupFacts> = {}): GroupFacts => ({
  role,
  kind: 'team',
  managerCount: 1,
  createdByUserId: 'founder',
  ...over,
});
const TASK: TaskFacts = { assigneeUserId: 'worker', createdByUserId: 'asker', primaryAssigneeUserId: null };
const me = (userId: string) => ({ userId });

const MANAGER_ONLY: Action[] = [
  'approve_task',
  'request_revision',
  'reassign_task',
  'change_deadline',
  'view_blocked_reason',
  'edit_group_settings',
];

test('a Member is refused every Manager-only action, even on a task they asked for', () => {
  for (const action of MANAGER_ONLY) {
    assert.equal(can(me('asker'), action, team('member'), TASK), false, action);
    assert.equal(can(me('worker'), action, team('member'), TASK), false, `${action} as the worker`);
  }
  assert.equal(can(me('asker'), 'change_member_role', team('member'), null, { targetUserId: 'worker' }), false);
});

test('a Manager may do them', () => {
  for (const action of MANAGER_ONLY) {
    assert.equal(can(me('boss'), action, team('manager'), TASK), true, action);
  }
});

test('Member and Manager: create, view, and their own task’s progress', () => {
  for (const role of ['member', 'manager'] as const) {
    assert.equal(can(me('x'), 'create_task', team(role)), true);
    assert.equal(can(me('x'), 'view_group_tasks', team(role)), true);
  }
  for (const action of ['update_own_task_progress', 'submit_own_task', 'flag_blocked_own_task', 'view_own_blocked_reason'] as Action[]) {
    assert.equal(can(me('worker'), action, team('member'), TASK), true, action);
    assert.equal(can(me('someone'), action, team('member'), TASK), false, `${action} on someone else’s`);
  }
});

test('not a member of the group: nothing at all', () => {
  for (const action of ['view_group_tasks', 'create_task', 'approve_task', 'update_own_task_progress'] as Action[]) {
    assert.equal(can(me('worker'), action, team(null), TASK), false, action);
  }
});

test('Manager in group A has no rights in group B (the facts are per group)', () => {
  const groupA = team('manager');
  const groupB = team('member');
  assert.equal(can(me('boss'), 'approve_task', groupA, TASK), true);
  assert.equal(can(me('boss'), 'approve_task', groupB, TASK), false);
  assert.equal(can(me('boss'), 'approve_task', team(null), TASK), false);
});

test('nobody changes their own role; Managers change others; the creator is the recovery path', () => {
  assert.equal(can(me('boss'), 'change_member_role', team('manager'), null, { targetUserId: 'boss' }), false);
  assert.equal(can(me('boss'), 'change_member_role', team('manager'), null, { targetUserId: 'worker' }), true);
  // No Manager left: the person who set the group up may still name one.
  assert.equal(
    can(me('founder'), 'change_member_role', team('member', { managerCount: 0 }), null, { targetUserId: 'worker' }),
    true,
  );
  assert.equal(
    can(me('founder'), 'change_member_role', team('member', { managerCount: 0 }), null, { targetUserId: 'founder' }),
    false,
  );
});

test('a Manager cannot approve their own task while another Manager exists; alone, they can', () => {
  const own: TaskFacts = { assigneeUserId: 'boss', createdByUserId: 'boss' };
  assert.equal(can(me('boss'), 'approve_task', team('manager', { managerCount: 2 }), own), false);
  assert.equal(can(me('boss'), 'approve_task', team('manager', { managerCount: 1 }), own), true);
  // Someone else's task: always, as a Manager.
  assert.equal(can(me('boss'), 'approve_task', team('manager', { managerCount: 2 }), TASK), true);
});

test('a group with no Manager: nobody approves; approvals wait', () => {
  assert.equal(can(me('asker'), 'approve_task', team('member', { managerCount: 0 }), TASK), false);
});

test('a personal task is its maker’s alone, and its maker closes it directly', () => {
  const personal: GroupFacts = { role: 'manager', kind: 'personal', managerCount: 1, createdByUserId: 'me' };
  const mine: TaskFacts = { assigneeUserId: 'me', createdByUserId: 'me' };
  // The one exception to submitted ≠ closed: approve_task here is "close".
  assert.equal(can(me('me'), 'approve_task', personal, mine), true);
  assert.equal(can(me('me'), 'view_group_tasks', personal, mine), true);
  // Anyone else — even with a Manager role and even the workspace creator
  // field pointed elsewhere — cannot see or act on it.
  const someoneElse: GroupFacts = { ...personal, createdByUserId: 'boss' };
  assert.equal(can(me('boss'), 'approve_task', someoneElse, mine), false);
  assert.equal(can(me('boss'), 'view_blocked_reason', someoneElse, mine), false);
  assert.equal(can(me('boss'), 'reassign_task', someoneElse, mine), false);
});

test('a group task still cannot be closed by its assignee', () => {
  assert.equal(can(me('worker'), 'approve_task', team('member'), TASK), false);
  assert.equal(can(me('worker'), 'submit_own_task', team('member'), TASK), true);
});

test('unknown role text is never a Manager', () => {
  assert.equal(roleOf('owner'), null);
  assert.equal(roleOf('admin'), null);
  assert.equal(roleOf('MANAGER'), null);
  assert.equal(roleOf('manager'), 'manager');
});

test('no role is compared outside lib/permissions.ts', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && full !== path.join('lib', 'permissions.ts')) {
        const src = fs.readFileSync(full, 'utf8');
        if (/role\s*[!=]==?\s*['"]|['"](owner|admin|manager)['"]\s*[!=]==?\s*\w*role/i.test(src)) offenders.push(full);
        if (/roles:\s*\[\s*['"]/.test(src)) offenders.push(full);
      }
    }
  };
  for (const dir of ['app', 'lib', 'components']) walk(dir);
  assert.deepEqual(offenders, []);
});

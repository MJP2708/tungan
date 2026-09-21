import test from 'node:test';
import assert from 'node:assert/strict';
import { mayActOnTask, mayEditTaskFields } from '../lib/tasks/permissions.ts';

/**
 * One rule for who may change a task.
 *
 * The edit form used to let any workspace member change anyone's task while
 * the status buttons enforced a lock. These pin the shared rule.
 */

const task = {
  assigneeUserId: 'worker',
  primaryAssigneeUserId: 'lead',
  pendingAssigneeUserId: 'offered',
  createdByUserId: 'manager',
};
const member = (userId: string) => ({ userId, role: 'member' });

test('the people responsible may edit the task', () => {
  for (const who of ['worker', 'lead', 'manager']) {
    assert.equal(mayEditTaskFields(task, member(who)), true, who);
  }
  assert.equal(mayEditTaskFields(task, { userId: 'boss', role: 'owner' }), true);
  assert.equal(mayEditTaskFields(task, { userId: 'boss', role: 'admin' }), true);
});

test('a bystander in the same workspace may not', () => {
  assert.equal(mayEditTaskFields(task, member('bystander')), false);
  assert.equal(mayActOnTask(task, member('bystander')), false);
});

test('someone only offered a handoff may answer it, not edit the task', () => {
  assert.equal(mayActOnTask(task, member('offered')), true);
  assert.equal(mayEditTaskFields(task, member('offered')), false);
});

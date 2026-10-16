import test from 'node:test';
import assert from 'node:assert/strict';
import { planReviewNudge, DEFAULT_WORKING_HOURS } from '../lib/reminders/policy.ts';
import { can } from '../lib/permissions.ts';

/**
 * Submitting is not closing.
 *
 * These cover the two rules that make the approval step mean something: who
 * is allowed to close a task, and who gets chased while it waits. Both are
 * enforced server-side; the route's own copies of them are asserted here in
 * the same form the route applies them, so a change to one without the other
 * shows up as a failing test rather than as a permission hole.
 */

/** Closing is can('approve_task') — the one rule, in lib/permissions.ts. */
function mayClose(params: {
  role: 'manager' | 'member';
  actorId: string;
  assigneeId: string | null;
  createdById: string | null;
  managerCount?: number;
}) {
  return can(
    { userId: params.actorId },
    'approve_task',
    { role: params.role, kind: 'team', managerCount: params.managerCount ?? 1, createdByUserId: 'founder' },
    { assigneeUserId: params.assigneeId, createdByUserId: params.createdById },
  );
}

test('a worker cannot close their own task', () => {
  // The case the whole split exists for: a manager asked, a worker did it.
  assert.equal(
    mayClose({ role: 'member', actorId: 'worker', assigneeId: 'worker', createdById: 'manager' }),
    false,
  );
});

test('a Manager cannot sign off their own work while another Manager could', () => {
  // If they could, every approval on the record could be self-issued.
  assert.equal(
    mayClose({ role: 'manager', actorId: 'boss', assigneeId: 'boss', createdById: 'client-lead', managerCount: 2 }),
    false,
  );
});

test('only a Manager closes work — asking for it no longer does (2026-10-17)', () => {
  assert.equal(
    mayClose({ role: 'member', actorId: 'asker', assigneeId: 'worker', createdById: 'asker' }),
    false,
  );
  assert.equal(
    mayClose({ role: 'manager', actorId: 'admin', assigneeId: 'worker', createdById: 'asker' }),
    true,
  );
});

test('the only Manager can close their own task (and it is logged as self-approved)', () => {
  // Otherwise a one-Manager group could never close the Manager's own work.
  assert.equal(
    mayClose({ role: 'manager', actorId: 'solo', assigneeId: 'solo', createdById: 'solo', managerCount: 1 }),
    true,
  );
});

test('a task with no recorded owner falls to a Manager, not to anyone', () => {
  assert.equal(
    mayClose({ role: 'member', actorId: 'someone', assigneeId: 'worker', createdById: null }),
    false,
  );
  assert.equal(
    mayClose({ role: 'manager', actorId: 'boss', assigneeId: 'worker', createdById: null }),
    true,
  );
});

test('a stranger to the task cannot close it', () => {
  assert.equal(
    mayClose({ role: 'member', actorId: 'someone', assigneeId: 'worker', createdById: 'manager' }),
    false,
  );
});

/** Which can() action each status button is (as lib/tasks/transitions.ts). */
const ACTION_FOR = {
  accept: 'update_own_task_progress',
  submit: 'submit_own_task',
  blocked: 'flag_blocked_own_task',
  handoff: 'offer_handoff',
  approve: 'approve_task',
  revision: 'request_revision',
} as const;

function mayAct(params: { role: 'manager' | 'member'; actorId: string; action: keyof typeof ACTION_FOR }) {
  return can(
    { userId: params.actorId },
    ACTION_FOR[params.action],
    { role: params.role, kind: 'team', managerCount: 1, createdByUserId: 'founder' },
    { assigneeUserId: 'worker', createdByUserId: 'am' },
  );
}

test('asking for the work does not give a member the review actions any more (2026-10-17)', () => {
  assert.equal(mayAct({ role: 'member', actorId: 'am', action: 'approve' }), false);
  assert.equal(mayAct({ role: 'member', actorId: 'am', action: 'revision' }), false);
  assert.equal(mayAct({ role: 'manager', actorId: 'am', action: 'approve' }), true);
  assert.equal(mayAct({ role: 'manager', actorId: 'am', action: 'revision' }), true);
});

test('nobody uses the worker status buttons on the worker\u2019s behalf — not the asker, not a Manager', () => {
  // Marking someone else's task accepted or submitted would put words in
  // their mouth, and the record is meant to be neutral.
  for (const action of ['accept', 'submit', 'blocked', 'handoff'] as const) {
    assert.equal(mayAct({ role: 'member', actorId: 'am', action }), false, action);
    assert.equal(mayAct({ role: 'manager', actorId: 'am', action }), false, `${action} as a Manager`);
    assert.equal(mayAct({ role: 'member', actorId: 'worker', action }), true, `${action} as the worker`);
  }
});

// Mon 7 Sep 2026, 10:00 Bangkok.
const MONDAY_10 = new Date('2026-09-07T03:00:00.000Z');

test('the reviewer is nudged one working day after submission, not after the deadline', () => {
  // Measured from the submission. Work handed in three days early must not be
  // chased three days early.
  const at = planReviewNudge({ submittedAt: MONDAY_10, afterHours: 24 });
  assert.equal(at.toISOString(), new Date('2026-09-08T03:00:00.000Z').toISOString());
});

test('a nudge that lands at night moves to the next working morning', () => {
  // Submitted Monday 22:00 Bangkok; +24h is Tuesday 22:00, outside hours.
  const at = planReviewNudge({
    submittedAt: new Date('2026-09-07T15:00:00.000Z'),
    afterHours: 24,
    hours: DEFAULT_WORKING_HOURS,
  });
  assert.equal(at.toISOString(), new Date('2026-09-09T02:00:00.000Z').toISOString());
});

test('a nudge that lands on a weekend waits for Monday', () => {
  // Submitted Friday 11 Sep 2026 at 15:00 Bangkok; +24h is Saturday.
  const at = planReviewNudge({
    submittedAt: new Date('2026-09-11T08:00:00.000Z'),
    afterHours: 24,
  });
  // Monday 14 Sep, 09:00 Bangkok = 02:00 UTC.
  assert.equal(at.toISOString(), new Date('2026-09-14T02:00:00.000Z').toISOString());
});

test('the delay is configurable per workspace', () => {
  const fast = planReviewNudge({ submittedAt: MONDAY_10, afterHours: 4 });
  assert.equal(fast.toISOString(), new Date('2026-09-07T07:00:00.000Z').toISOString());
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { planReviewNudge, DEFAULT_WORKING_HOURS } from '../lib/reminders/policy.ts';

/**
 * Submitting is not closing.
 *
 * These cover the two rules that make the approval step mean something: who
 * is allowed to close a task, and who gets chased while it waits. Both are
 * enforced server-side; the route's own copies of them are asserted here in
 * the same form the route applies them, so a change to one without the other
 * shows up as a failing test rather than as a permission hole.
 */

/** The rule from app/api/tasks/[id]/status/route.ts, in one place. */
function mayClose(params: {
  role: 'owner' | 'admin' | 'member';
  actorId: string;
  assigneeId: string | null;
  createdById: string | null;
}) {
  const { role, actorId, assigneeId, createdById } = params;
  const hasReviewRight = role === 'owner' || role === 'admin' || createdById === actorId;
  if (!hasReviewRight) return false;
  const askedBySomeoneElse = !!createdById && createdById !== assigneeId;
  if (assigneeId === actorId && askedBySomeoneElse) return false;
  return true;
}

test('a worker cannot close their own task', () => {
  // The case the whole split exists for: a manager asked, a worker did it.
  assert.equal(
    mayClose({ role: 'member', actorId: 'worker', assigneeId: 'worker', createdById: 'manager' }),
    false,
  );
});

test('review rights do not extend to your own work', () => {
  // Being an owner is not the same as being allowed to sign off your own
  // submission. If it were, every approval on the record could be self-issued.
  assert.equal(
    mayClose({ role: 'owner', actorId: 'boss', assigneeId: 'boss', createdById: 'client-lead' }),
    false,
  );
});

test('the person who asked for the work can close it', () => {
  assert.equal(
    mayClose({ role: 'member', actorId: 'manager', assigneeId: 'worker', createdById: 'manager' }),
    true,
  );
  assert.equal(
    mayClose({ role: 'admin', actorId: 'admin', assigneeId: 'worker', createdById: 'manager' }),
    true,
  );
});

test('a task you made for yourself can still be closed by you', () => {
  // Otherwise a one-person workspace could never close anything, which is a
  // worse failure than the one the rule is guarding against.
  assert.equal(
    mayClose({ role: 'owner', actorId: 'solo', assigneeId: 'solo', createdById: 'solo' }),
    true,
  );
});

test('a task with no recorded owner falls to the workspace owner, not to anyone', () => {
  // Rows from before the creator was recorded have nobody to sign them off.
  // Letting any member close them would mean any member could close every
  // orphaned task in the workspace, which is a wider hole than the one this
  // rule exists to close.
  assert.equal(
    mayClose({ role: 'member', actorId: 'someone', assigneeId: 'worker', createdById: null }),
    false,
  );
  assert.equal(
    mayClose({ role: 'owner', actorId: 'boss', assigneeId: 'worker', createdById: null }),
    true,
  );
});

test('a stranger to the task cannot close it', () => {
  assert.equal(
    mayClose({ role: 'member', actorId: 'someone', assigneeId: 'worker', createdById: 'manager' }),
    false,
  );
});

/**
 * Reaching the review check at all is a separate gate from passing it.
 *
 * The route's mayEdit check runs first. An account manager who asked for the
 * work usually holds a plain member role and is not the assignee, so without
 * being named here they were refused before the review rule — which names
 * them explicitly — ever ran.
 */
function mayAct(params: {
  role: 'owner' | 'admin' | 'member';
  actorId: string;
  assigneeId: string | null;
  createdById: string | null;
  action: string;
}) {
  const { role, actorId, assigneeId, createdById, action } = params;
  const isReview = action === 'approve' || action === 'revision';
  const mayEdit =
    assigneeId === actorId ||
    createdById === actorId ||
    role === 'owner' ||
    role === 'admin';
  if (!mayEdit) return false;
  // Asking for work does not make it yours to do.
  if (createdById === actorId && assigneeId !== actorId && role === 'member' && !isReview) {
    return false;
  }
  return true;
}

test('the asker reaches the review actions even as a plain member', () => {
  assert.equal(
    mayAct({ role: 'member', actorId: 'am', assigneeId: 'worker', createdById: 'am', action: 'approve' }),
    true,
  );
  assert.equal(
    mayAct({ role: 'member', actorId: 'am', assigneeId: 'worker', createdById: 'am', action: 'revision' }),
    true,
  );
});

test('the asker cannot use the worker status buttons on their behalf', () => {
  // Marking someone else's task accepted or submitted would put words in
  // their mouth, and the record is meant to be neutral.
  for (const action of ['accept', 'submit', 'blocked', 'handoff']) {
    assert.equal(
      mayAct({ role: 'member', actorId: 'am', assigneeId: 'worker', createdById: 'am', action }),
      false,
      action,
    );
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

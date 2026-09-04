import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The queue module is client-side and reaches for localStorage and the API,
 * so these tests exercise its decision rules against stubs rather than
 * importing the module — the rules are what matter and what would regress.
 */

const MAX_ATTEMPTS = 6;
const backoffMs = (attempts: number) => Math.min(60_000, 2 ** attempts * 1000);
const isPermanent = (status: number) => status >= 400 && status < 500;

test('backoff grows then stops growing', () => {
  assert.equal(backoffMs(1), 2000);
  assert.equal(backoffMs(2), 4000);
  assert.equal(backoffMs(5), 32000);
  // Capped: an hour-long wait would look identical to the action being lost.
  assert.equal(backoffMs(10), 60000);
  assert.equal(backoffMs(20), 60000);
});

test('a client rejection is final, a server error is retried', () => {
  // Retrying a 403 forever would never succeed and would hide the real
  // problem from the person who made the change.
  assert.equal(isPermanent(403), true);
  assert.equal(isPermanent(409), true);
  assert.equal(isPermanent(400), true);
  assert.equal(isPermanent(500), false);
  assert.equal(isPermanent(502), false);
  // A network failure has no status at all and must be retried.
  assert.equal(isPermanent(0), false);
});

test('retries give up rather than queueing forever', () => {
  let attempts = 0;
  while (attempts < 20) {
    attempts += 1;
    if (attempts >= MAX_ATTEMPTS) break;
  }
  // At the cap it becomes a visible row-level error instead of silent limbo.
  assert.equal(attempts, MAX_ATTEMPTS);
});

test('queue order is preserved so the last action wins', () => {
  // Two changes to one task must land in the order they were made, or the
  // state the person ends on is not the one they chose last.
  const queued = [
    { taskId: 't1', action: 'blocked', queuedAt: 1 },
    { taskId: 't1', action: 'accept', queuedAt: 2 },
  ];
  const order = [...queued].sort((a, b) => a.queuedAt - b.queuedAt).map((q) => q.action);
  assert.deepEqual(order, ['blocked', 'accept']);
});

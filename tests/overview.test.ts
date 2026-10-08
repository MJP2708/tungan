import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attentionFor,
  teamOverview,
  formatSpan,
  type OverviewTask,
} from '../lib/tasks/overview.ts';

const NOW = new Date('2026-10-08T05:00:00Z'); // 12:00 Bangkok
const ago = (h: number) => new Date(NOW.getTime() - h * 3600000).toISOString();
const ahead = (h: number) => new Date(NOW.getTime() + h * 3600000).toISOString();

let n = 0;
function task(over: Partial<OverviewTask> = {}): OverviewTask {
  n += 1;
  return {
    id: `t${n}`,
    title: `งาน ${n}`,
    status: 'progress',
    dueAt: ahead(72),
    assigneeId: 'u-may',
    acceptedAt: ago(10),
    statusChangedAt: ago(10),
    ...over,
  };
}

test('a task past its deadline is late, however else it looks', () => {
  const hit = attentionFor(task({ dueAt: ago(30), status: 'blocked', acceptedAt: null }), NOW);
  assert.equal(hit?.kind, 'late');
  assert.equal(hit?.forMs, 30 * 3600000);
});

test('handed-in work is never late: it is waiting on the reviewer', () => {
  const hit = attentionFor(task({ status: 'review', dueAt: ago(5), submittedAt: ago(50) }), NOW);
  assert.equal(hit?.kind, 'review');
  assert.equal(hit?.forMs, 50 * 3600000);
});

test('blocked, unassigned and quiet work each get their own reason', () => {
  assert.equal(attentionFor(task({ status: 'blocked' }), NOW)?.kind, 'blocked');
  assert.equal(attentionFor(task({ assigneeId: '' }), NOW)?.kind, 'unassigned');
  assert.equal(attentionFor(task({ statusChangedAt: ago(80) }), NOW)?.kind, 'quiet');
});

test('a fresh unaccepted task is fine; a day old or due soon is not', () => {
  assert.equal(attentionFor(task({ acceptedAt: null, statusChangedAt: ago(2) }), NOW), null);
  assert.equal(
    attentionFor(task({ acceptedAt: null, statusChangedAt: ago(25) }), NOW)?.kind,
    'unaccepted',
  );
  assert.equal(
    attentionFor(task({ acceptedAt: null, statusChangedAt: ago(1), dueAt: ahead(5) }), NOW)?.kind,
    'unaccepted',
  );
  // A hand-off waiting for the new person counts as not accepted.
  assert.equal(
    attentionFor(task({ pendingAssigneeId: 'u-nont', statusChangedAt: ago(30) }), NOW)?.kind,
    'unaccepted',
  );
});

test('healthy and closed work needs nothing', () => {
  assert.equal(attentionFor(task(), NOW), null);
  assert.equal(attentionFor(task({ status: 'done', dueAt: ago(100) }), NOW), null);
  // No deadline is not late.
  assert.equal(attentionFor(task({ dueAt: null }), NOW), null);
});

test('each task is counted once, longest-waiting first', () => {
  const tasks = [
    task({ dueAt: ago(2) }),
    task({ dueAt: ago(48) }),
    task({ status: 'blocked', dueAt: ago(1) }), // late wins over blocked
    task({ status: 'review', submittedAt: ago(3) }),
    task(),
  ];
  const o = teamOverview(tasks, ['u-may'], NOW);
  assert.deepEqual(
    o.attention.late.map((i) => i.task.id),
    [tasks[1].id, tasks[0].id, tasks[2].id],
  );
  assert.equal(o.attention.blocked.length, 0);
  assert.equal(o.attention.review.length, 1);
  assert.equal(o.attentionTotal, 4);
});

test('per-person load counts only what is still with them', () => {
  const tasks = [
    task({ assigneeId: 'u-may', dueAt: ago(3) }),
    task({ assigneeId: 'u-may', dueAt: ahead(24) }),
    task({ assigneeId: 'u-may', status: 'review' }),
    task({ assigneeId: 'u-may', status: 'done', closedAt: ago(1) }),
    task({ assigneeId: 'u-nont', dueAt: ahead(24 * 10) }),
  ];
  const o = teamOverview(tasks, ['u-nont', 'u-may', 'u-boss'], NOW);
  const may = o.people.find((p) => p.memberId === 'u-may')!;
  assert.deepEqual(
    { open: may.open, late: may.late, inReview: may.inReview, dueThisWeek: may.dueThisWeek },
    { open: 2, late: 1, inReview: 1, dueThisWeek: 1 },
  );
  // Whoever has late work comes first.
  assert.equal(o.people[0].memberId, 'u-may');
  assert.equal(o.people.find((p) => p.memberId === 'u-boss')!.open, 0);
});

test('heavy needs both 5+ open and twice the average', () => {
  const lots = Array.from({ length: 6 }, () => task({ assigneeId: 'u-may' }));
  const one = [task({ assigneeId: 'u-nont' })];
  const o = teamOverview([...lots, ...one], ['u-may', 'u-nont', 'u-boss'], NOW);
  assert.equal(o.people.find((p) => p.memberId === 'u-may')!.heavy, true);
  assert.equal(o.people.find((p) => p.memberId === 'u-nont')!.heavy, false);

  // Two people with 2 and 1: nobody is overloaded, whatever the ratio.
  const small = teamOverview(
    [task({ assigneeId: 'a' }), task({ assigneeId: 'a' }), task({ assigneeId: 'b' })],
    ['a', 'b'],
    NOW,
  );
  assert.ok(small.people.every((p) => !p.heavy));
});

test('closed this week and last week are separate windows', () => {
  const o = teamOverview(
    [
      task({ status: 'done', closedAt: ago(24) }),
      task({ status: 'done', closedAt: ago(24 * 6) }),
      task({ status: 'done', closedAt: ago(24 * 8) }),
      task({ status: 'done', closedAt: ago(24 * 20) }),
      task({ status: 'done', closedAt: null }),
    ],
    [],
    NOW,
  );
  assert.equal(o.closedLast7Days, 2);
  assert.equal(o.closedPrevious7Days, 1);
});

test('spans read the way people say them', () => {
  assert.equal(formatSpan(3 * 86400000 + 5000), '3 วัน');
  assert.equal(formatSpan(5 * 3600000), '5 ชม.');
  assert.equal(formatSpan(20 * 60000), 'ไม่ถึงชั่วโมง');
});

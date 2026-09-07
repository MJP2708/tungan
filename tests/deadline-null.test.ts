import test from 'node:test';
import assert from 'node:assert/strict';
import { isOverdue, formatDeadline, relativeDeadline, relativeSince } from '../lib/deadline.ts';

/**
 * A task without a deadline is the ordinary case, not an error.
 *
 * Task.dueAt is `string | null` everywhere it comes from, but these took only
 * `Date | string`, so the null guard was every caller's job — and isOverdue
 * threw on null rather than answering "no". One missed `?? ''` in a render
 * would have taken the page down, which is exactly the kind of crash the app
 * had no error boundary for.
 */

const NOW = new Date('2026-09-07T03:00:00.000Z');

test('no deadline is not an overdue deadline', () => {
  for (const v of [null, undefined, '', 'ไม่ใช่วันที่', new Date('nope')]) {
    assert.equal(isOverdue(v as never, NOW), false, JSON.stringify(String(v)));
  }
});

test('a real past instant is overdue, a future one is not', () => {
  assert.equal(isOverdue('2026-09-01T00:00:00.000Z', NOW), true);
  assert.equal(isOverdue('2026-12-01T00:00:00.000Z', NOW), false);
});

test('every formatter answers instead of throwing', () => {
  for (const v of [null, undefined, '', 'ขยะ']) {
    assert.equal(formatDeadline(v as never, { now: NOW }), 'ไม่มีกำหนด');
    assert.equal(relativeDeadline(v as never, NOW), 'ไม่มีกำหนด');
    assert.equal(relativeSince(v as never, NOW), '');
  }
});

test('the formatters still work on a real instant', () => {
  assert.notEqual(formatDeadline('2026-09-08T10:00:00.000Z', { now: NOW }), 'ไม่มีกำหนด');
  assert.equal(relativeDeadline('2026-09-07T05:00:00.000Z', NOW), 'อีก 2 ชม.');
  assert.equal(relativeDeadline('2026-09-06T03:00:00.000Z', NOW), 'เลย 1 วัน');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planAssigneeNudge,
  planOwnerEscalation,
  nextWorkingMorning,
  isWorkingDay,
  mergeKey,
  DEFAULT_WORKING_HOURS,
} from '../lib/reminders/policy.ts';
import { fromZonedWallClock } from '../lib/deadline.ts';
import { isHelpRequest, helpMessage } from '../lib/line/help.ts';

const bkk = (at: Date | null) =>
  at
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok',
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(at)
    : null;

// Tue 1 Sep 2026, 09:00 Bangkok
const NOW = fromZonedWallClock(2026, 9, 1, 9, 0);

test('the assignee is nudged before the deadline, not after', () => {
  const dueAt = fromZonedWallClock(2026, 9, 1, 16, 0);
  const n = planAssigneeNudge({ dueAt, now: NOW });
  assert.equal(bkk(n.sendAt), '01/09, 14:00');
  assert.ok(n.sendAt!.getTime() < dueAt.getTime());
});

test('once the deadline has passed the assignee is never nudged again', () => {
  // This is the whole point: repetition is what gets a bot muted.
  const dueAt = fromZonedWallClock(2026, 9, 1, 8, 0);
  const n = planAssigneeNudge({ dueAt, now: NOW });
  assert.equal(n.sendAt, null);
  assert.match(n.reason, /ไม่เตือนผู้รับซ้ำ/);
});

test('a blocked task stops nudging the assignee and escalates instead', () => {
  const dueAt = fromZonedWallClock(2026, 9, 2, 16, 0);
  const n = planAssigneeNudge({ dueAt, now: NOW, blocked: true });
  assert.equal(n.sendAt, null);
  assert.match(n.reason, /ติดปัญหา/);
});

test('an early deadline moves the nudge to the start of the working day', () => {
  // Due 09:30; two hours before is 07:30, which nobody reads.
  const dueAt = fromZonedWallClock(2026, 9, 2, 9, 30);
  const n = planAssigneeNudge({ dueAt, now: NOW });
  assert.equal(bkk(n.sendAt), '02/09, 09:00');
  assert.ok(n.sendAt!.getTime() < dueAt.getTime());
});

test('a deadline too close to nudge before produces nothing rather than a late nudge', () => {
  const dueAt = fromZonedWallClock(2026, 9, 1, 10, 0);
  assert.equal(planAssigneeNudge({ dueAt, now: NOW }).sendAt, null);
});

test('the owner is told the next working morning, once', () => {
  const dueAt = fromZonedWallClock(2026, 9, 1, 16, 0);
  const at = planOwnerEscalation({ dueAt, now: NOW });
  assert.equal(bkk(at), '02/09, 09:00');
});

test('a Friday deadline escalates on Monday, not Saturday', () => {
  const friday = fromZonedWallClock(2026, 9, 4, 16, 0);
  assert.equal(bkk(planOwnerEscalation({ dueAt: friday, now: NOW })), '07/09, 09:00');
});

test('weekends are not working days', () => {
  assert.equal(isWorkingDay(fromZonedWallClock(2026, 9, 4, 12, 0)), true);  // Fri
  assert.equal(isWorkingDay(fromZonedWallClock(2026, 9, 5, 12, 0)), false); // Sat
  assert.equal(isWorkingDay(fromZonedWallClock(2026, 9, 6, 12, 0)), false); // Sun
  assert.equal(isWorkingDay(fromZonedWallClock(2026, 9, 7, 12, 0)), true);  // Mon
});

test('nextWorkingMorning always moves forward', () => {
  const at = nextWorkingMorning(fromZonedWallClock(2026, 9, 1, 9, 0), DEFAULT_WORKING_HOURS);
  assert.ok(at.getTime() > fromZonedWallClock(2026, 9, 1, 9, 0).getTime());
});

test('messages to one person close together share a merge key', () => {
  const a = fromZonedWallClock(2026, 9, 1, 14, 0);
  const b = fromZonedWallClock(2026, 9, 1, 14, 10);
  const far = fromZonedWallClock(2026, 9, 1, 15, 0);
  // Same person, minutes apart -> one message, so one recipient charge.
  assert.equal(mergeKey('u1', a), mergeKey('u1', b));
  assert.notEqual(mergeKey('u1', a), mergeKey('u1', far));
  // Different people never merge: push is billed per recipient anyway.
  assert.notEqual(mergeKey('u1', a), mergeKey('u2', a));
});

test('help is recognised in both languages and from a bare mention', () => {
  assert.equal(isHelpRequest('help', false), true);
  assert.equal(isHelpRequest('ช่วยเหลือ', false), true);
  assert.equal(isHelpRequest('วิธีใช้', false), true);
  assert.equal(isHelpRequest('@ทันงาน', true), true);
  assert.equal(isHelpRequest('@ทันงาน ส่งรายงานพรุ่งนี้', true), false);
});

test('help tells an unconnected group what to do first', () => {
  const msg = helpMessage({ isGroup: true, bound: false, appUrl: 'https://x.test' });
  assert.match(msg, /ยังไม่ได้เชื่อมกลุ่ม/);
  const ok = helpMessage({ isGroup: true, bound: true, appUrl: 'https://x.test' });
  assert.match(ok, /@ทันงาน/);
  // States the friend requirement, since reminders silently fail without it.
  assert.match(ok, /แอดบอทเป็นเพื่อน/);
});

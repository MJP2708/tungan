import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleReminder, inQuietHours } from '../lib/reminders/schedule.ts';
import { fromZonedWallClock } from '../lib/deadline.ts';

const QUIET = { start: '21:00', end: '08:00' };

function bkk(at: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

test('quiet hours wrap past midnight', () => {
  assert.equal(inQuietHours(fromZonedWallClock(2026, 9, 1, 22, 0), QUIET), true);
  assert.equal(inQuietHours(fromZonedWallClock(2026, 9, 1, 2, 0), QUIET), true);
  assert.equal(inQuietHours(fromZonedWallClock(2026, 9, 1, 7, 59), QUIET), true);
  assert.equal(inQuietHours(fromZonedWallClock(2026, 9, 1, 8, 0), QUIET), false);
  assert.equal(inQuietHours(fromZonedWallClock(2026, 9, 1, 14, 0), QUIET), false);
});

test('a normal daytime deadline is not shifted', () => {
  const d = scheduleReminder({ dueAt: fromZonedWallClock(2026, 9, 1, 16, 0), quiet: QUIET });
  assert.equal(d.shifted, 'none');
  assert.equal(bkk(d.sendAt), '01/09, 15:00');
});

test('a deadline inside quiet hours reminds BEFORE the window, not the next morning', () => {
  // Due 22:00. Reminding at 08:00 the next day would arrive after the work
  // was due, which is a failure notice rather than a reminder.
  const d = scheduleReminder({ dueAt: fromZonedWallClock(2026, 9, 1, 22, 0), quiet: QUIET });
  assert.equal(d.shifted, 'earlier');
  assert.equal(bkk(d.sendAt), '01/09, 20:59');
  assert.ok(d.sendAt.getTime() < fromZonedWallClock(2026, 9, 1, 22, 0).getTime());
});

test('an early-morning deadline pulls back to the previous evening', () => {
  // Due 02:00 on 2 Sep, inside the window that opened 21:00 on 1 Sep.
  const d = scheduleReminder({ dueAt: fromZonedWallClock(2026, 9, 2, 2, 0), quiet: QUIET });
  assert.equal(d.shifted, 'earlier');
  assert.equal(bkk(d.sendAt), '01/09, 20:59');
});

test('a reminder landing in quiet hours for a later deadline defers to the window close', () => {
  // Due 08:30, one hour before is 07:30 which is inside quiet hours.
  const d = scheduleReminder({ dueAt: fromZonedWallClock(2026, 9, 2, 8, 30), quiet: QUIET });
  assert.equal(d.shifted, 'later');
  assert.equal(bkk(d.sendAt), '02/09, 08:00');
  // Still before the deadline, so it is a real reminder.
  assert.ok(d.sendAt.getTime() < fromZonedWallClock(2026, 9, 2, 8, 30).getTime());
});

test('originalSendAt is the unshifted time, which is what makes dedup work', () => {
  const dueAt = fromZonedWallClock(2026, 9, 1, 22, 0);
  const a = scheduleReminder({ dueAt, quiet: QUIET });
  const b = scheduleReminder({ dueAt, quiet: QUIET });
  // Re-running the scheduler yields the same dedup key, so the unique index
  // on (task, recipient, originalSendAt) rejects the second insert.
  assert.equal(a.originalSendAt.toISOString(), b.originalSendAt.toISOString());
  assert.equal(a.sendAt.toISOString(), b.sendAt.toISOString());
  // And the key is the intended time, not the shifted one — otherwise
  // changing quiet hours would let the same reminder in twice.
  assert.notEqual(a.originalSendAt.toISOString(), a.sendAt.toISOString());
});

test('changing quiet hours does not create a second reminder for the same deadline', () => {
  const dueAt = fromZonedWallClock(2026, 9, 1, 22, 0);
  const before = scheduleReminder({ dueAt, quiet: QUIET });
  const after = scheduleReminder({ dueAt, quiet: { start: '20:00', end: '09:00' } });
  assert.notEqual(before.sendAt.toISOString(), after.sendAt.toISOString());
  // Same dedup key despite a different send time.
  assert.equal(before.originalSendAt.toISOString(), after.originalSendAt.toISOString());
});

test('a disabled quiet window never shifts anything', () => {
  const d = scheduleReminder({
    dueAt: fromZonedWallClock(2026, 9, 1, 23, 0),
    quiet: { start: '00:00', end: '00:00' },
  });
  assert.equal(d.shifted, 'none');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, monthGrid, shiftMonth, tasksByDay, monthTitle, weekdayLabels } from '../lib/calendar.ts';
import { setLocale } from '../lib/i18n/index.ts';

test('a day is the Bangkok calendar day, not the UTC one', () => {
  // 23:30 Bangkok on 9 Oct is 16:30 UTC on 9 Oct; 00:30 Bangkok on 10 Oct
  // is still 9 Oct in UTC.
  assert.equal(dayKey('2026-10-09T16:30:00Z'), '2026-10-09');
  assert.equal(dayKey('2026-10-09T17:30:00Z'), '2026-10-10');
  assert.equal(dayKey(null), null);
  assert.equal(dayKey('not a date'), null);
});

test('the month grid is six Sunday-first weeks around the month', () => {
  const weeks = monthGrid(2026, 10); // 1 Oct 2026 is a Thursday
  assert.equal(weeks.length, 6);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.deepEqual(weeks[0].slice(0, 5).map((d) => [d.key, d.inMonth]), [
    ['2026-09-27', false], ['2026-09-28', false], ['2026-09-29', false],
    ['2026-09-30', false], ['2026-10-01', true],
  ]);
  const inMonth = weeks.flat().filter((d) => d.inMonth);
  assert.equal(inMonth.length, 31);
  assert.equal(inMonth.at(-1)!.key, '2026-10-31');
  // February in a leap year.
  assert.equal(monthGrid(2028, 2).flat().filter((d) => d.inMonth).length, 29);
});

test('months step across the year boundary', () => {
  assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
});

test('tasks group by due day, sorted by time; late counts only open work', () => {
  const now = new Date('2026-10-09T05:00:00Z'); // 12:00 Bangkok
  const map = tasksByDay(
    [
      { id: 'a', dueAt: '2026-10-09T09:00:00Z', status: 'todo' },
      { id: 'b', dueAt: '2026-10-09T02:00:00Z', status: 'progress' }, // 09:00, late
      { id: 'c', dueAt: '2026-10-09T01:00:00Z', status: 'review' }, // handed in: not late
      { id: 'd', dueAt: '2026-10-09T01:00:00Z', status: 'done' },
      { id: 'e', dueAt: null, status: 'todo' },
    ],
    now,
  );
  const day = map.get('2026-10-09')!;
  assert.deepEqual(day.tasks.map((t) => t.id), ['c', 'b', 'a']);
  assert.equal(day.late, 1);
  assert.equal(map.size, 1, 'undated tasks have no day');

  const withDone = tasksByDay([{ id: 'd', dueAt: '2026-10-09T01:00:00Z', status: 'done' }], now, { includeDone: true });
  assert.equal(withDone.get('2026-10-09')!.tasks.length, 1);
  assert.equal(withDone.get('2026-10-09')!.late, 0);
});

test('the month title: Buddhist-era year in Thai, Gregorian in English', () => {
  assert.equal(monthTitle(2026, 10), 'ตุลาคม 2569');
  try {
    setLocale('en');
    assert.equal(monthTitle(2026, 10), 'October 2026');
    assert.deepEqual(weekdayLabels().slice(0, 2), ['Su', 'Mo']);
  } finally {
    setLocale('th');
  }
});

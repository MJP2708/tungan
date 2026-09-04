import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDeadline,
  isOverdue,
  formatDeadline,
  fromZonedWallClock,
  zonedDateParts,
  quickDayDate,
  relativeDeadline,
  relativeSince,
} from '../lib/deadline.ts';

// A fixed reference: Tue 1 Sep 2026, 10:00 Bangkok (03:00 UTC).
const NOW = new Date('2026-09-01T03:00:00.000Z');

/** Read an instant back as Bangkok wall clock, for assertions. */
function bangkok(at: Date) {
  const p = zonedDateParts(at);
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${hm}`;
}

test('deadlines resolve to a real instant in Asia/Bangkok, not a label', () => {
  const r = resolveDeadline('พรุ่งนี้ 16:00', { now: NOW });
  assert.ok(r.at instanceof Date);
  assert.equal(bangkok(r.at), '2026-09-02 16:00');
  // 16:00 Bangkok is 09:00 UTC — the stored instant is timezone-correct.
  assert.equal(r.at.toISOString(), '2026-09-02T09:00:00.000Z');
  assert.equal(r.confidence, 'explicit');
});

test('"ก่อนบ่าย 3" is 15:00 and "ก่อนบ่าย 12" is not 24:00', () => {
  assert.equal(bangkok(resolveDeadline('ก่อนบ่าย 3', { now: NOW }).at), '2026-09-01 15:00');
  // The prototype produced "24:00", which is not a time.
  const noon = resolveDeadline('ก่อนบ่าย 12', { now: NOW });
  assert.equal(bangkok(noon.at), '2026-09-01 12:00');
});

test('"เช้า" works without "พรุ่งนี้" instead of falling back to the cutoff', () => {
  // The prototype only honoured เช้า when พรุ่งนี้ was present, so this
  // silently became 17:00.
  assert.equal(
    bangkok(resolveDeadline('วันนี้เช้า', { now: NOW, cutoff: '17:00' }).at),
    '2026-09-01 09:00',
  );
  assert.equal(
    bangkok(resolveDeadline('พรุ่งนี้เช้า', { now: NOW }).at),
    '2026-09-02 09:00',
  );
});

test('a day with no time uses the workspace cutoff and is marked inferred', () => {
  const r = resolveDeadline('ภายในวันนี้', { now: NOW, cutoff: '17:00' });
  assert.equal(bangkok(r.at), '2026-09-01 17:00');
  assert.equal(r.confidence, 'inferred');
  assert.equal(r.matched.day, 'วันนี้');
  assert.equal(r.matched.time, null);
});

test('unparseable text is reported as fallback so a human can confirm', () => {
  const r = resolveDeadline('เดี๋ยวว่ากันอีกที', { now: NOW });
  assert.equal(r.confidence, 'fallback');
  assert.equal(r.matched.day, null);
  assert.equal(r.matched.time, null);
  // It still yields a usable instant rather than the string "เวลาที่อ่านได้".
  assert.ok(Number.isFinite(r.at.getTime()));
});

test('Thai clock words resolve to the hour a Thai speaker means', () => {
  const cases: Array<[string, string]> = [
    ['พรุ่งนี้ 9 โมงเช้า', '2026-09-02 09:00'],
    ['บ่าย 2 โมง', '2026-09-01 14:00'],
    ['วันนี้ 5 โมงเย็น', '2026-09-01 17:00'],
    ['พรุ่งนี้ 2 ทุ่ม', '2026-09-02 20:00'],
    ['เที่ยง', '2026-09-01 12:00'],
  ];
  for (const [text, expected] of cases) {
    assert.equal(bangkok(resolveDeadline(text, { now: NOW }).at), expected, text);
  }
});

test('"ศุกร์" picks the coming Friday, never today when today is Friday', () => {
  // NOW is a Tuesday -> Friday is 4 Sep.
  assert.equal(bangkok(resolveDeadline('ศุกร์ 15:00', { now: NOW }).at), '2026-09-04 15:00');
  // On a Friday it must mean next Friday, not zero days away.
  const friday = new Date('2026-09-04T03:00:00.000Z');
  assert.equal(
    bangkok(resolveDeadline('ศุกร์ 15:00', { now: friday }).at),
    '2026-09-11 15:00',
  );
});

test('overdue is a timestamp comparison, not a search for the word', () => {
  const past = new Date('2026-09-01T02:00:00.000Z');
  const future = new Date('2026-09-01T04:00:00.000Z');
  assert.equal(isOverdue(past, NOW), true);
  assert.equal(isOverdue(future, NOW), false);
  // Works from stored ISO strings too, and never throws on bad input.
  assert.equal(isOverdue(past.toISOString(), NOW), true);
  assert.equal(isOverdue('not a date', NOW), false);
});

test('a task late by real time is overdue even though no one typed the word', () => {
  // This is the prototype's blind spot: the label carried the meaning.
  const dueAt = fromZonedWallClock(2026, 9, 1, 9, 0);
  assert.equal(isOverdue(dueAt, NOW), true);
  assert.ok(!formatDeadline(dueAt, { now: NOW }).includes('เกินกำหนด'));
});

test('labels are derived from the instant and never written back into it', () => {
  const at = fromZonedWallClock(2026, 9, 2, 16, 0);
  assert.equal(formatDeadline(at, { now: NOW }), 'พรุ่งนี้ 16:00');
  assert.equal(formatDeadline(fromZonedWallClock(2026, 9, 1, 8, 30), { now: NOW }), 'วันนี้ 08:30');
  assert.equal(formatDeadline('not a date'), 'ไม่มีกำหนด');
});

test('changing the cutoff never moves a deadline that already has a time', () => {
  // Section 8 of the brief: a settings change must not silently move tasks.
  const a = resolveDeadline('พรุ่งนี้ 16:00', { now: NOW, cutoff: '17:00' });
  const b = resolveDeadline('พรุ่งนี้ 16:00', { now: NOW, cutoff: '09:00' });
  assert.equal(a.at.toISOString(), b.at.toISOString());
});

test('wall-clock conversion survives a month boundary', () => {
  const r = resolveDeadline('พรุ่งนี้ 09:00', {
    now: new Date('2026-09-30T12:00:00.000Z'),
  });
  assert.equal(bangkok(r.at), '2026-10-01 09:00');
});

test('quick day buttons resolve to the dates they claim', () => {
  const at = (y: number, m: number, d: number, h = 9) => fromZonedWallClock(y, m, d, h, 0);
  const fmt = (r: { year: number; month: number; day: number }) =>
    `${r.year}-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`;

  // Tue 1 Sep 2026
  const tue = at(2026, 9, 1);
  assert.equal(fmt(quickDayDate('today', { now: tue })), '2026-09-01');
  assert.equal(fmt(quickDayDate('tomorrow', { now: tue })), '2026-09-02');
  assert.equal(fmt(quickDayDate('nextweek', { now: tue })), '2026-09-08');
  // Mon–Thu: this week's Friday.
  assert.equal(fmt(quickDayDate('friday', { now: tue })), '2026-09-04');
});

test('"ศุกร์" on a Friday means today, but next Friday after hours', () => {
  const fmt = (r: { year: number; month: number; day: number }) =>
    `${r.year}-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`;
  const fridayMorning = fromZonedWallClock(2026, 9, 4, 9, 0);
  const fridayNight = fromZonedWallClock(2026, 9, 4, 21, 0);
  assert.equal(fmt(quickDayDate('friday', { now: fridayMorning, endOfDay: '18:00' })), '2026-09-04');
  // The week's Friday has effectively gone by then.
  assert.equal(fmt(quickDayDate('friday', { now: fridayNight, endOfDay: '18:00' })), '2026-09-11');
});

test('"ศุกร์" at the weekend means the coming Friday', () => {
  const fmt = (r: { year: number; month: number; day: number }) =>
    `${r.year}-${String(r.month).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`;
  const saturday = fromZonedWallClock(2026, 9, 5, 12, 0);
  assert.equal(fmt(quickDayDate('friday', { now: saturday })), '2026-09-11');
});

test('lists show relative time, which is the question the reader has', () => {
  const now = fromZonedWallClock(2026, 9, 3, 12, 0);
  assert.equal(relativeDeadline(fromZonedWallClock(2026, 9, 3, 14, 0), now), 'อีก 2 ชม.');
  assert.equal(relativeDeadline(fromZonedWallClock(2026, 9, 3, 12, 30), now), 'อีก 30 นาที');
  assert.equal(relativeDeadline(fromZonedWallClock(2026, 9, 5, 12, 0), now), 'อีก 2 วัน');
  // Late reads as late, not as a negative number.
  assert.equal(relativeDeadline(fromZonedWallClock(2026, 9, 2, 12, 0), now), 'เลย 1 วัน');
  assert.equal(relativeDeadline(fromZonedWallClock(2026, 9, 3, 11, 0), now), 'เลย 1 ชม.');
  assert.equal(relativeDeadline(null, now), 'ไม่มีกำหนด');
});

test('time-in-state reads as a duration', () => {
  const now = fromZonedWallClock(2026, 9, 3, 12, 0);
  assert.equal(relativeSince(fromZonedWallClock(2026, 8, 31, 12, 0), now), '3 วัน');
  assert.equal(relativeSince(fromZonedWallClock(2026, 9, 3, 9, 0), now), '3 ชม.');
});

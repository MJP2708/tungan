import test from 'node:test';
import assert from 'node:assert/strict';
import { jevRequest, readJev } from '../lib/ai/jev-questions.ts';
import { routeReading } from '../lib/ai/route.ts';
import type { JevAnswers } from '../lib/ai/jev.ts';
import { fromZonedWallClock } from '../lib/deadline.ts';

const NOW = fromZonedWallClock(2026, 10, 26, 10, 0); // Monday 10:00 Bangkok
const members = [
  { userId: 'u-boss', names: ['บอส'] },
  { userId: 'u-may', names: ['เมย์', 'May'] },
  { userId: 'u-nont', names: ['นนท์'] },
];
const need = { assignee: true, deadline: true };
const noul = (p: number) => ({ type: 'noul' as const, noul: p });
const pick = (c: string) => ({ type: 'choice' as const, choice: c, confidence: 0.9, probabilities: { [c]: 0.9 } });
const people = new Map([['บอส', 'u-boss'], ['เมย์', 'u-may'], ['นนท์', 'u-nont']]);
const read = (answers: JevAnswers) => readJev(answers, { people, need, now: NOW, cutoff: '17:00' });

test('Jev is shown names, never ids, and the bot tag is taken out', () => {
  const req = jevRequest({ text: '@ทันงาน เมย์ ส่งรายงาน', members, senderUserId: 'u-boss', need });
  const sent = JSON.stringify({ state: req.state, questions: req.questions });
  assert.ok(!sent.includes('u-may') && !sent.includes('@ทันงาน'));
  assert.equal(req.state.sender, 'บอส');
  assert.equal(req.people.get('เมย์'), 'u-may');
  assert.match(JSON.stringify(req.questions.assignee), /"บอส":"คนที่ส่งข้อความนี้"/);
  // Only what is missing is asked.
  const onlyTask = jevRequest({ text: 'x', members, need: { assignee: false, deadline: false } });
  assert.deepEqual(Object.keys(onlyTask.questions), ['is_task']);
});

test('the truth table: no, unsure, and yes with what it read', () => {
  assert.equal(read({ is_task: noul(0.1) }).isTask, 'no');
  assert.equal(read({ is_task: noul(0.5), names_person: noul(0.9), assignee: pick('เมย์') }).assigneeUserId, null, 'unsure fills nothing');
  const yes = read({
    is_task: noul(0.9), names_person: noul(0.9), assignee: pick('เมย์'),
    states_deadline: noul(0.9), day_kind: pick('named_weekday'), weekday: pick('wednesday'), week_offset: pick('unqualified'),
    states_time: noul(0.9), time: pick('11:00'),
  });
  assert.equal(yes.assigneeUserId, 'u-may');
  assert.equal(yes.dueAt?.getTime(), fromZonedWallClock(2026, 10, 28, 11, 0).getTime());
  // "Nobody named" is its own question: a Choice always picks somebody.
  assert.equal(read({ is_task: noul(0.9), names_person: noul(0.1), assignee: pick('เมย์') }).assigneeUserId, null);
});

test('code does the calendar: a day of the month rolls to next month, a past time is refused', () => {
  const first = read({ is_task: noul(0.9), states_deadline: noul(0.9), day_kind: pick('calendar_date'), day_of_month: pick('1'), month: pick('not_stated'), states_time: noul(0.1) });
  assert.equal(first.dueAt?.getTime(), fromZonedWallClock(2026, 11, 1, 17, 0).getTime());
  const past = read({ is_task: noul(0.9), states_deadline: noul(0.9), day_kind: pick('today'), states_time: noul(0.9), time: pick('08:00') });
  assert.equal(past.dueAt, null);
  const nextFriday = read({ is_task: noul(0.9), states_deadline: noul(0.9), day_kind: pick('named_weekday'), weekday: pick('friday'), week_offset: pick('next_week'), states_time: noul(0.1) });
  assert.equal(nextFriday.dueAt?.getTime(), fromZonedWallClock(2026, 11, 6, 17, 0).getTime());
});

const base = { members, senderUserId: 'u-boss', now: NOW, cutoff: '17:00' };
const due = fromZonedWallClock(2026, 10, 27, 10, 0);

test('a message the rules read is never sent anywhere', async () => {
  let calls = 0;
  const out = await routeReading(
    { ...base, text: 'เมย์ ส่งรายงาน พรุ่งนี้ 10 โมง', drafts: [{ title: 'เมย์ ส่งรายงาน', assigneeUserId: 'u-may', dueAt: due }] },
    { jev: async () => { calls += 1; return null; }, write: async () => { calls += 1; return null; } },
  );
  assert.equal(calls, 0);
  assert.equal(out.notice, null);
});

test('Jev saying "not a task" marks the draft and the writing model is not asked', async () => {
  let wrote = false;
  const out = await routeReading(
    { ...base, text: '@ทันงาน ขอบคุณครับ', drafts: [{ title: 'ขอบคุณครับ', assigneeUserId: null, dueAt: null }] },
    { jev: async () => ({ is_task: noul(0.05) }), write: async () => { wrote = true; return []; } },
  );
  assert.equal(out.notATask, true);
  assert.equal(out.notice, 'AI: อาจไม่ใช่งาน');
  assert.equal(out.drafts.length, 1, 'the draft stays');
  assert.equal(wrote, false);
});

test('Jev fills the day; the writing model is only asked when words are still needed', async () => {
  let wrote = 0;
  const write = async () => { wrote += 1; return [{ title: 'ดูหน้าร้าน', assigneeUserId: null, dueAt: null, reason: 'r' }]; };
  const filled = await routeReading(
    { ...base, text: '@ทันงาน ช่วยดูหน้าร้าน พรุ่งนี้นะ', drafts: [{ title: 'ดูหน้าร้าน', assigneeUserId: null, dueAt: null }] },
    { jev: async () => ({ is_task: noul(0.9), names_person: noul(0.1), assignee: pick('เมย์'), states_deadline: noul(0.9), day_kind: pick('tomorrow'), states_time: noul(0.1) }), write },
  );
  assert.equal(wrote, 0);
  assert.equal(filled.drafts[0].dueFrom, 'jev');
  assert.equal(filled.drafts[0].dueAt?.getTime(), fromZonedWallClock(2026, 10, 27, 17, 0).getTime());
  assert.match(filled.drafts[0].reason ?? '', /AI อ่านว่า เสร็จ/);
  assert.ok(filled.drafts[0].reading);

  // Jev unsure and nothing read: the writing model is asked.
  await routeReading(
    { ...base, text: '@ทันงาน ช่วยดูหน้าร้าน', drafts: [{ title: 'ดูหน้าร้าน', assigneeUserId: null, dueAt: null }] },
    { jev: async () => ({ is_task: noul(0.5) }), write },
  );
  assert.equal(wrote, 1);
});

test('two people named: Jev is skipped, the writing model splits it, the message deadline covers both', async () => {
  let jevAsked = false;
  const out = await routeReading(
    { ...base, text: '@ทันงาน พรุ่งนี้ 10 โมงเมย์เตรียมของ ส่วนนนท์ไปรับป้าย', drafts: [{ title: 'เมย์เตรียมของ ส่วนนนท์ไปรับป้าย', assigneeUserId: null, dueAt: due }] },
    {
      jev: async () => { jevAsked = true; return null; },
      write: async () => [
        { title: 'เตรียมของ', assigneeUserId: 'u-may', dueAt: null, reason: '' },
        { title: 'ไปรับป้าย', assigneeUserId: 'u-nont', dueAt: null, reason: '' },
      ],
    },
  );
  assert.equal(jevAsked, false);
  assert.deepEqual(out.drafts.map((d) => [d.title, d.assigneeUserId, d.dueAt?.getTime()]), [
    ['เตรียมของ', 'u-may', due.getTime()],
    ['ไปรับป้าย', 'u-nont', due.getTime()],
  ]);
});

test('a failure from either model leaves the rules reading untouched', async () => {
  const out = await routeReading(
    { ...base, text: '@ทันงาน ช่วยดูหน้าร้าน', drafts: [{ title: 'ดูหน้าร้าน', assigneeUserId: null, dueAt: null }] },
    { jev: async () => null, write: async () => null },
  );
  assert.equal(out.notice, null);
  assert.deepEqual(out.drafts.map((d) => [d.title, d.assigneeUserId, d.dueAt]), [['ดูหน้าร้าน', null, null]]);
});

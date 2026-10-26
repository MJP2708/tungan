import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadRequest, mergeReadings, needsModel, parseReadResponse, shouldAskModel } from '../lib/ai/read-message.ts';
import { buildPrioritizeRequest, parsePrioritizeResponse } from '../lib/ai/prioritize.ts';
import { parsePeriodSummary, parseTaskSummary, buildPeriodSummaryRequest } from '../lib/ai/summarize.ts';
import { fromZonedWallClock } from '../lib/deadline.ts';
import type { MyTask } from '../lib/tasks/my-tasks.ts';

const NOW = fromZonedWallClock(2026, 10, 9, 12, 0); // Fri 12:00 Bangkok
const members = [
  { userId: 'u-may', names: ['เมย์', 'May'] },
  { userId: 'u-nont', names: ['นนท์'] },
];

test('the model is asked only when the rules could not read the message', () => {
  assert.equal(needsModel({ title: 'ส่งรายงาน', assigneeUserId: null, dueAt: NOW }), false);
  assert.equal(needsModel({ title: 'ส่งรายงาน', assigneeUserId: 'u-may', dueAt: null }), false);
  assert.equal(needsModel({ title: 'ส่งรายงาน', assigneeUserId: null, dueAt: null }), true);
  assert.equal(needsModel({ title: 'ก'.repeat(80), assigneeUserId: 'u-may', dueAt: NOW }), true, 'a paragraph, not a title');
});

test('people go to the model as refs, never LINE ids', () => {
  const req = buildReadRequest({ text: 'เมย์ ช่วยดูหน้าร้าน', members, senderUserId: 'u-nont', now: NOW });
  assert.ok(!req.user.includes('u-may') && !req.user.includes('u-nont'));
  assert.match(req.user, /"ref":"M1"/);
  assert.match(req.user, /"sender":"M2"/);
  assert.match(req.user, /2026-10-09 12:00/);
  assert.equal(req.refs.get('M1'), 'u-may');
});

test('the answer is checked strictly: invented people dropped, impossible dates refused', () => {
  const refs = new Map([['M1', 'u-may']]);
  const out = parseReadResponse({ tasks: [
    { title: '@เมย์ ส่งใบเสนอราคา', assignee: 'M1', dueDate: '2026-10-10', dueTime: '10:00', reason: 'บอกว่าพรุ่งนี้สิบโมง' },
    { title: 'โทรหาลูกค้า', assignee: 'M9', dueDate: '2026-02-31', dueTime: null, reason: '' },
    { title: '   ', assignee: null, dueDate: null, dueTime: null, reason: 'x' },
  ] }, { refs, cutoff: '17:00' })!;
  assert.equal(out.length, 2, 'a task with no title is dropped');
  assert.equal(out[0].title, 'ส่งใบเสนอราคา', '@mentions stripped');
  assert.equal(out[0].assigneeUserId, 'u-may');
  assert.equal(out[0].dueAt?.getTime(), fromZonedWallClock(2026, 10, 10, 10, 0).getTime());
  assert.equal(out[1].assigneeUserId, null, 'M9 does not exist');
  assert.equal(out[1].dueAt, null, '31 February is not a day');
  assert.equal(parseReadResponse({ nope: true }, { refs, cutoff: '17:00' }), null);
  assert.equal(parseReadResponse('not json', { refs, cutoff: '17:00' }), null);
});

test('a date without a time uses the team’s end of day', () => {
  const [t] = parseReadResponse({ tasks: [{ title: 'ส่งงาน', assignee: null, dueDate: '2026-10-12', dueTime: null, reason: '' }] },
    { refs: new Map(), cutoff: '17:30' })!;
  assert.equal(t.dueAt?.getTime(), fromZonedWallClock(2026, 10, 12, 17, 30).getTime());
});

test('what the rules found stays; the model fills the gaps', () => {
  const due = fromZonedWallClock(2026, 10, 10, 9, 0);
  const merged = mergeReadings(
    [{ title: 'ส่งรายงาน', assigneeUserId: 'u-nont', dueAt: null }],
    [{ title: 'ส่งรายงานประจำเดือน', assigneeUserId: 'u-may', dueAt: due, reason: 'ข้อความบอกพรุ่งนี้เช้า' }],
  );
  assert.equal(merged[0].title, 'ส่งรายงาน', 'a short rules title is kept');
  assert.equal(merged[0].assigneeUserId, 'u-nont', 'the person the rules found is kept');
  assert.equal(merged[0].dueAt?.getTime(), due.getTime(), 'the deadline came from the model');
  assert.equal(merged[0].fromModel, true);
  // Several tasks from one unreadable paragraph.
  const many = mergeReadings(
    [{ title: 'ก'.repeat(90), assigneeUserId: null, dueAt: null }],
    [
      { title: 'จองห้อง', assigneeUserId: null, dueAt: null, reason: '' },
      { title: 'สั่งอาหาร', assigneeUserId: 'u-may', dueAt: null, reason: '' },
    ],
  );
  assert.deepEqual(many.map((m) => m.title), ['จองห้อง', 'สั่งอาหาร']);
  // No answer from the model: the rules reading, untouched.
  assert.equal(mergeReadings([{ title: 'x', assigneeUserId: null, dueAt: null }], [])[0].fromModel, false);
});

const task = (over: Partial<MyTask>): MyTask => ({
  id: 'id', title: 't', dueAt: null, status: 'progress', reviewState: 'working', blockedReason: null,
  workspaceId: 'ws', groupName: 'ทีม', personal: false, ...over,
});

test('priority suggestions: refs only, never a private note, at most 3, and only real tasks', () => {
  const tasks = [
    task({ id: 'a', title: 'เลยแล้ว', dueAt: fromZonedWallClock(2026, 10, 8, 10, 0) }),
    task({ id: 'b', title: 'ติดอยู่', status: 'blocked', blockedReason: 'รอลูกค้า' }),
    task({ id: 'c', title: 'ส่งแล้ว', status: 'review', reviewState: 'review' }),
  ];
  const req = buildPrioritizeRequest(tasks, NOW);
  assert.ok(!req.user.includes('"id"') && !req.user.includes('รอลูกค้า'));
  assert.ok(!req.user.includes('ส่งแล้ว'), 'handed-in work is not mine to do now');
  const picks = parsePrioritizeResponse({ picks: [
    { task: 'T1', reason: 'เลยกำหนดแล้ว' },
    { task: 'T1', reason: 'ซ้ำ' },
    { task: 'T99', reason: 'ไม่มีอยู่จริง' },
    { task: 'T2', reason: '' },
  ] }, req.refs)!;
  assert.deepEqual(picks, [{ taskId: 'a', reason: 'เลยกำหนดแล้ว' }]);
});

test('summaries: empty or malformed answers are refused; lists are capped', () => {
  assert.equal(parseTaskSummary({ summary: '', nextStep: null }), null);
  assert.deepEqual(parseTaskSummary({ summary: 'เสร็จแล้วรอตรวจ', nextStep: '  ' }), { summary: 'เสร็จแล้วรอตรวจ', nextStep: null });
  assert.deepEqual(
    parsePeriodSummary({ summary: 'ปิดไป 3 งาน', highlights: ['a', 3, '', 'b', 'c', 'd', 'e', 'f'] }),
    { summary: 'ปิดไป 3 งาน', highlights: ['a', 'b', 'c', 'd', 'e'] },
  );
  const req = buildPeriodSummaryRequest({
    group: 'ทีม', range: 'week', closed: Array.from({ length: 100 }, (_, i) => `งาน ${i}`),
    created: [], overdue: [], blocked: [], inReview: [],
  });
  assert.equal(JSON.parse(req.user).closed.length, 40);
});

test('a person the message never names, or a deadline already past, is refused', () => {
  const refs = new Map([['M1', 'u-may'], ['M2', 'u-nont']]);
  const out = parseReadResponse({ tasks: [
    { title: 'ส่งของ', assignee: 'M1', dueDate: '2026-10-01', dueTime: null, reason: '' },
    { title: 'นนท์ โทรหาลูกค้า', assignee: 'M2', dueDate: '2026-10-12', dueTime: null, reason: '' },
  ] }, { refs, cutoff: '17:00', text: '@ทันงาน ส่งของ แล้วนนท์โทรหาลูกค้า', members, now: NOW })!;
  assert.equal(out[0].assigneeUserId, null, 'เมย์ is not in the message');
  assert.equal(out[0].dueAt, null, '1 October is before 9 October');
  assert.equal(out[1].assigneeUserId, 'u-nont');
  assert.ok(out[1].dueAt);
});

test('the model is given the next two weeks, so it never counts days itself', () => {
  const req = buildReadRequest({ text: 'x', members, now: NOW });
  const { calendar } = JSON.parse(req.user);
  assert.equal(calendar.length, 15);
  assert.match(calendar[0], /^2026-10-09 วันศุกร์ \(วันนี้\)$/);
  assert.match(calendar[3], /^2026-10-12 วันจันทร์$/);
});

test('two people named in one message are worth asking about, and each task keeps the deadline', () => {
  const due = fromZonedWallClock(2026, 10, 10, 9, 0);
  const rules = [{ title: 'เมย์เตรียมของแจก ส่วนนนท์ไปรับป้าย', assigneeUserId: null, dueAt: due }];
  assert.equal(shouldAskModel(rules, '@ทันงาน พรุ่งนี้ 9 โมงเมย์เตรียมของแจก ส่วนนนท์ไปรับป้าย', members), true);
  assert.equal(shouldAskModel([{ title: 'ส่งรายงาน', assigneeUserId: 'u-may', dueAt: due }], 'เมย์ ส่งรายงาน พรุ่งนี้', members), false);
  const split = mergeReadings(rules, [
    { title: 'เตรียมของแจก', assigneeUserId: 'u-may', dueAt: null, reason: '' },
    { title: 'ไปรับป้าย', assigneeUserId: 'u-nont', dueAt: fromZonedWallClock(2026, 10, 10, 15, 0), reason: '' },
  ]);
  assert.equal(split[0].dueAt?.getTime(), due.getTime(), 'the message\'s deadline covers the task the model left without');
  assert.equal(split[1].dueAt?.getTime(), fromZonedWallClock(2026, 10, 10, 15, 0).getTime());
});

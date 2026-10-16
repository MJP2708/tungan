import test from 'node:test';
import assert from 'node:assert/strict';
import { isMyWorkRequest, myTasksCard, myTasksPointer } from '../lib/line/my-work.ts';
import { mySections, mySectionOf, mostUrgent, type MyTask } from '../lib/tasks/my-tasks.ts';
import { fromZonedWallClock } from '../lib/deadline.ts';

test('asking for my tasks, in the ways people ask', () => {
  for (const text of [
    '@ทันงาน งานฉัน',
    'งานฉัน',
    '@ทันงาน งานของฉัน',
    'งานของฉัน',
    '@ทันงาน งานฉันมีอะไรบ้าง',
    'มีงานอะไรบ้างครับ',
    '@ทันงาน มีงานอะไรบ้าง?',
    'งานค้าง',
    'วันนี้ต้องทำอะไรบ้างคะ',
    '@ทันงาน เช็คงานหน่อย',
    'my tasks',
    "What's on my plate",
  ]) {
    assert.equal(isMyWorkRequest(text), true, text);
  }
});

test('a task that happens to start the same way is still a task', () => {
  for (const text of [
    '@ทันงาน งานของฉันคือส่งรายงานพรุ่งนี้',
    '@ทันงาน @เมย์ งานค้างจากเมื่อวาน ส่งภายในวันนี้',
    '@ทันงาน ดูงานหน้าร้านพรุ่งนี้ 10 โมง',
    '@ทันงาน',
    '',
  ]) {
    assert.equal(isMyWorkRequest(text), false, text);
  }
});

// Friday 9 Oct 2026, 12:00 Bangkok.
const NOW = fromZonedWallClock(2026, 10, 9, 12, 0);
let n = 0;
const task = (over: Partial<MyTask>): MyTask => ({
  id: `t${++n}`, title: `งาน ${n}`, dueAt: null, status: 'progress', reviewState: 'working',
  blockedReason: null, workspaceId: 'ws', groupName: 'ทีม', personal: false, ...over,
});

test('23:30 Bangkok tonight is วันนี้; 00:30 tomorrow is not', () => {
  assert.equal(mySectionOf(task({ dueAt: fromZonedWallClock(2026, 10, 9, 23, 30) }), NOW), 'today');
  assert.equal(mySectionOf(task({ dueAt: fromZonedWallClock(2026, 10, 10, 0, 30) }), NOW), 'week');
});

test('สัปดาห์นี้ runs to the end of Sunday (Bangkok); Monday is ภายหลัง', () => {
  assert.equal(mySectionOf(task({ dueAt: fromZonedWallClock(2026, 10, 11, 23, 59) }), NOW), 'week');
  assert.equal(mySectionOf(task({ dueAt: fromZonedWallClock(2026, 10, 12, 0, 0) }), NOW), 'later');
  // On a Sunday, the rest of the week is just that Sunday.
  const sunday = fromZonedWallClock(2026, 10, 11, 9, 0);
  assert.equal(mySectionOf(task({ dueAt: fromZonedWallClock(2026, 10, 12, 10, 0) }), sunday), 'later');
});

test('sections: ส่งกลับแก้ไข first, then เลยกำหนด, วันนี้, สัปดาห์นี้, ภายหลัง, รอตรวจ; done is not listed', () => {
  const sections = mySections(
    [
      task({ title: 'later', dueAt: fromZonedWallClock(2026, 10, 30, 10, 0) }),
      task({ title: 'none', dueAt: null }),
      task({ title: 'review', status: 'review', reviewState: 'review', dueAt: fromZonedWallClock(2026, 10, 8, 10, 0) }),
      task({ title: 'today', dueAt: fromZonedWallClock(2026, 10, 9, 18, 0) }),
      task({ title: 'late', dueAt: fromZonedWallClock(2026, 10, 8, 10, 0) }),
      task({ title: 'week', dueAt: fromZonedWallClock(2026, 10, 10, 10, 0) }),
      task({ title: 'back', reviewState: 'revision', dueAt: fromZonedWallClock(2026, 10, 20, 10, 0) }),
      task({ title: 'closed', status: 'done' }),
    ],
    NOW,
  );
  assert.deepEqual(
    sections.map((sec) => [sec.key, sec.items.map((i) => i.title)]),
    [
      ['revision', ['back']],
      ['overdue', ['late']],
      ['today', ['today']],
      ['week', ['week']],
      ['later', ['later', 'none']],
      ['review', ['review']],
    ],
  );
});

test('long sections are capped, but say how many there really are', () => {
  const many = Array.from({ length: 30 }, (_, i) => task({ dueAt: fromZonedWallClock(2026, 10, 30, 10, i) }));
  const [later] = mySections(many, NOW, 20);
  assert.equal(later.items.length, 20);
  assert.equal(later.total, 30);
});

test('in a private chat: the 5 most urgent, in section order, each opening its task', () => {
  const tasks = [
    task({ title: 'later', dueAt: null }),
    task({ title: 'late', dueAt: fromZonedWallClock(2026, 10, 8, 10, 0) }),
    task({ title: 'back', reviewState: 'revision' }),
    ...Array.from({ length: 6 }, (_, i) => task({ title: `today ${i}`, dueAt: fromZonedWallClock(2026, 10, 9, 13 + i, 0) })),
  ];
  const urgent = mostUrgent(tasks, NOW, 5);
  assert.deepEqual(urgent.map((u) => u.title), ['back', 'late', 'today 0', 'today 1', 'today 2']);
  const msg = myTasksCard(urgent, {
    now: NOW, total: tasks.length, appUrl: 'https://liff.line.me/x?p=mine', taskUrl: (id) => `https://liff.line.me/x?task=${id}`,
  });
  const json = JSON.stringify(msg);
  assert.equal((json.match(/"label":"เปิดงาน"/g) ?? []).length, 5);
  assert.match(json, /อีก 4 งานในงานฉัน/);
  assert.match(json, /"uri":"https:\/\/liff.line.me\/x\?p=mine"/);
  assert.ok(!/"text":""/.test(json), 'LINE rejects empty text');
});

test('in a group: a short line and a button, and nothing about anyone\u2019s tasks', () => {
  const msg = myTasksPointer({ appUrl: 'https://liff.line.me/x?p=mine' });
  const json = JSON.stringify(msg);
  assert.ok(!/เปิดงาน"/.test(json) && !/task=/.test(json), 'no task in it');
  assert.match(json, /เปิดงานฉัน/);
});

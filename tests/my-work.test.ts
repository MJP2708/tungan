import test from 'node:test';
import assert from 'node:assert/strict';
import { isMyWorkRequest, summarizeMyWork, myWorkMessage, MY_WORK_ROWS, type MyWorkItem } from '../lib/line/my-work.ts';

test('asking for my tasks, in the ways people ask', () => {
  for (const text of [
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

const NOW = new Date('2026-10-09T05:00:00Z'); // 12:00 Bangkok
const h = (n: number) => new Date(NOW.getTime() + n * 3600000);
let n = 0;
const item = (over: Partial<MyWorkItem>): MyWorkItem => ({
  id: `t${++n}`, title: `งาน ${n}`, dueAt: h(48), status: 'todo', workspaceName: 'ทีม', role: 'mine', ...over,
});

test('my work is grouped: overdue, today, to accept, to review, this week; the rest counted', () => {
  const work = summarizeMyWork(
    [
      item({ title: 'เลย', dueAt: h(-3) }),
      item({ title: 'บ่ายนี้', dueAt: h(4) }),
      item({ title: 'มะรืน', dueAt: h(40) }),
      item({ title: 'เดือนหน้า', dueAt: h(24 * 30) }),
      item({ title: 'ไม่มีกำหนด', dueAt: null }),
      item({ title: 'ส่งแล้ว', status: 'review', dueAt: h(-1) }),
      item({ title: 'รับต่อ', role: 'handoff' }),
      item({ title: 'ตรวจให้หน่อย', role: 'review', status: 'review' }),
    ],
    NOW,
  );
  assert.deepEqual(
    work.sections.map((s) => [s.key, s.items.map((i) => i.title)]),
    [
      ['overdue', ['เลย']],
      ['today', ['บ่ายนี้']],
      ['handoff', ['รับต่อ']],
      ['review', ['ตรวจให้หน่อย']],
      ['soon', ['มะรืน']],
    ],
  );
  // Handed-in work is not overdue: it waits on the reviewer.
  assert.equal(work.submitted, 1);
  assert.equal(work.later, 2);
  assert.equal(work.total, 7);
});

test('the card: one row per task up to the limit, each opening the task; nothing empty', () => {
  const many = Array.from({ length: 14 }, (_, i) => item({ title: `งานที่ ${i + 1}`, dueAt: h(2 + i) }));
  const msg = myWorkMessage(summarizeMyWork(many, NOW), {
    now: NOW, scope: 'ทีมทดสอบ', showWorkspace: false,
    appUrl: 'https://liff.line.me/x', taskUrl: (id) => `https://liff.line.me/x?task=${id}`,
  });
  const json = JSON.stringify(msg);
  const rows = (json.match(/"label":"เปิดงาน"/g) ?? []).length;
  assert.equal(rows, MY_WORK_ROWS);
  assert.match(json, /อีก \d+ งาน/);
  assert.ok(!/"text":""/.test(json), 'LINE rejects empty text');
  assert.ok(msg.altText.length > 0 && msg.altText.length <= 400);
});

test('nothing waiting says so', () => {
  const msg = myWorkMessage(summarizeMyWork([], NOW), {
    now: NOW, scope: 'ทุกพื้นที่งาน', showWorkspace: true, appUrl: '', taskUrl: () => '',
  });
  assert.match(JSON.stringify(msg), /ไม่มีงานค้าง/);
  assert.ok(!/"uri":""/.test(JSON.stringify(msg)), 'no link without an app address');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmBody,
  confirmMessage,
  assigneePicker,
  QUICK_REPLY_LIMIT,
} from '../lib/line/confirm-message.ts';
import { fromZonedWallClock } from '../lib/deadline.ts';

const NOW = fromZonedWallClock(2026, 9, 1, 9, 0);

test('the card shows the reading next to the words it came from', () => {
  const body = confirmBody(
    {
      id: 'd1',
      title: 'ส่งรายงาน',
      dueAt: fromZonedWallClock(2026, 9, 2, 10, 0),
      dueSource: 'พรุ่งนี้ 10 โมง',
      assigneeName: 'สมชาย',
      assigneeSource: '@somchai',
    },
    NOW,
  );
  // This is what makes the parser checkable rather than something to trust.
  assert.match(body, /พรุ่งนี้ 10 โมง → พรุ่งนี้ 10:00/);
  assert.match(body, /@somchai → สมชาย/);
});

test('a missing deadline says so and points at the fix', () => {
  const body = confirmBody(
    { id: 'd1', title: 'ส่งรายงาน', dueAt: null, dueSource: null, assigneeName: null, assigneeSource: null },
    NOW,
  );
  // A task with no deadline gets no reminders and quietly dies, so an empty
  // field is not an acceptable resting state.
  assert.match(body, /ยังไม่ระบุ · แตะ เปลี่ยนกำหนดส่ง/);
  assert.match(body, /ยังไม่ระบุ · แตะ เปลี่ยนผู้รับผิดชอบ/);
});

test('the card offers confirm, both edits and dismiss', () => {
  const msg = confirmMessage(
    { id: 'd1', title: 'x', dueAt: null, dueSource: null, assigneeName: null, assigneeSource: null },
    NOW,
  ) as any;
  const kinds = msg.template.actions.map((a: any) => `${a.type}:${a.label}`);
  assert.deepEqual(kinds, [
    'postback:ยืนยันสร้างงาน',
    'datetimepicker:เปลี่ยนกำหนดส่ง',
    'postback:เปลี่ยนผู้รับผิดชอบ',
    'postback:ไม่ใช่งาน',
  ]);
  // Every action carries the draft id, so a tap is unambiguous.
  for (const a of msg.template.actions) assert.match(a.data, /inbox=d1/);
});

test('the picker opens on a suggestion rather than on nothing', () => {
  const msg = confirmMessage(
    { id: 'd1', title: 'x', dueAt: null, dueSource: null, assigneeName: null, assigneeSource: null },
    NOW,
  ) as any;
  const picker = msg.template.actions[1];
  assert.equal(picker.mode, 'datetime');
  assert.ok(picker.initial, 'should propose a time');
  // Local wall clock, not UTC, which is what LINE expects.
  assert.match(picker.initial, /^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}$/);
});

test('the assignee picker lists known members as quick replies', () => {
  const msg = assigneePicker('d1', [
    { userId: 'u1', name: 'สมชาย' },
    { userId: 'u2', name: 'สมหญิง' },
  ], 'https://x.test') as any;
  assert.equal(msg.quickReply.items.length, 2);
  assert.match(msg.quickReply.items[0].action.data, /action=setassignee&inbox=d1&user=u1/);
});

test('too many members points at the app instead of a truncated list', () => {
  const many = Array.from({ length: QUICK_REPLY_LIMIT + 1 }, (_, i) => ({
    userId: `u${i}`, name: `คน ${i}`,
  }));
  const msg = assigneePicker('d1', many, 'https://x.test') as any;
  // Showing a silently truncated list would let someone assign work to the
  // wrong person and never know the right one was missing.
  assert.equal(msg.type, 'text');
  assert.match(msg.text, /https:\/\/x\.test/);
  assert.equal(msg.quickReply, undefined);
});

test('an empty group explains how to make members known', () => {
  const msg = assigneePicker('d1', [], 'https://x.test') as any;
  assert.match(msg.text, /พิมพ์อะไรก็ได้ในกลุ่ม/);
});

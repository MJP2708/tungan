import test from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmBody,
  confirmMessage,
  confirmCarousel,
  cardActions,
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
  const actions = cardActions(msg);
  const kinds = actions.map((a: any) => `${a.type}:${a.label}`);
  assert.deepEqual(kinds, [
    'postback:ยืนยันสร้างงาน',
    'datetimepicker:เวลา',
    'postback:คน',
    'postback:ไม่ใช่งาน',
  ]);
  // Every action carries the draft id, so a tap is unambiguous.
  for (const a of actions) assert.match(a.data as string, /inbox=d1/);
  // LINE caps button labels at 20 characters.
  for (const a of actions) assert.ok((a.label as string).length <= 20, a.label as string);
});

test('the picker opens on a suggestion rather than on nothing', () => {
  const msg = confirmMessage(
    { id: 'd1', title: 'x', dueAt: null, dueSource: null, assigneeName: null, assigneeSource: null },
    NOW,
  ) as any;
  const picker = cardActions(msg)[1] as any;
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

test('a 1:1 chat card says which workspace the draft went to; a group card does not', () => {
  const base = { id: 'd', title: 'ส่งรายงาน', dueAt: null, dueSource: null, assigneeName: null, assigneeSource: null };
  assert.match(confirmBody({ ...base, workspaceName: 'ทีม Ops' }), /ที่: ทีม Ops/);
  assert.doesNotMatch(confirmBody(base), /ที่:/);
});

test('the card is a Flex Message in the app\u2019s look, with readable alt text', () => {
  const msg = confirmMessage(
    { id: 'd1', title: 'ส่งรายงาน', dueAt: null, dueSource: null, assigneeName: 'สมชาย', assigneeSource: null },
    NOW,
  ) as any;
  assert.equal(msg.type, 'flex');
  assert.equal(msg.contents.type, 'bubble');
  assert.equal(msg.contents.body.background.type, 'linearGradient');
  // The notification preview on a locked phone is the alt text.
  assert.match(msg.altText, /งาน: ส่งรายงาน/);
  assert.ok(msg.altText.length <= 400);
});

test('after an edit, what changed is its own line, never part of the task name', () => {
  const msg = confirmMessage(
    {
      id: 'd1', title: 'ส่งรายงาน', notice: 'แก้กำหนดส่งแล้ว',
      dueAt: null, dueSource: null, assigneeName: null, assigneeSource: null,
    },
    NOW,
  ) as any;
  const texts: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'text') texts.push(n.text);
    Object.values(n).forEach((v) => (Array.isArray(v) ? v.forEach(walk) : walk(v)));
  };
  walk(msg.contents);
  assert.ok(texts.includes('ส่งรายงาน'), 'the title stands alone');
  assert.ok(texts.includes('✓ แก้กำหนดส่งแล้ว'), 'the notice has its own line');
  assert.ok(!texts.some((t) => t.includes('แก้กำหนดส่งแล้ว ·')), 'never glued to the name');
});

test('several drafts from one message are one swipeable card, not a stack', () => {
  const base = { dueAt: null, dueSource: null, assigneeName: null, assigneeSource: null };
  const msg = confirmCarousel(
    [
      { id: 'd1', title: 'ส่งรายงาน', ...base },
      { id: 'd2', title: 'โทรหาลูกค้า', ...base },
    ],
    NOW,
  ) as any;
  assert.equal(msg.type, 'flex');
  assert.equal(msg.contents.type, 'carousel');
  assert.equal(msg.contents.contents.length, 2);
  // Each bubble still carries its own draft's actions.
  const data = cardActions(msg).map((a) => a.data as string);
  assert.ok(data.some((d) => d.includes('inbox=d1')) && data.some((d) => d.includes('inbox=d2')));
  assert.match(msg.altText, /ร่างงาน 2 รายการ/);
});

test('one draft is still one plain card', () => {
  const msg = confirmCarousel(
    [{ id: 'd1', title: 'ส่งรายงาน', dueAt: null, dueSource: null, assigneeName: null, assigneeSource: null }],
    NOW,
  ) as any;
  assert.equal(msg.contents.type, 'bubble');
});

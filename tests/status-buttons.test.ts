import test from 'node:test';
import assert from 'node:assert/strict';
import {
  statusActions, reasonPrompt, handoffPicker, undoAction, QUICK_REPLY_LIMIT,
} from '../lib/line/status-buttons.ts';

/**
 * The five actions, as they appear inside LINE.
 *
 * What matters here is that the buttons offered match what the task can
 * actually do. Offering an action that will be refused teaches people the
 * buttons are decorative, which is worse than not showing them.
 */

const labels = (items: ReturnType<typeof statusActions>) =>
  items.map((i) => (i.action as { label: string }).label);
const datas = (items: ReturnType<typeof statusActions>) =>
  items.map((i) => (i.action as { data: string }).data);

const fresh = { id: 't1', status: 'todo', acceptedAt: null, pendingAssigneeUserId: null };

test('a new task offers all five actions', () => {
  assert.deepEqual(labels(statusActions(fresh)), [
    'รับงาน', 'ขอข้อมูลเพิ่ม', 'ติดปัญหา', 'ส่งต่อ', 'เสร็จแล้ว',
  ]);
});

test('an accepted task stops offering รับงาน', () => {
  const accepted = { ...fresh, status: 'progress', acceptedAt: new Date() };
  assert.equal(labels(statusActions(accepted)).includes('รับงาน'), false);
  assert.equal(labels(statusActions(accepted)).length, 4);
});

test('a task waiting for review offers nothing to the worker', () => {
  // They have handed it in. The only honest thing to show is that it is
  // waiting — a เสร็จแล้ว button here would imply it can be finished twice.
  assert.deepEqual(statusActions({ ...fresh, status: 'review' }), []);
});

test('a closed task offers nothing', () => {
  assert.deepEqual(statusActions({ ...fresh, status: 'done' }), []);
});

test('a pending handoff replaces the actions for its recipient only', () => {
  const offered = { ...fresh, pendingAssigneeUserId: 'u2' };
  assert.deepEqual(labels(statusActions(offered, 'u2')), ['รับงานที่ส่งต่อ', 'ปฏิเสธ']);
  // The sender still sees their own actions: the task is still theirs until
  // the other person accepts.
  assert.equal(labels(statusActions(offered, 'u1')).includes('ส่งต่อ'), true);
});

test('every button stays inside LINE’s limits', () => {
  const items = statusActions(fresh);
  assert.ok(items.length <= QUICK_REPLY_LIMIT);
  for (const i of items) {
    const a = i.action as { label: string; data: string };
    // LINE truncates labels past 20 characters and rejects postback data
    // over 300 bytes.
    assert.ok(a.label.length <= 20, a.label);
    assert.ok(Buffer.byteLength(a.data) <= 300, a.data);
  }
});

test('the reason prompt offers the presets, so typing is optional', () => {
  const prompt = reasonPrompt('t1', 'blocked') as unknown as {
    text: string; quickReply: { items: { action: { label: string; data: string } }[] };
  };
  assert.deepEqual(
    prompt.quickReply.items.map((i) => i.action.label),
    ['รอลูกค้า', 'รอของ', 'รอคนอื่น', 'อื่นๆ'],
  );
  // The worker is told who will read it before they answer, not after.
  assert.ok(prompt.text.includes('เห็นเฉพาะคุณกับหัวหน้า'));
  // And that the task still shows as blocked to everyone.
  assert.ok(prompt.text.includes('ไม่บอกเหตุผล'));
});

test('a reason with a space or a slash survives the round trip', () => {
  const prompt = reasonPrompt('t1', 'blocked') as unknown as {
    quickReply: { items: { action: { data: string } }[] };
  };
  for (const item of prompt.quickReply.items) {
    const parsed = new URLSearchParams(item.action.data);
    assert.equal(parsed.get('task'), 't1');
    assert.ok(['รอลูกค้า', 'รอของ', 'รอคนอื่น', 'อื่นๆ'].includes(parsed.get('reason')!));
  }
});

test('the handoff picker says the task has not moved yet', () => {
  const picker = handoffPicker('t1', [{ userId: 'u2', name: 'เมย์' }], 'https://x') as unknown as {
    text: string;
  };
  // The sender must not believe they have handed it over when they have not.
  assert.ok(picker.text.includes('ยังอยู่กับคุณ'));
});

test('too many members points at the app rather than truncating', () => {
  const many = Array.from({ length: QUICK_REPLY_LIMIT + 1 }, (_, i) => ({
    userId: `u${i}`, name: `คน${i}`,
  }));
  const picker = handoffPicker('t1', many, 'https://x') as unknown as {
    text: string; quickReply?: unknown;
  };
  assert.equal(picker.quickReply, undefined);
  // Showing a silently cut list is how work gets handed to the wrong person.
  assert.ok(picker.text.includes('https://x'));
});

test('no known members explains what to do instead of looking broken', () => {
  const picker = handoffPicker('t1', [], 'https://x') as unknown as { text: string };
  assert.ok(picker.text.includes('พิมพ์'));
});

test('undo addresses the exact event, not just the task', () => {
  // Undoing "the last thing" would race with anything else that happened in
  // between and could reverse someone else's change.
  const parsed = new URLSearchParams((undoAction('t1', 'e9').action as { data: string }).data);
  assert.equal(parsed.get('action'), 'statusundo');
  assert.equal(parsed.get('task'), 't1');
  assert.equal(parsed.get('event'), 'e9');
});

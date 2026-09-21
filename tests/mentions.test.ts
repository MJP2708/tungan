import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMentions, mentionedPeople } from '../lib/line/mentions.ts';

/**
 * Assigning from @mentions.
 *
 * Two people called "เมย์" in one group is ordinary. The mention's user id
 * tells them apart where the nickname cannot, so these pin that the id wins,
 * the bot's own mention is ignored, and a pairing that would be a guess is
 * left alone.
 */

const text = '@ทันงาน @เมย์ ส่งใบเสนอราคาพรุ่งนี้';
const mentionees = [
  { index: 0, length: 7, type: 'user', isSelf: true },
  { index: 8, length: 5, type: 'user', userId: 'Umay' },
];

test('the bot itself is not a person to assign', () => {
  assert.deepEqual(mentionedPeople(text, mentionees), [{ lineUserId: 'Umay', text: '@เมย์' }]);
});

test('a mention without a user id is left to name matching', () => {
  assert.deepEqual(mentionedPeople(text, [{ index: 8, length: 5, type: 'user' }]), []);
  assert.deepEqual(mentionedPeople(text, undefined), []);
});

test('the mentioned person becomes the assignee, and leaves the title', () => {
  const [d] = applyMentions(
    [{ title: '@เมย์ ส่งใบเสนอราคา', assigneeUserId: 'someone-else', assigneeSource: 'เมย์' }],
    [{ userId: 'u-may', text: '@เมย์' }],
  );
  assert.equal(d.assigneeUserId, 'u-may');
  assert.equal(d.assigneeSource, '@เมย์');
  assert.equal(d.title, 'ส่งใบเสนอราคา');
});

test('"เตือนฉัน" stays with the sender', () => {
  const [d] = applyMentions(
    [{ title: 'โทรหา @เมย์', assigneeUserId: 'me', assigneeSource: 'เตือนฉัน' }],
    [{ userId: 'u-may', text: '@เมย์' }],
  );
  assert.equal(d.assigneeUserId, 'me');
});

test('two drafts, two mentions: paired in order; otherwise not guessed', () => {
  const drafts = [
    { title: 'ส่งรายงาน', assigneeUserId: null, assigneeSource: null },
    { title: 'โทรหาลูกค้า', assigneeUserId: null, assigneeSource: null },
  ];
  const paired = applyMentions(drafts, [
    { userId: 'a', text: '@A' },
    { userId: 'b', text: '@B' },
  ]);
  assert.deepEqual(paired.map((d) => d.assigneeUserId), ['a', 'b']);
  const unpaired = applyMentions(drafts, [{ userId: 'a', text: '@A' }]);
  assert.deepEqual(unpaired.map((d) => d.assigneeUserId), [null, null]);
});

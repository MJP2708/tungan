import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDraft, shouldProcessGroupMessage } from '../lib/line/extract.ts';

const NOW = new Date('2026-09-01T03:00:00.000Z'); // Tue 1 Sep, 10:00 Bangkok
const MEMBERS = [
  { userId: 'u-may', names: ['เมย์', 'May W.'] },
  { userId: 'u-nont', names: ['นนท์'] },
  { userId: 'u-poom', names: ['ภูมิ'] },
];

function bkk(at: Date | null) {
  if (!at) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at);
}

test('group messages are ignored unless the bot is mentioned', () => {
  assert.equal(shouldProcessGroupMessage('ส่งใบเสนอราคาให้ลูกค้าด้วย'), false);
  assert.equal(shouldProcessGroupMessage('@ทันงาน ส่งใบเสนอราคา'), true);
  // Opting a workspace into full scan is possible but is not the default.
  assert.equal(shouldProcessGroupMessage('ไม่มี mention', 'all'), true);
});

test('a mention plus a name and a time produces a complete draft', () => {
  const d = extractDraft('@ทันงาน @เมย์ ส่งใบเสนอราคาให้ ABC ภายในวันนี้', {
    members: MEMBERS,
    now: NOW,
    cutoff: '17:00',
  });
  assert.equal(d.mentionsBot, true);
  assert.equal(d.assigneeUserId, 'u-may');
  assert.equal(bkk(d.dueAt), '01/09, 17:00');
  assert.match(d.title, /ส่งใบเสนอราคาให้ ABC/);
  // The mention, the name and the time phrase are all stripped from the title.
  assert.ok(!d.title.includes('@ทันงาน'));
  assert.ok(!d.title.includes('ภายในวันนี้'));
});

test('Thai time words become a real deadline', () => {
  const d = extractDraft('@ทันงาน @ภูมิ ปรับ headline ก่อนบ่าย 3', {
    members: MEMBERS, now: NOW,
  });
  assert.equal(d.assigneeUserId, 'u-poom');
  assert.equal(bkk(d.dueAt), '01/09, 15:00');
  assert.match(d.title, /ปรับ headline/);
});

test('เตือนฉัน assigns to the sender, not to a name in the text', () => {
  const d = extractDraft('เตือนฉัน โทรหาเมย์ พรุ่งนี้ 9 โมงเช้า', {
    members: MEMBERS, senderUserId: 'u-nont', now: NOW,
  });
  assert.equal(d.assigneeUserId, 'u-nont');
  assert.equal(d.isCommand, true);
  assert.equal(bkk(d.dueAt), '02/09, 09:00');
});

test('an ambiguous name resolves to nobody rather than guessing', () => {
  // Two different people who share a nickname are different people.
  const ambiguous = [
    { userId: 'u-a', names: ['พี่เอ'] },
    { userId: 'u-b', names: ['พี่เอ'] },
  ];
  const d = extractDraft('@ทันงาน พี่เอ ช่วยส่งไฟล์ พรุ่งนี้', {
    members: ambiguous, now: NOW,
  });
  assert.equal(d.assigneeUserId, null);
  assert.equal(d.matchedNames.length, 2);
});

test('a message with no timing at all reports no deadline instead of inventing one', () => {
  const d = extractDraft('@ทันงาน @เมย์ ส่งไฟล์ให้ลูกค้า', {
    members: MEMBERS, now: NOW, cutoff: '17:00',
  });
  assert.equal(d.assigneeUserId, 'u-may');
  // The cutoff is for messages that name a day, not for messages that say
  // nothing about time. A human sets this one.
  assert.equal(d.dueAt, null);
  assert.equal(d.confidence, 'fallback');
});

test('no name match leaves the assignee empty for the human to fill', () => {
  const d = extractDraft('@ทันงาน ใครก็ได้ช่วยเช็คของหน่อย พรุ่งนี้', {
    members: MEMBERS, now: NOW,
  });
  assert.equal(d.assigneeUserId, null);
  assert.equal(bkk(d.dueAt), '02/09, 17:00');
});

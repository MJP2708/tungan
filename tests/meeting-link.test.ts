import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMeetingLink, findLink, meetingLinkLabel } from '../lib/meeting-link.ts';
import { parseAnnouncement } from '../lib/line/announce.ts';

test('a meeting link must be a web link; empty means none', () => {
  assert.equal(normalizeMeetingLink(''), null);
  assert.equal(normalizeMeetingLink('  '), null);
  assert.equal(normalizeMeetingLink(null), null);
  assert.equal(normalizeMeetingLink(' https://meet.google.com/abc-defg-hij '), 'https://meet.google.com/abc-defg-hij');
  assert.throws(() => normalizeMeetingLink('javascript:alert(1)'));
  assert.throws(() => normalizeMeetingLink('meet.google.com/abc'));
  assert.throws(() => normalizeMeetingLink('https://x.com/' + 'a'.repeat(600)));
});

test('the button says where it goes', () => {
  assert.equal(meetingLinkLabel('https://meet.google.com/abc'), 'เข้าร่วม Google Meet');
  assert.equal(meetingLinkLabel('https://us02web.zoom.us/j/123'), 'เข้าร่วม Zoom');
  assert.equal(meetingLinkLabel('https://line.me/R/call/xyz'), 'เปิดใน LINE');
  assert.equal(meetingLinkLabel('https://teams.microsoft.com/l/meetup'), 'เข้าร่วม Teams');
  // Not fooled by a lookalike host.
  assert.equal(meetingLinkLabel('https://meet.google.com.evil.example/x'), 'เปิดลิงก์');
  assert.equal(meetingLinkLabel('https://example.com'), 'เปิดลิงก์');
});

test('findLink takes the first link and drops trailing punctuation', () => {
  assert.equal(findLink('เข้าที่นี่ https://zoom.us/j/1, ด่วน'), 'https://zoom.us/j/1');
  assert.equal(findLink('ไม่มีลิงก์'), null);
});

test('a LINE announcement with a link: the link becomes the button, not text', () => {
  const parsed = parseAnnouncement(
    '@ทันงาน ประกาศ: ประชุมทีมศุกร์ 10:00 https://meet.google.com/abc-defg-hij\nเตรียมตัวเลขยอดขายมาด้วย',
  );
  assert.deepEqual(parsed, {
    title: 'ประชุมทีมศุกร์ 10:00',
    body: 'เตรียมตัวเลขยอดขายมาด้วย',
    link: 'https://meet.google.com/abc-defg-hij',
  });
  assert.equal(parseAnnouncement('@ทันงาน ประกาศ: วันหยุดสงกรานต์')?.link, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnnouncement } from '../lib/line/announce.ts';

test('ประกาศ followed by a space, colon or new line is an announcement', () => {
  assert.deepEqual(parseAnnouncement('@ทันงาน ประกาศ ประชุมย้ายเป็นศุกร์ 10:00'), {
    title: 'ประชุมย้ายเป็นศุกร์ 10:00', body: '', link: null,
  });
  assert.deepEqual(parseAnnouncement('@ทันงาน ประกาศ: ปิดระบบเบิกเงินวันที่ 15\nส่งใบเสร็จก่อนวันที่ 14\nขอบคุณครับ'), {
    title: 'ปิดระบบเบิกเงินวันที่ 15', body: 'ส่งใบเสร็จก่อนวันที่ 14\nขอบคุณครับ', link: null,
  });
  assert.deepEqual(parseAnnouncement('@ทันงาน ประกาศ\nวันหยุดบริษัท\nศุกร์นี้'), { title: 'วันหยุดบริษัท', body: 'ศุกร์นี้', link: null });
});

test('a task about announcing something is still a task', () => {
  assert.equal(parseAnnouncement('@ทันงาน ประกาศผลสอบให้ทีม พรุ่งนี้'), null);
  assert.equal(parseAnnouncement('@ทันงาน ส่งประกาศให้ลูกค้า'), null);
  assert.equal(parseAnnouncement('@ทันงาน @เมย์ ส่งรายงาน'), null);
});

test('ประกาศ with nothing after it is recognised, but empty', () => {
  assert.deepEqual(parseAnnouncement('@ทันงาน ประกาศ'), { title: '', body: '', link: null });
});

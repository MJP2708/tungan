/**
 * The bot explaining itself.
 *
 * Answered with the reply token, so it costs nothing against the plan quota
 * no matter how often people ask. That matters: a help text people are
 * reluctant to request is a help text nobody reads.
 */

const HELP_TRIGGERS =
  /^(help|ช่วยเหลือ|วิธีใช้|ใช้ยังไง|ใช้ไง|คู่มือ|เมนู|\?|？)$/i;

/** Does this message ask how to use the bot? */
export function isHelpRequest(text: string, mentionsBot: boolean): boolean {
  const value = (text ?? '')
    .replace(/@ทันงาน|@tungan/gi, '')
    .trim();
  if (!value) return mentionsBot; // a bare mention is someone asking what this is
  return HELP_TRIGGERS.test(value);
}

export type HelpContext = {
  isGroup: boolean;
  /** False when this group has not been connected to a workspace yet. */
  bound: boolean;
  appUrl: string;
};

/**
 * Written for the person who was added to a group and has no idea what the
 * bot is for — which is most people. Shows what to type, not what the
 * features are called.
 */
export function helpMessage(ctx: HelpContext): string {
  if (ctx.isGroup && !ctx.bound) {
    return [
      'ทันงาน · ยังไม่ได้เชื่อมกลุ่มนี้',
      '',
      'เปิดแอปแล้วไปที่ ตั้งค่า → การเชื่อมต่อ แล้วกดเชื่อมกลุ่มนี้',
      'จากนั้นข้อความที่ติด @ทันงาน จะกลายเป็นงานได้',
      '',
      ctx.appUrl,
    ].join('\n');
  }

  if (!ctx.isGroup) {
    return [
      'ทันงาน · เปลี่ยนข้อความเป็นงาน',
      '',
      'พิมพ์งานมาได้เลย เช่น',
      '  ส่งรายงานพรุ่งนี้ 10 โมง',
      '  เตือนฉัน โทรหาลูกค้า บ่าย 3',
      '',
      'ผมจะอ่านให้ว่าเป็นงานอะไร ใครทำ ส่งเมื่อไหร่',
      'แล้วให้คุณกดยืนยันก่อนเสมอ ไม่สร้างเอง',
      '',
      'ดูงานทั้งหมด: ' + ctx.appUrl,
    ].join('\n');
  }

  return [
    'ทันงาน · วิธีใช้ในกลุ่ม',
    '',
    'พิมพ์ @ทันงาน นำหน้า แล้วตามด้วยงาน เช่น',
    '  @ทันงาน ส่งใบเสนอราคาพรุ่งนี้ 10 โมง',
    '  @ทันงาน @สมชาย เช็คของหน้าร้าน ภายในวันนี้',
    '',
    'ผมจะสรุปให้ว่าอ่านได้ว่าอย่างไร แล้วมีปุ่มให้กดยืนยัน',
    'ไม่ติด @ทันงาน ผมจะไม่อ่านข้อความนั้น',
    '',
    'การเตือนจะส่งเป็นข้อความส่วนตัวถึงคนที่รับผิดชอบ ไม่ประกาศในกลุ่ม',
    'ต้องแอดบอทเป็นเพื่อนก่อนถึงจะได้รับ',
    '',
    'ดูงานทั้งหมด: ' + ctx.appUrl,
  ].join('\n');
}

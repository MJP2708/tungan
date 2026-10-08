import { isSafeHttpUrl } from './url.ts';

/**
 * A link to join something — a Meet, a Zoom, a LINE group call — attached to
 * an announcement (2026-10-08). ทันงาน does not run calls itself: everyone
 * already has LINE, Meet and Zoom, so the link and one button to it are the
 * part worth owning.
 *
 * Pure, so the browser (the composer) and the server (the route and the LINE
 * command) give the same answer.
 */

export const LINK_MAX = 500;

/** The link to store, or null for none. Throws a person-readable message. */
export function normalizeMeetingLink(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length > LINK_MAX || !isSafeHttpUrl(text)) {
    throw new Error('ลิงก์ต้องขึ้นต้นด้วย https:// เช่น ลิงก์ Google Meet หรือ Zoom');
  }
  return text;
}

/**
 * The first web link in a message, for "@ทันงาน ประกาศ: ..." in LINE, where
 * there is no separate field. Trailing punctuation people type after a link
 * is not part of it.
 */
export function findLink(text: string): string | null {
  const match = (text ?? '').match(/https?:\/\/[^\s<>"'）)]+/i);
  if (!match) return null;
  const url = match[0].replace(/[.,;:!?、。]+$/, '');
  return url.length <= LINK_MAX && isSafeHttpUrl(url) ? url : null;
}

/** What the button says, so people know where it goes before they tap. */
export function meetingLinkLabel(url: string): string {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'เปิดลิงก์';
  }
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (on('meet.google.com')) return 'เข้าร่วม Google Meet';
  if (on('zoom.us') || on('zoom.com')) return 'เข้าร่วม Zoom';
  if (on('teams.microsoft.com') || on('teams.live.com')) return 'เข้าร่วม Teams';
  if (on('line.me')) return 'เปิดใน LINE';
  return 'เปิดลิงก์';
}

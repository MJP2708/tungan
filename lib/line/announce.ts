/**
 * "@ทันงาน ประกาศ ..." in LINE: an announcement, not a task (2026-10-08).
 *
 * The word must stand on its own — followed by a space, a colon or a new
 * line — so "@ทันงาน ประกาศผลสอบให้ทีม พรุ่งนี้" stays a task about announcing
 * results. The first line after it is the title; anything below is the body.
 */
import { findLink } from '../meeting-link.ts';

const BOT = /@ทันงาน|@tungan/gi;
const COMMAND = /^ประกาศ(?:[\s:：]|$)/;

/** `link` is the first web link anywhere in it (a Meet, a Zoom), taken out
 *  of the text so it shows once, as the join button. */
export type ParsedAnnouncement = { title: string; body: string; link: string | null };

/** null when this is not an announcement; empty title when it is one with nothing in it. */
export function parseAnnouncement(text: string): ParsedAnnouncement | null {
  const rest = text.replace(BOT, ' ').replace(/^[\s​]+/, '');
  if (!COMMAND.test(rest)) return null;
  let after = rest.replace(/^ประกาศ[\s:：]*/, '');
  const link = findLink(after);
  if (link) after = after.replace(link, ' ');
  const lines = after.split('\n').map((line) => line.replace(/\s+/g, ' ').trim());
  const first = lines.findIndex((line) => line.length > 0);
  if (first === -1) return { title: '', body: '', link };
  return {
    title: lines[first].slice(0, 120),
    body: lines.slice(first + 1).join('\n').trim().slice(0, 2000),
    link,
  };
}

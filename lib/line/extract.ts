// Rules-only extraction. No model calls anywhere in this file.
//
// Every result is a DRAFT that a human confirms. The system never creates a
// task by itself, so "no match" is an acceptable, common outcome — it just
// means the confirmation screen starts empty.

import { resolveDeadline, type DeadlineConfidence } from '../deadline.ts';

export type KnownMember = {
  userId: string;
  /** Display names we can match on, per workspace. Two members may share a
   *  nickname, so an ambiguous match resolves to nobody. */
  names: string[];
};

export type Extraction = {
  title: string;
  assigneeUserId: string | null;
  /** Null when the text named no time at all. */
  dueAt: Date | null;
  confidence: DeadlineConfidence;
  matchedNames: string[];
  isCommand: boolean;
  /** True when the bot was addressed. Group messages without this are ignored. */
  mentionsBot: boolean;
};

const BOT_MENTION = /@ทันงาน|@tungan/i;

/** Strip mentions, commands and time phrases to leave the actual instruction. */
function cleanTitle(text: string, names: string[]): string {
  let out = text;
  out = out.replace(BOT_MENTION, ' ');
  for (const name of names) {
    out = out.replaceAll(`@${name}`, ' ');
  }
  out = out
    .replace(/มอบหมายให้\s*/g, ' ')
    .replace(/เตือนฉัน(ว่า)?\s*/g, ' ')
    .replace(/ช่วย\s*/g, ' ')
    .replace(/หน่อย(นะ|ครับ|ค่ะ)?/g, ' ')
    .replace(/ด้วย(นะ|ครับ|ค่ะ)?/g, ' ')
    .replace(/ภายในวันนี้|ก่อนเลิกงาน|วันนี้|พรุ่งนี้|มะรืน(นี้)?|วันศุกร์|ศุกร์/g, ' ')
    .replace(/ก่อนบ่าย\s*\d{1,2}/g, ' ')
    .replace(/\d{1,2}\s*(โมงเช้า|โมงเย็น|โมง|ทุ่ม)/g, ' ')
    .replace(/\d{1,2}[:.]\d{2}\s*(น\.)?/g, ' ')
    .replace(/(ตอน)?(เช้า|บ่าย|เย็น|ค่ำ|เที่ยง)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}

/**
 * Turn one LINE message into a draft.
 *
 * Only these signals are used: an @mention of a known member, member and team
 * names from the sending group, the Thai day/time words the deadline engine
 * already understands, and the explicit commands เตือนฉัน and มอบหมายให้.
 */
export function extractDraft(
  text: string,
  context: {
    members: KnownMember[];
    senderUserId?: string;
    now?: Date;
    cutoff?: string;
    isGroup?: boolean;
  },
): Extraction {
  const now = context.now ?? new Date();
  const raw = (text ?? '').trim();
  const mentionsBot = BOT_MENTION.test(raw);

  // Name matching. A name that matches more than one member is ambiguous and
  // resolves to nobody, because two people can share a nickname.
  const matchedNames: string[] = [];
  const hits = new Map<string, number>();
  for (const member of context.members) {
    for (const name of member.names) {
      if (!name) continue;
      if (raw.includes(name)) {
        matchedNames.push(name);
        hits.set(member.userId, (hits.get(member.userId) ?? 0) + 1);
      }
    }
  }
  let assigneeUserId: string | null = null;
  const distinct = [...hits.keys()];
  if (distinct.length === 1) assigneeUserId = distinct[0];

  // "เตือนฉัน" assigns to the sender regardless of any other name present.
  const isSelfReminder = /เตือนฉัน/.test(raw);
  if (isSelfReminder && context.senderUserId) assigneeUserId = context.senderUserId;

  const isCommand = isSelfReminder || /มอบหมายให้/.test(raw);

  const deadline = resolveDeadline(raw, { now, cutoff: context.cutoff });
  // `fallback` means the text named neither a day nor a time. Rather than
  // inventing the workspace cutoff for a message that never mentioned timing,
  // report no deadline and let the human set one.
  const namedATime =
    deadline.matched.day !== null || deadline.matched.time !== null;

  const allNames = context.members.flatMap((m) => m.names);
  const title = cleanTitle(raw, allNames) || raw.slice(0, 80);

  return {
    title,
    assigneeUserId,
    dueAt: namedATime ? deadline.at : null,
    confidence: deadline.confidence,
    matchedNames,
    isCommand,
    mentionsBot,
  };
}

/**
 * Should this group message be processed at all?
 *
 * Default is mention-only. Auto-scanning every message in a group is out of
 * scope until a team opts in and a privacy review passes, so this is the gate
 * that keeps us honest about "the bot does not read your whole account".
 */
export function shouldProcessGroupMessage(
  text: string,
  mode: 'mention' | 'all' = 'mention',
): boolean {
  if (mode === 'all') return true;
  return BOT_MENTION.test(text ?? '');
}

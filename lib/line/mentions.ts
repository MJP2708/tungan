// @mentions, read exactly.
//
// A LINE text message carries `mention.mentionees`: where each @ sits in the
// text and, when the person allows profile access, their user id. That is an
// exact answer to "who is this for" — better than matching a nickname two
// people in the group may share (the business plan's nickname-collision risk).
// Name matching in extract.ts stays as the fallback for mentions without an id.

export type Mentionee = {
  index: number;
  length: number;
  type?: string;
  userId?: string;
  /** The bot itself — "@ทันงาน" as a real mention. */
  isSelf?: boolean;
};

export type MentionedPerson = { lineUserId: string; text: string };

/** People @-mentioned with a known id, in the order they appear. Not the bot. */
export function mentionedPeople(text: string, mentionees: Mentionee[] | undefined): MentionedPerson[] {
  const seen = new Set<string>();
  const out: MentionedPerson[] = [];
  for (const m of [...(mentionees ?? [])].sort((a, b) => a.index - b.index)) {
    if (m.isSelf || m.type === 'all' || !m.userId || seen.has(m.userId)) continue;
    seen.add(m.userId);
    out.push({ lineUserId: m.userId, text: text.slice(m.index, m.index + m.length) });
  }
  return out;
}

type DraftLike = { title: string; assigneeUserId: string | null; assigneeSource: string | null };

/**
 * Put mentioned people on the drafts.
 *
 * One draft: the first person mentioned. Several drafts (a split message):
 * only when there is exactly one mention per draft, in order — otherwise the
 * pairing is a guess, and the name matcher's answer stands. "เตือนฉัน" is a
 * reminder for the sender and is never overridden. Mention text is removed
 * from titles so "@May" does not end up in the task name.
 */
export function applyMentions<T extends DraftLike>(
  drafts: T[],
  people: Array<{ userId: string; text: string }>,
): T[] {
  if (!people.length) return drafts;
  const pairOf = (i: number) =>
    drafts.length === 1 ? people[0] : people.length === drafts.length ? people[i] : null;
  return drafts.map((d, i) => {
    let title = d.title;
    for (const p of people) title = title.split(p.text).join(' ');
    title = title.replace(/\s+/g, ' ').trim() || d.title;
    const who = pairOf(i);
    if (!who || d.assigneeSource === 'เตือนฉัน') return { ...d, title };
    return { ...d, title, assigneeUserId: who.userId, assigneeSource: who.text };
  });
}

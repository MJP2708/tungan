/**
 * What we ask Jev about a message, and what we accept back.
 *
 * Pure on purpose: the questions and the thresholds are the product decisions
 * here, and they can be read and tested without a key or a network.
 *
 * Only asked when the rules could not decide, and only about things the
 * confirmation card already shows: is this a task at all, who is it for, and
 * roughly when. The deadline comes back as a day, never a timestamp — the
 * rules in lib/deadline.ts stay the single source of truth for instants, and
 * a model that guessed "16:00" would be inventing precision it does not have.
 *
 * Nothing here creates anything. The person still confirms the card.
 */
import type { JevAnswer, JevQuestion, JevResult } from './jev.ts';

/** Below this, we keep what the rules said and ignore the model. */
export const MIN_CONFIDENCE = 0.6;
/** A message has to look like a request before we suggest anything at all. */
export const MIN_IS_TASK = 0.7;

export const DAY_CHOICES = {
  today: 'ต้องเสร็จวันนี้',
  tomorrow: 'ต้องเสร็จพรุ่งนี้',
  friday: 'ต้องเสร็จภายในสัปดาห์นี้',
  nextweek: 'ต้องเสร็จสัปดาห์หน้า',
  unknown: 'ข้อความไม่ได้บอกว่าต้องเสร็จเมื่อไหร่',
} as const;

export type DayChoice = Exclude<keyof typeof DAY_CHOICES, 'unknown'>;

export type AssistMember = { userId: string; name: string };

export type AssistRequest = {
  /** Only ask what is still missing: every question costs the same read. */
  needAssignee: boolean;
  needDueDate: boolean;
  members: AssistMember[];
};

/** The Jev questions for one message. Empty when nothing is missing. */
export function questionsFor(req: AssistRequest): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {
    is_task: {
      type: 'noul',
      instructions: 'ข้อความนี้เป็นการสั่งงานหรือขอให้ใครทำอะไรให้เสร็จ',
      criteria: {
        true: 'เป็นการมอบหมายงาน ขอให้ทำ หรือขอให้ส่งอะไรบางอย่าง',
        false: 'เป็นการคุยเล่น ถามข้อมูล หรือแจ้งให้ทราบเฉย ๆ',
      },
    },
  };

  if (req.needAssignee && req.members.length) {
    // Jev allows up to 255 options; a LINE group is far smaller, and
    // "unknown" has to be available or it must pick somebody.
    const criteria: Record<string, string> = { unknown: 'ข้อความไม่ได้บอกว่าให้ใครทำ' };
    for (const member of req.members.slice(0, 200)) {
      criteria[member.userId] = `งานนี้เป็นของ ${member.name}`;
    }
    questions.assignee = {
      type: 'choice',
      instructions: 'ใครคือคนที่ต้องทำงานนี้',
      criteria,
    };
  }

  if (req.needDueDate) {
    questions.due_day = {
      type: 'choice',
      instructions: 'ข้อความนี้บอกว่างานต้องเสร็จเมื่อไหร่',
      criteria: { ...DAY_CHOICES },
    };
  }

  return questions;
}

export type AssistReading = {
  /** False means "do not suggest a task from this at all". */
  looksLikeTask: boolean;
  assigneeUserId: string | null;
  dueDay: DayChoice | null;
};

function choice(answer: JevAnswer | undefined): { value: string; confidence: number } | null {
  if (!answer || answer.type !== 'choice' || typeof answer.choice !== 'string') return null;
  // No confidence reported is treated as not confident enough.
  return { value: answer.choice, confidence: answer.confidence ?? 0 };
}

/** Read Jev's answers, keeping only what it is confident about. */
export function readAnswers(
  answers: JevResult | null,
  members: AssistMember[],
): AssistReading {
  const empty: AssistReading = { looksLikeTask: false, assigneeUserId: null, dueDay: null };
  if (!answers) return empty;

  const isTask = answers.is_task;
  const looksLikeTask =
    !!isTask && isTask.type === 'noul' && typeof isTask.noul === 'number' && isTask.noul >= MIN_IS_TASK;
  if (!looksLikeTask) return empty;

  const who = choice(answers.assignee);
  const known = new Set(members.map((m) => m.userId));
  const assigneeUserId =
    who && who.confidence >= MIN_CONFIDENCE && who.value !== 'unknown' && known.has(who.value)
      ? who.value
      : null;

  const when = choice(answers.due_day);
  const dueDay =
    when && when.confidence >= MIN_CONFIDENCE && when.value in DAY_CHOICES && when.value !== 'unknown'
      ? (when.value as DayChoice)
      : null;

  return { looksLikeTask, assigneeUserId, dueDay };
}

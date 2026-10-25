import 'server-only';
import { and, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import { aiUsage, inboxItem, lineEvent } from './db/schema.ts';

/**
 * Throw away message content we no longer need.
 *
 * The rule is seven days or less. It was written down, and the schema comment
 * claimed it happened, but nothing implemented it — so every message anyone
 * had ever sent the bot was kept forever in line_event.payload, including the
 * text. That is invisible until the day it matters, which is exactly why it
 * needs a job rather than an intention.
 *
 * Two different lifetimes, for two different reasons:
 *
 * - The payload is content, and goes at seven days.
 * - The row itself is the webhook dedup record, and outlives the payload,
 *   because deleting it would let a LINE redelivery create the task a second
 *   time. LINE only retries for hours, so thirty days is generous; the row is
 *   just an id and a timestamp by then.
 */

export const CONTENT_DAYS = 7;

/**
 * Everything on a draft that holds the message's words: the text itself, and
 * (2026-10-25) what the model read from it and why. One set, cleared together
 * wherever the text goes — confirm, dismiss, unsend, and the job below.
 */
export const DRAFT_CONTENT_CLEARED = {
  rawMessage: null,
  aiReason: null,
  rulesReading: null,
  aiReading: null,
} as const;

const ROW_DAYS = 30;

export type RetentionResult = {
  inboxCleared: number;
  payloadsCleared: number;
  answersCleared: number;
  eventsDeleted: number;
};

export async function purgeExpiredContent(now = new Date()): Promise<RetentionResult> {
  const contentBefore = new Date(now.getTime() - CONTENT_DAYS * 86400000);
  const rowsBefore = new Date(now.getTime() - ROW_DAYS * 86400000);

  // Drafts nobody ever confirmed or dismissed. Confirming or dismissing
  // already clears the text; this catches the ones left sitting.
  const inboxCleared = await db()
    .update(inboxItem)
    .set(DRAFT_CONTENT_CLEARED)
    .where(and(isNotNull(inboxItem.rawMessage), lt(inboxItem.createdAt, contentBefore)))
    .returning({ id: inboxItem.id });

  // A stored AI answer (a summary, a reading) is kept only so a retry gets
  // the same answer free; after the same seven days only the count remains.
  const answersCleared = await db()
    .update(aiUsage)
    .set({ answer: sql`null` })
    .where(and(isNotNull(aiUsage.answer), lt(aiUsage.createdAt, contentBefore)))
    .returning({ id: aiUsage.id });

  // The event body, which holds the message text verbatim.
  const payloadsCleared = await db()
    .update(lineEvent)
    .set({ payload: sql`null` })
    .where(and(isNotNull(lineEvent.payload), lt(lineEvent.receivedAt, contentBefore)))
    .returning({ id: lineEvent.webhookEventId });

  const eventsDeleted = await db()
    .delete(lineEvent)
    .where(lt(lineEvent.receivedAt, rowsBefore))
    .returning({ id: lineEvent.webhookEventId });

  return {
    inboxCleared: inboxCleared.length,
    payloadsCleared: payloadsCleared.length,
    answersCleared: answersCleared.length,
    eventsDeleted: eventsDeleted.length,
  };
}

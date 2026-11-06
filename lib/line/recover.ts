import 'server-only';
import { and, asc, gt, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { lineEvent } from '../db/schema.ts';
import {
  claimUnfinishedEvent,
  MAX_EVENT_ATTEMPTS,
  processEvent,
  recordEventError,
  type LineEventPayload,
} from './handle-event.ts';

/**
 * Finish webhook events a run left unfinished (2026-11-06).
 *
 * LINE is answered 200 before the work is done, so it never redelivers an
 * event whose work then failed or was cut off. Without this, that message was
 * simply gone. The cron run calls it: events left with processed_at null for
 * five minutes are taken over under the same lease handleEvent uses, so two
 * passes (or a pass and a redelivery) never both run one.
 *
 * Only events with a stored payload can be re-run. The others are group
 * messages that did not tag the bot: nothing was asked of us, and the one
 * thing they do — letting the sender into the group's workspace — happens
 * again at their next message. Nothing older than a day is re-run: a draft
 * appearing days late would confuse more than it helps.
 *
 * The reply token has expired by now, so a recovered message gets no card in
 * the chat; its draft is in the app's LINE screen. Pushing a card instead
 * would cost quota for every recovery.
 */
const STALE_MS = 5 * 60_000;
const WINDOW_MS = 24 * 3600_000;
const BATCH = 20;

export type RecoveryResult = { found: number; recovered: number; failed: number };

export async function recoverWebhookEvents(
  now = new Date(),
  options: { process?: (event: LineEventPayload) => Promise<void> } = {},
): Promise<RecoveryResult> {
  const run = options.process ?? processEvent;
  const rows = await db()
    .select({ id: lineEvent.webhookEventId, payload: lineEvent.payload })
    .from(lineEvent)
    .where(
      and(
        isNull(lineEvent.processedAt),
        isNotNull(lineEvent.payload),
        lt(lineEvent.receivedAt, new Date(now.getTime() - STALE_MS)),
        gt(lineEvent.receivedAt, new Date(now.getTime() - WINDOW_MS)),
        lt(lineEvent.attempts, MAX_EVENT_ATTEMPTS),
        or(isNull(lineEvent.claimedUntil), lt(lineEvent.claimedUntil, now)),
      ),
    )
    .orderBy(asc(lineEvent.receivedAt))
    .limit(BATCH);

  const result: RecoveryResult = { found: rows.length, recovered: 0, failed: 0 };
  for (const row of rows) {
    if (!(await claimUnfinishedEvent(row.id, now))) continue;
    try {
      await run(row.payload as LineEventPayload);
      result.recovered += 1;
    } catch (error) {
      result.failed += 1;
      await recordEventError(row.id, error);
    }
  }
  return result;
}

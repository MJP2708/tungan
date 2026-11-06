import 'server-only';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { lineQuota, messageUsage } from '../db/schema.ts';
import { lineFetch } from './fetch.ts';

/**
 * The LINE Official Account's monthly quota, shared by every workspace
 * (2026-11-06).
 *
 * Each workspace has its own cap, but those are a fairness share: five teams
 * can each be under theirs while the account as a whole runs out, after which
 * every push fails. So before any push, the account's total is checked too.
 *
 * LINE is asked at most every CHECK_MS (two calls: the plan's limit and this
 * month's consumption), kept in the database rather than in memory because
 * each serverless instance has its own memory. Pushes this app made since
 * that answer are added on top, so a burst cannot overshoot between reads.
 * A reserve is held back for the messages that matter most at the end of a
 * month. When LINE cannot be read, the push is allowed and the workspace cap
 * still applies: a reminder is not dropped because a quota read failed.
 */
const CHECK_MS = 5 * 60_000;
const RESERVE = 0.05;
const ROW = 'oa';

export type OaQuota = { limit: number | null; used: number; exhaustedMonth: string | null };

export async function oaQuota(
  month: string,
  options: { fetchImpl?: typeof fetch; now?: Date; monthOf: (at: Date) => string },
): Promise<OaQuota | null> {
  const now = options.now ?? new Date();
  let [row] = await db().select().from(lineQuota).where(eq(lineQuota.id, ROW)).limit(1);
  const stale = !row || now.getTime() - row.checkedAt.getTime() > CHECK_MS || options.monthOf(row.checkedAt) !== month;
  if (stale) {
    const fresh = await readFromLine(options.fetchImpl);
    if (fresh) {
      const values = { monthlyLimit: fresh.limit, used: fresh.used, checkedAt: now };
      [row] = await db()
        .insert(lineQuota)
        .values({ id: ROW, ...values })
        .onConflictDoUpdate({ target: lineQuota.id, set: values })
        .returning();
    } else if (!row || options.monthOf(row.checkedAt) !== month) {
      // Nothing usable: last month's count says nothing about this one.
      return row?.exhaustedMonth === month ? { limit: null, used: 0, exhaustedMonth: month } : null;
    }
  }
  const [since] = await db()
    .select({ n: sql<number>`coalesce(sum(${messageUsage.recipientCount}), 0)` })
    .from(messageUsage)
    .where(and(eq(messageUsage.channel, 'push'), gt(messageUsage.at, row.checkedAt)));
  return { limit: row.monthlyLimit, used: row.used + Number(since?.n ?? 0), exhaustedMonth: row.exhaustedMonth };
}

/** Would one more push take the account past its limit, less the reserve? */
export function accountFull(quota: OaQuota | null, month: string): boolean {
  if (!quota) return false;
  if (quota.exhaustedMonth === month) return true;
  if (quota.limit === null) return false;
  return quota.used + 1 > quota.limit - Math.ceil(quota.limit * RESERVE);
}

/** LINE refused a push for the month: stop until the month turns. */
export async function markAccountExhausted(month: string, now = new Date()) {
  await db()
    .insert(lineQuota)
    .values({ id: ROW, used: 0, checkedAt: now, exhaustedMonth: month })
    .onConflictDoUpdate({ target: lineQuota.id, set: { exhaustedMonth: month } });
}

/** The cached figures, for /api/health. Never calls LINE. */
export async function cachedOaQuota() {
  const [row] = await db().select().from(lineQuota).where(eq(lineQuota.id, ROW)).limit(1);
  return row ? { used: row.used, limit: row.monthlyLimit, checkedAt: row.checkedAt, exhaustedMonth: row.exhaustedMonth } : null;
}

async function readFromLine(fetchImpl?: typeof fetch): Promise<{ limit: number | null; used: number } | null> {
  try {
    const [plan, consumption] = await Promise.all([
      lineFetch('https://api.line.me/v2/bot/message/quota', { method: 'GET' }, fetchImpl),
      lineFetch('https://api.line.me/v2/bot/message/quota/consumption', { method: 'GET' }, fetchImpl),
    ]);
    if (!plan.ok || !consumption.ok) return null;
    const p = (await plan.json()) as { type?: string; value?: number };
    const c = (await consumption.json()) as { totalUsage?: number };
    if (p.type !== 'none' && p.type !== 'limited') return null;
    if (typeof c.totalUsage !== 'number') return null;
    return { limit: p.type === 'limited' && typeof p.value === 'number' ? p.value : null, used: c.totalUsage };
  } catch {
    return null;
  }
}

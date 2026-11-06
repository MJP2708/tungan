import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import { cachedOaQuota } from './line/quota.ts';

/**
 * What /api/health answers (2026-11-06). Anyone gets `ready` and nothing
 * else; `full` — the caller sent the cron secret — adds the detail: when
 * reminders last went out, how many are due, unfinished webhook events, the
 * LINE quota. That detail showed anyone how busy the product is. Even in
 * full it reports only whether each setting is present, never a value or a
 * host.
 */
export async function healthReport(full: boolean): Promise<{ status: number; body: Record<string, unknown> }> {
  const present = (name: string) => Boolean(process.env[name]);
  const env = {
    DATABASE_URL: present('DATABASE_URL'),
    LINE_LOGIN_CHANNEL_ID: present('LINE_LOGIN_CHANNEL_ID'),
    LINE_LOGIN_CHANNEL_SECRET: present('LINE_LOGIN_CHANNEL_SECRET'),
    LINE_MESSAGING_CHANNEL_SECRET: present('LINE_MESSAGING_CHANNEL_SECRET'),
    LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: present('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN'),
    APP_BASE_URL: present('APP_BASE_URL'),
    NEXT_PUBLIC_LIFF_ID: present('NEXT_PUBLIC_LIFF_ID'),
    // Without it the scheduler is refused and every reminder silently stays
    // pending. The route cannot say which of "no secret" or "wrong secret"
    // it hit — correctly, since that would help an attacker — so presence is
    // reported here instead, where it is only a boolean.
    CRON_SECRET: present('CRON_SECRET'),
  };

  let database: 'ok' | 'unreachable' | 'not_configured' = 'not_configured';
  let tables = 0;
  if (env.DATABASE_URL) {
    try {
      const rows = await db().execute(
        sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
      );
      tables = Number((rows as unknown as { rows: { n: number }[] }).rows?.[0]?.n ?? 0);
      database = 'ok';
    } catch {
      database = 'unreachable';
    }
  }

  // When reminders last went out. A scheduler that stopped being called looks
  // exactly like a quiet week from the outside, which is how a dead reminder
  // system goes unnoticed for a month.
  let remindersLastSentAt: string | null = null;
  let remindersDueNow: number | null = null;
  // LINE messages left unfinished for 10 minutes: the recovery pass should
  // have picked them up, so a number here that stays up means it is not.
  let webhookUnprocessed: number | null = null;
  // The LINE account's own quota, shared by every workspace, as last read
  // from LINE (never fetched here).
  let oaQuotaUsed: number | null = null;
  let oaQuotaLimit: number | null = null;
  if (full && env.DATABASE_URL && database === 'ok') {
    try {
      const rows = await db().execute(
        sql`select max(sent_at) as last_sent,
                   count(*) filter (where state = 'pending' and send_at <= now())::int as due_now
              from reminder`,
      );
      const row = (rows as unknown as { rows: { last_sent: string | null; due_now: number }[] }).rows?.[0];
      remindersLastSentAt = row?.last_sent ?? null;
      remindersDueNow = Number(row?.due_now ?? 0);
      const pending = await db().execute(
        sql`select count(*)::int as n from line_event
             where processed_at is null and received_at < now() - interval '10 minutes'
               and received_at > now() - interval '7 days'`,
      );
      webhookUnprocessed = Number(
        (pending as unknown as { rows: { n: number }[] }).rows?.[0]?.n ?? 0,
      );
      const quota = await cachedOaQuota();
      oaQuotaUsed = quota?.used ?? null;
      oaQuotaLimit = quota?.limit ?? null;
    } catch {
      // Non-fatal: readiness does not depend on it.
    }
  }

  const ready = Object.values(env).every(Boolean) && database === 'ok' && tables >= 14;
  if (!full) return { status: ready ? 200 : 503, body: { ready } };
  return {
    status: ready ? 200 : 503,
    body: { ready, env, database, tables, remindersLastSentAt, remindersDueNow, webhookUnprocessed, oaQuotaUsed, oaQuotaLimit },
  };
}

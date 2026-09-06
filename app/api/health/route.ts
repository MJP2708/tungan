import { NextResponse } from 'next/server';
import { db } from '@/lib/db/index.ts';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Readiness check for deployment. Reports only whether each value is present
 * and whether the database answers — never a value, a host or a length, so it
 * is safe to leave reachable.
 */
export async function GET() {
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
  if (env.DATABASE_URL && database === 'ok') {
    try {
      const rows = await db().execute(
        sql`select max(sent_at) as last_sent,
                   count(*) filter (where state = 'pending' and send_at <= now())::int as due_now
              from reminder`,
      );
      const row = (rows as unknown as { rows: { last_sent: string | null; due_now: number }[] }).rows?.[0];
      remindersLastSentAt = row?.last_sent ?? null;
      remindersDueNow = Number(row?.due_now ?? 0);
    } catch {
      // Non-fatal: readiness does not depend on it.
    }
  }

  const ready = Object.values(env).every(Boolean) && database === 'ok' && tables >= 14;
  return NextResponse.json(
    { ready, env, database, tables, remindersLastSentAt, remindersDueNow },
    { status: ready ? 200 : 503 },
  );
}

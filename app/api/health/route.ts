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

  const ready = Object.values(env).every(Boolean) && database === 'ok' && tables >= 14;
  return NextResponse.json({ ready, env, database, tables }, { status: ready ? 200 : 503 });
}

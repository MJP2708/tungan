import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { dispatchDueReminders } from '@/lib/reminders/dispatch.ts';
import { purgeExpiredContent } from '@/lib/retention.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Long enough to work through a batch without being cut off mid-send.
export const maxDuration = 60;

/**
 * Deliver reminders that are due.
 *
 * Protected by CRON_SECRET rather than a session, because the caller is a
 * scheduler, not a person. Deliberately not tied to one scheduler: Vercel Cron
 * sends `Authorization: Bearer <CRON_SECRET>`, and any other caller can send
 * the same header or `?key=`, so the hosting decision stays open. Vercel's free
 * plan only allows one cron run per day, which is useless for reminders, so
 * this has to work from an external scheduler too.
 */
function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ')
    ? header.slice(7)
    : (new URL(req.url).searchParams.get('key') ?? '');
  if (provided.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

async function run(req: Request) {
  if (!authorised(req)) {
    console.warn('[cron][rejected] bad or missing CRON_SECRET');
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  const result = await dispatchDueReminders();

  // Retention rides along on the same run. The free plan allows one scheduled
  // job, so a second endpoint would simply never be called — and a retention
  // rule nothing calls is the state this started in.
  let retention: Awaited<ReturnType<typeof purgeExpiredContent>> | null = null;
  try {
    retention = await purgeExpiredContent();
  } catch (error) {
    // Never let housekeeping stop a reminder going out.
    console.error('[cron] retention failed', (error as Error).message);
  }

  // Logged so a run that sends nothing is distinguishable from one that
  // never happened.
  console.log('[cron] reminders', JSON.stringify(result), 'retention', JSON.stringify(retention));
  return NextResponse.json({ ok: true, ...result, retention });
}

export const GET = run;
export const POST = run;

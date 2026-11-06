import { NextResponse } from 'next/server';
import { recoverWebhookEvents } from '@/lib/line/recover.ts';
import { safeErrorMessage } from '@/lib/log.ts';
import { hasCronSecret } from '@/lib/auth/cron-secret.ts';
import { dispatchDueReminders } from '@/lib/reminders/dispatch.ts';
import { schedulerCheckIn } from '@/lib/reminders/heartbeat.ts';
import { schedulerOf } from '@/lib/reminders/scheduler.ts';
import { purgeExpiredContent } from '@/lib/retention.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Long enough to work through a batch without being cut off mid-send.
export const maxDuration = 60;

/**
 * Deliver reminders that are due.
 *
 * Protected by CRON_SECRET rather than a session, because the caller is a
 * scheduler, not a person. Three call it (lib/reminders/scheduler.ts):
 * cron-job.org every 15 minutes (the primary), GitHub Actions as the backup
 * and alarm, and Vercel's once-a-day cron as a last resort. All send
 * `Authorization: Bearer <CRON_SECRET>` (lib/auth/cron-secret.ts).
 */

async function run(req: Request) {
  if (!hasCronSecret(req)) {
    console.warn('[cron][rejected] bad or missing CRON_SECRET');
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  const result = await dispatchDueReminders();

  // Which scheduler this was, and whether the scheduling is keeping up. The
  // GitHub backup fails its run on either flag, and GitHub emails the owner:
  // a dead scheduler reaches a person, not a user complaint.
  let scheduling: Awaited<ReturnType<typeof schedulerCheckIn>> | null = null;
  try {
    scheduling = await schedulerCheckIn(schedulerOf(req.headers));
    if (scheduling.stale) {
      console.error('[cron][stale] reminders are overdue and nothing has been sent for over a day', JSON.stringify(scheduling));
    }
    if (scheduling.primarySilent) {
      console.error('[cron][primary-silent] cron-job.org has not called in 90 minutes', JSON.stringify(scheduling));
    }
  } catch (error) {
    console.error('[cron] scheduler check failed', safeErrorMessage(error));
  }

  // Retention rides along on the same run. The free plan allows one scheduled
  // job, so a second endpoint would simply never be called — and a retention
  // rule nothing calls is the state this started in.
  let retention: Awaited<ReturnType<typeof purgeExpiredContent>> | null = null;
  try {
    retention = await purgeExpiredContent();
  } catch (error) {
    // Never let housekeeping stop a reminder going out.
    console.error('[cron] retention failed', safeErrorMessage(error));
  }

  // LINE messages whose work was cut off. Same reason as retention: never
  // let it stop a reminder.
  let webhook: Awaited<ReturnType<typeof recoverWebhookEvents>> | null = null;
  try {
    webhook = await recoverWebhookEvents();
  } catch (error) {
    console.error('[cron] webhook recovery failed', safeErrorMessage(error));
  }

  // Logged so a run that sends nothing is distinguishable from one that
  // never happened.
  console.log(
    '[cron] reminders', JSON.stringify(result),
    'retention', JSON.stringify(retention),
    'webhook', JSON.stringify(webhook),
  );
  return NextResponse.json({ ok: true, ...result, retention, webhook, scheduling });
}

export const GET = run;
export const POST = run;

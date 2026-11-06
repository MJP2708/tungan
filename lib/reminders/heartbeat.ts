import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { schedulerHeartbeat } from '../db/schema.ts';
import { schedulerHealth, type Scheduler } from './scheduler.ts';

/** Note the call, then say whether the scheduling is keeping up. */
export async function schedulerCheckIn(scheduler: Scheduler, now = new Date()) {
  await db()
    .insert(schedulerHeartbeat)
    .values({ name: scheduler, lastSeenAt: now })
    .onConflictDoUpdate({ target: schedulerHeartbeat.name, set: { lastSeenAt: now } });

  const rows = await db().execute(sql`
    select (select last_seen_at from scheduler_heartbeat where name = 'primary') as primary_last,
           (select max(sent_at) from reminder) as last_sent,
           (select count(*)::int from reminder
             where state = 'pending' and send_at < ${new Date(now.getTime() - 3600_000)}) as overdue
  `);
  const row = (rows as unknown as { rows: Array<{ primary_last: string | null; last_sent: string | null; overdue: number }> }).rows[0];
  const [hh, mm] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now).split(':').map(Number);
  const bangkokMinutes = hh * 60 + mm;
  const primaryLastSeenAt = row?.primary_last ? new Date(row.primary_last) : null;
  const health = schedulerHealth({
    now,
    bangkokMinutes,
    primaryLastSeenAt,
    remindersLastSentAt: row?.last_sent ? new Date(row.last_sent) : null,
    overdueReminders: Number(row?.overdue ?? 0),
  });
  return { ...health, primaryLastSeenAt, overdueReminders: Number(row?.overdue ?? 0) };
}

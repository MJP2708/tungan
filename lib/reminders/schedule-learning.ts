import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { memberSchedule } from '../db/schema.ts';
import { PRODUCT_TIME_ZONE, type WorkingHours } from './policy.ts';
import { DEFAULT_WORKING_HOURS } from './policy.ts';

/**
 * Learn when someone is actually at work, from when they act.
 *
 * A single 09:00 for the whole workspace sends the morning nudge to a
 * night-shift installer while they are asleep, and a reminder read six hours
 * late did nothing. So the start of someone's day is inferred from the
 * earliest time they are seen doing things, averaged over many days.
 *
 * Two deliberate limits. It only ever moves the *start* of the day, never
 * builds a picture of when someone stops working — the second is monitoring,
 * not scheduling. And the moment a person edits their own hours, observation
 * stops overwriting them: an inference someone has corrected is no longer an
 * inference.
 */

/** Ignore the small hours: a 03:00 reply is an exception, not a working day. */
const EARLIEST_PLAUSIBLE = 5 * 60;
const LATEST_PLAUSIBLE = 12 * 60;
/** Below this the average is too noisy to act on. */
const MIN_SAMPLES = 5;

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function hhmm(minutes: number) {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Record that this person was active now. Cheap, and called on every action. */
export async function noteActivity(
  workspaceId: string,
  userId: string,
  at: Date = new Date(),
  timeZone: string = PRODUCT_TIME_ZONE,
) {
  const minutes = minutesOf(
    new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(at),
  );
  if (minutes < EARLIEST_PLAUSIBLE || minutes > LATEST_PLAUSIBLE) return;

  await db()
    .insert(memberSchedule)
    .values({
      workspaceId,
      userId,
      observedStartMinutes: minutes,
      samples: 1,
    })
    .onConflictDoUpdate({
      target: [memberSchedule.workspaceId, memberSchedule.userId],
      set: {
        // A running mean, so one early morning does not move the whole
        // schedule, and no history of individual timestamps is kept.
        observedStartMinutes: sql`
          case when ${memberSchedule.isManual} then ${memberSchedule.observedStartMinutes}
          else ((coalesce(${memberSchedule.observedStartMinutes}, ${minutes}) * ${memberSchedule.samples}) + ${minutes})
               / (${memberSchedule.samples} + 1)
          end`,
        samples: sql`${memberSchedule.samples} + 1`,
        updatedAt: new Date(),
      },
    });
}

/** The hours to schedule against for this person, with the workspace as the fallback. */
export async function workingHoursFor(
  workspaceId: string,
  userId: string,
  fallback: WorkingHours = DEFAULT_WORKING_HOURS,
): Promise<WorkingHours & { source: 'manual' | 'learned' | 'workspace' }> {
  const rows = await db()
    .select()
    .from(memberSchedule)
    .where(and(eq(memberSchedule.workspaceId, workspaceId), eq(memberSchedule.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return { ...fallback, source: 'workspace' };
  if (row.isManual) return { startsAt: row.startsAt, endsAt: row.endsAt, source: 'manual' };
  if (row.observedStartMinutes != null && row.samples >= MIN_SAMPLES) {
    return {
      startsAt: hhmm(row.observedStartMinutes),
      endsAt: fallback.endsAt,
      source: 'learned',
    };
  }
  return { ...fallback, source: 'workspace' };
}

/** A person setting their own hours, which stops observation overwriting them. */
export async function setSchedule(
  workspaceId: string,
  userId: string,
  startsAt: string,
  endsAt: string,
) {
  await db()
    .insert(memberSchedule)
    .values({ workspaceId, userId, startsAt, endsAt, isManual: true })
    .onConflictDoUpdate({
      target: [memberSchedule.workspaceId, memberSchedule.userId],
      set: { startsAt, endsAt, isManual: true, updatedAt: new Date() },
    });
}

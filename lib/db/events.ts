import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from './index.ts';
import { taskEvent, lineUser } from './schema.ts';
import {
  readableLevels,
  type Audience,
  type Visibility,
} from '../events/visibility.ts';

/**
 * The only way to read task events.
 *
 * The visibility rule is applied here, in the WHERE clause, rather than by
 * each view filtering what it was handed. A rule enforced per view is a rule
 * that leaks the first time somebody adds a view — and the note it leaks is
 * the one somebody wrote believing only their manager would read it.
 *
 * tests/visibility.test.ts asserts that no route selects from task_event
 * directly, which is what keeps that true as the app grows.
 */

export type VisibleEvent = {
  id: string;
  taskId: string;
  kind: string;
  detail: string;
  at: Date;
  visibility: string;
  actorUserId: string | null;
  actorName: string | null;
};

const columns = {
  id: taskEvent.id,
  taskId: taskEvent.taskId,
  kind: taskEvent.kind,
  detail: taskEvent.detail,
  at: taskEvent.at,
  visibility: taskEvent.visibility,
  actorUserId: taskEvent.actorUserId,
  actorName: lineUser.displayName,
};

/** The WHERE fragment. Never exported without a task or workspace alongside it. */
function allowed(audience: Audience) {
  return inArray(taskEvent.visibility, readableLevels(audience) as unknown as string[]);
}

/** One task's history, oldest first, as this audience is allowed to see it. */
export async function listTaskEvents(
  taskId: string,
  audience: Audience,
): Promise<VisibleEvent[]> {
  return db()
    .select(columns)
    .from(taskEvent)
    .leftJoin(lineUser, eq(lineUser.id, taskEvent.actorUserId))
    .where(and(eq(taskEvent.taskId, taskId), allowed(audience)))
    .orderBy(asc(taskEvent.at));
}

/**
 * The most recent event of the given kinds for each of several tasks.
 *
 * Used by the blocked list, where the reader needs what somebody is waiting
 * on. An audience that cannot read the reason gets no row rather than a
 * redacted one, so the caller has to say "blocked" without inventing a why.
 */
export async function latestEventPerTask(
  taskIds: string[],
  kinds: string[],
  audience: Audience,
): Promise<Map<string, VisibleEvent>> {
  const latest = new Map<string, VisibleEvent>();
  if (!taskIds.length) return latest;
  const rows = await db()
    .select(columns)
    .from(taskEvent)
    .leftJoin(lineUser, eq(lineUser.id, taskEvent.actorUserId))
    .where(
      and(
        inArray(taskEvent.taskId, taskIds),
        inArray(taskEvent.kind, kinds),
        allowed(audience),
      ),
    )
    .orderBy(desc(taskEvent.at));
  for (const row of rows) if (!latest.has(row.taskId)) latest.set(row.taskId, row);
  return latest;
}

/**
 * One event by id, ignoring visibility.
 *
 * Undo needs the row it is reversing whether or not the actor could read it
 * as history, and it already checks that the caller is the actor. Named so
 * that using it by mistake is hard to do quietly.
 */
export async function findEventForUndo(eventId: string) {
  const rows = await db().select().from(taskEvent).where(eq(taskEvent.id, eventId)).limit(1);
  return rows[0] ?? null;
}

export async function setEventVisibility(eventId: string, visibility: Visibility) {
  await db().update(taskEvent).set({ visibility }).where(eq(taskEvent.id, eventId));
}

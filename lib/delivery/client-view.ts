import 'server-only';
import { and, eq, gte, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { task } from '../db/schema.ts';
import { listTaskEvents } from '../db/events.ts';

/**
 * What the agency's client is allowed to see.
 *
 * One builder for every client-facing surface — the delivery summary today,
 * the signed approval link later — so there is a single place where the
 * question "can the client see this?" is answered. Two places answering it
 * separately is how they end up disagreeing.
 *
 * Notes reach here only through listTaskEvents with the `client` audience, so
 * a private ติดปัญหา note cannot appear even if a caller asks for one.
 */

export type ClientTask = {
  id: string;
  title: string;
  dueAt: Date | null;
  evidenceUrl: string | null;
  closedAt: Date | null;
  submittedAt: Date | null;
  /** Only notes deliberately marked client-visible. Usually empty. */
  notes: { detail: string; at: Date }[];
};

/** Closed work in the window, newest first. Nothing still in review. */
export async function clientDelivery(params: {
  workspaceId: string;
  days: number;
}): Promise<ClientTask[]> {
  const since = new Date(Date.now() - params.days * 86400000);
  const closedAt = sql`coalesce(${task.closedAt}, ${task.updatedAt})`;

  const rows = await db()
    .select({
      id: task.id,
      title: task.title,
      dueAt: task.dueAt,
      evidenceUrl: task.evidenceUrl,
      closedAt: task.closedAt,
      submittedAt: task.submittedAt,
      updatedAt: task.updatedAt,
    })
    .from(task)
    // Closed only. Work a worker has handed in but nobody has approved is not
    // delivered, and showing it as delivered is the exact confusion the split
    // between submitted and closed exists to prevent.
    .where(
      and(
        eq(task.workspaceId, params.workspaceId),
        eq(task.status, 'done'),
        gte(closedAt, since),
      ),
    )
    .orderBy(desc(closedAt));

  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      title: r.title,
      dueAt: r.dueAt,
      evidenceUrl: r.evidenceUrl,
      closedAt: r.closedAt ?? r.updatedAt,
      submittedAt: r.submittedAt,
      notes: (await listTaskEvents(r.id, 'client')).map((e) => ({
        detail: e.detail,
        at: e.at,
      })),
    })),
  );
}

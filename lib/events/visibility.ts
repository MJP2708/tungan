/**
 * Who can read which note.
 *
 * People report problems honestly only when the report is not broadcast. So a
 * ติดปัญหา note is private by default: the task shows as blocked to everyone,
 * and only the intended reader learns why.
 *
 * These rules are pure on purpose. The database layer in lib/db/events.ts
 * turns them into a WHERE clause so nothing is filtered after the fact, and
 * this file can be tested without a database — the test that matters is the
 * one proving a private note cannot reach the group or the client.
 */

export const VISIBILITY_LEVELS = ['private', 'workspace', 'client'] as const;
export type Visibility = (typeof VISIBILITY_LEVELS)[number];

/**
 * Where the note is about to be shown.
 *
 * `group` is a LINE group reply, `client` is the delivery summary and the
 * client approval page, `workspace` is the in-app team view, and `private` is
 * the worker and the manager reading the task itself.
 */
export type Audience = 'client' | 'group' | 'workspace' | 'private';

/**
 * The levels each audience may ever see.
 *
 * Written as data rather than a chain of conditions so that adding a surface
 * forces a decision here instead of a guess at the call site.
 */
const READABLE: Record<Audience, readonly Visibility[]> = {
  // The agency's client sees only what was deliberately marked for them.
  client: ['client'],
  // A group is a broadcast. Anything posted there is seen by everyone in it,
  // including people who joined after the note was written.
  group: ['workspace', 'client'],
  workspace: ['workspace', 'client'],
  private: ['private', 'workspace', 'client'],
};

export function readableLevels(audience: Audience): readonly Visibility[] {
  return READABLE[audience];
}

export function isVisibility(value: unknown): value is Visibility {
  return VISIBILITY_LEVELS.includes(value as Visibility);
}

/** Anything unrecognised is treated as private rather than as public. */
export function normalizeVisibility(value: unknown, fallback: Visibility = 'workspace'): Visibility {
  if (isVisibility(value)) return value;
  return fallback;
}

/**
 * Whether this viewer is one of the two people a private note is for.
 *
 * "Worker ↔ manager": the person who wrote it, the person doing the task, the
 * person who asked for it, and whoever has to sign it off. A workspace owner
 * counts because they already have review rights over the work; another member
 * with no connection to the task does not, even though they can see the task.
 */
export function canReadPrivate(params: {
  viewerUserId: string;
  role: string;
  event?: { actorUserId?: string | null };
  task: {
    assigneeUserId?: string | null;
    primaryAssigneeUserId?: string | null;
    createdByUserId?: string | null;
    reviewerUserId?: string | null;
  };
}): boolean {
  const { viewerUserId, role, event, task } = params;
  if (!viewerUserId) return false;
  if (event?.actorUserId === viewerUserId) return true;
  if (role === 'owner' || role === 'admin') return true;
  return (
    task.assigneeUserId === viewerUserId ||
    task.primaryAssigneeUserId === viewerUserId ||
    task.createdByUserId === viewerUserId ||
    task.reviewerUserId === viewerUserId
  );
}

/**
 * The audience to read a task's history as.
 *
 * Everyone in a workspace can see the task; not everyone can see why it is
 * stuck. A member with no connection to the task drops to the workspace
 * audience, which is the same thing the group would see.
 */
export function audienceForViewer(params: {
  viewerUserId: string;
  role: string;
  task: Parameters<typeof canReadPrivate>[0]['task'];
}): Audience {
  return canReadPrivate(params) ? 'private' : 'workspace';
}

/**
 * Filter already-loaded events. The database layer applies the same rule in
 * SQL; this exists for the places holding rows in memory, and for the tests.
 */
export function filterByAudience<T extends { visibility?: string | null }>(
  events: readonly T[],
  audience: Audience,
): T[] {
  const allowed = readableLevels(audience);
  return events.filter((e) =>
    allowed.includes(normalizeVisibility(e.visibility) as Visibility),
  );
}

/** What to tell the person writing the note about who will read it. */
export function audienceLabel(visibility: Visibility): string {
  switch (visibility) {
    case 'private':
      return 'เห็นเฉพาะคุณกับหัวหน้า';
    case 'workspace':
      return 'ทุกคนในพื้นที่งานเห็น';
    case 'client':
      return 'ลูกค้าเห็นด้วย';
  }
}

/**
 * The default level for each kind of event.
 *
 * ติดปัญหา and ขอข้อมูลเพิ่ม carry a reason, and a reason posted to the group
 * is the thing that stops people writing honest ones. Everything else is a
 * plain state change with no private content in it.
 */
export function defaultVisibilityFor(kind: string): Visibility {
  return kind === 'blocked' || kind === 'info' ? 'private' : 'workspace';
}

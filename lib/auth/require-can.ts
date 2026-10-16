import 'server-only';
import { HttpError } from '../http-error.ts';
import { requireSession } from './session.ts';
import { assertCan } from './roles.ts';
import type { Action, Extra, GroupFacts, TaskFacts } from '../permissions.ts';

/**
 * Route guard: the session's user, allowed to do `action` in this group —
 * or refused (can(), via lib/auth/roles.ts). Separate from roles.ts so the
 * role facts stay importable outside a request (dispatcher, tests).
 */
export async function requireCan(
  workspaceId: string,
  action: Action,
  task?: TaskFacts | null,
  extra?: Extra,
): Promise<{ userId: string; facts: GroupFacts }> {
  const user = await requireSession();
  if (!workspaceId) throw new HttpError(400, 'ต้องระบุพื้นที่งาน');
  const facts = await assertCan({ userId: user.userId, workspaceId, action, task, extra });
  return { userId: user.userId, facts };
}

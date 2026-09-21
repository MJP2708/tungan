import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { groupWorkspace, lineGroupMember, workspaceMember } from '../db/schema.ts';
import { HttpError } from './session.ts';

/**
 * Can this person be given work in this workspace?
 *
 * Yes if they are a member, or if we have seen them in a LINE group bound to
 * the workspace (they may not have signed in yet — the LINE user id is the
 * identity). Nobody else.
 *
 * Every route that takes a person id from the client — assignee, handoff
 * target, question recipient, reminder recipient — must pass it through here.
 * Without it, a crafted request could put another company's user on a task,
 * and the reminder would DM them its title: a cross-workspace leak.
 */
export async function isAssignable(workspaceId: string, userId: string): Promise<boolean> {
  const member = await db()
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
    .limit(1);
  if (member.length) return true;

  const seen = await db()
    .select({ userId: lineGroupMember.userId })
    .from(lineGroupMember)
    .innerJoin(groupWorkspace, eq(groupWorkspace.lineGroupId, lineGroupMember.lineGroupId))
    .where(and(eq(groupWorkspace.workspaceId, workspaceId), eq(lineGroupMember.userId, userId)))
    .limit(1);
  return seen.length > 0;
}

/** Throws 400 unless the id is empty or someone in this workspace. */
export async function assertAssignable(
  workspaceId: string,
  userId: unknown,
): Promise<string | null> {
  if (userId === null || userId === undefined || userId === '') return null;
  if (typeof userId !== 'string' || !(await isAssignable(workspaceId, userId))) {
    throw new HttpError(400, 'คนนี้ไม่ได้อยู่ในพื้นที่งานนี้');
  }
  return userId;
}

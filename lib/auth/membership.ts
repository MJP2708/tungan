import 'server-only';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  lineGroupMember,
  groupWorkspace,
  workspaceMember,
  lineUser,
} from '../db/schema.ts';

/**
 * Give a signed-in user access to every workspace whose LINE group they are
 * in.
 *
 * The LINE group *is* the team: someone standing in the group already reads
 * every message the bot reads, so withholding the workspace would hide their
 * own team's tasks from them while the person who happened to connect the
 * group sees everything. Membership is granted as `member`, never `owner`,
 * so joining a group cannot escalate anyone.
 *
 * Access still flows only from the verified LINE user id, and only for groups
 * we have actually seen them in — the same rule that guards binding.
 */
export async function syncGroupMemberships(userId: string): Promise<string[]> {
  const eligible = await db()
    .selectDistinct({ workspaceId: groupWorkspace.workspaceId })
    .from(lineGroupMember)
    .innerJoin(groupWorkspace, eq(groupWorkspace.lineGroupId, lineGroupMember.lineGroupId))
    .where(eq(lineGroupMember.userId, userId));

  if (!eligible.length) return [];

  const already = await db()
    .select({ workspaceId: workspaceMember.workspaceId })
    .from(workspaceMember)
    .where(eq(workspaceMember.userId, userId));
  const have = new Set(already.map((r) => r.workspaceId));

  const missing = eligible.map((r) => r.workspaceId).filter((id) => !have.has(id));
  if (!missing.length) return [];

  const profile = await db()
    .select({ displayName: lineUser.displayName })
    .from(lineUser)
    .where(eq(lineUser.id, userId))
    .limit(1);

  await db()
    .insert(workspaceMember)
    .values(
      missing.map((workspaceId) => ({
        workspaceId,
        userId,
        role: 'member',
        nickname: profile[0]?.displayName ?? '',
      })),
    )
    .onConflictDoNothing();

  return missing;
}

/**
 * Grant access to everyone we already know is in this group.
 *
 * Called when a group is bound, so the rest of the team does not have to wait
 * until their next sign-in to see the workspace.
 */
export async function grantWorkspaceToGroup(
  lineGroupRowId: string,
  workspaceId: string,
): Promise<number> {
  const members = await db()
    .select({ userId: lineGroupMember.userId })
    .from(lineGroupMember)
    .where(eq(lineGroupMember.lineGroupId, lineGroupRowId));
  if (!members.length) return 0;

  const existing = await db()
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(eq(workspaceMember.workspaceId, workspaceId));
  const have = new Set(existing.map((r) => r.userId));

  const toAdd = members.map((m) => m.userId).filter((id) => !have.has(id));
  if (!toAdd.length) return 0;

  const names = await db()
    .select({ id: lineUser.id, displayName: lineUser.displayName })
    .from(lineUser)
    .where(inArray(lineUser.id, toAdd));
  const nameOf = new Map(names.map((n) => [n.id, n.displayName]));

  await db()
    .insert(workspaceMember)
    .values(
      toAdd.map((userId) => ({
        workspaceId,
        userId,
        role: 'member',
        nickname: nameOf.get(userId) ?? '',
      })),
    )
    .onConflictDoNothing();

  return toAdd.length;
}

import 'server-only';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  lineGroupMember,
  groupWorkspace,
  workspaceMember,
  lineUser,
  lineGroup,
  workspace,
} from '../db/schema.ts';
import { isUniqueViolation } from '../db/errors.ts';

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

  // Opening the app counts as stepping up: a group workspace that set itself
  // up has no owner until someone from the group arrives.
  for (const workspaceId of eligible.map((r) => r.workspaceId)) {
    await claimOwnershipIfNone(workspaceId, userId);
  }

  return missing;
}

/**
 * A LINE group's own workspace, made the moment the bot is in the group
 * (2026-10-08). Nobody has to open the app and press anything: the
 * workspace is named after the group, bound to it, and everyone seen in the
 * group is let in as they appear. If two events race, the unique index on
 * group_workspace keeps one and the other's empty workspace is removed.
 */
export async function ensureGroupWorkspace(lineGroupRowId: string): Promise<string> {
  const bound = await boundWorkspaceOf(lineGroupRowId);
  if (bound) return bound;

  const [group] = await db()
    .select({ name: lineGroup.name })
    .from(lineGroup)
    .where(eq(lineGroup.id, lineGroupRowId))
    .limit(1);
  const workspaceId = crypto.randomUUID();
  await db().insert(workspace).values({ id: workspaceId, name: group?.name || 'ทีมจาก LINE' });
  try {
    await db().insert(groupWorkspace).values({ lineGroupId: lineGroupRowId, workspaceId });
  } catch (error) {
    await db().delete(workspace).where(eq(workspace.id, workspaceId));
    if (!isUniqueViolation(error)) throw error;
    const winner = await boundWorkspaceOf(lineGroupRowId);
    if (winner) return winner;
    throw error;
  }
  await grantWorkspaceToGroup(lineGroupRowId, workspaceId);
  return workspaceId;
}

/**
 * Someone seen in the group: let them into its workspace now, not at their
 * next sign-in. `mayOwn` is set when they tagged @ทันงาน — a deliberate act —
 * and then, if the workspace has no owner yet, they become it. Chatting in
 * the group never makes anyone owner.
 */
export async function admitToGroupWorkspace(
  lineGroupRowId: string,
  userId: string,
  options: { mayOwn?: boolean } = {},
): Promise<string> {
  const workspaceId = await ensureGroupWorkspace(lineGroupRowId);
  const [profile] = await db()
    .select({ displayName: lineUser.displayName })
    .from(lineUser)
    .where(eq(lineUser.id, userId))
    .limit(1);
  await db()
    .insert(workspaceMember)
    .values({ workspaceId, userId, role: 'member', nickname: profile?.displayName ?? '' })
    .onConflictDoNothing();
  if (options.mayOwn) await claimOwnershipIfNone(workspaceId, userId);
  return workspaceId;
}

/** Make this member the owner, only if the workspace has none at all. */
async function claimOwnershipIfNone(workspaceId: string, userId: string): Promise<void> {
  const owners = await db()
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.role, 'owner')))
    .limit(1);
  if (owners.length) return;
  await db()
    .update(workspaceMember)
    .set({ role: 'owner' })
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)));
}

async function boundWorkspaceOf(lineGroupRowId: string): Promise<string | null> {
  const [row] = await db()
    .select({ workspaceId: groupWorkspace.workspaceId })
    .from(groupWorkspace)
    .where(eq(groupWorkspace.lineGroupId, lineGroupRowId))
    .limit(1);
  return row?.workspaceId ?? null;
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

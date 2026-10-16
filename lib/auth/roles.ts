import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { workspace, workspaceMember } from '../db/schema.ts';
import { HttpError } from '../http-error.ts';
import { audit } from '../audit.ts';
import {
  can,
  refusal,
  roleOf,
  MANAGER,
  MEMBER,
  type Action,
  type Extra,
  type GroupFacts,
  type Role,
  type TaskFacts,
} from '../permissions.ts';

/**
 * The server half of the permission layer (2026-10-17): it loads what
 * can() needs and refuses when it says no. lib/permissions.ts decides;
 * this file only fetches facts and applies role changes safely.
 */

/** The group, from one person's point of view. Not a member: role null. */
export async function groupFacts(workspaceId: string, userId: string): Promise<GroupFacts> {
  const [ws] = await db()
    .select({ kind: workspace.kind, createdByUserId: workspace.createdByUserId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!ws) return { role: null, kind: 'team', managerCount: 0, createdByUserId: null };
  const members = await db()
    .select({ userId: workspaceMember.userId, role: workspaceMember.role })
    .from(workspaceMember)
    .where(eq(workspaceMember.workspaceId, workspaceId));
  const mine = members.find((m) => m.userId === userId);
  return {
    role: mine ? (roleOf(mine.role) ?? MEMBER) : null,
    kind: ws.kind === 'personal' ? 'personal' : 'team',
    managerCount: members.filter((m) => roleOf(m.role) === MANAGER).length,
    createdByUserId: ws.createdByUserId,
  };
}

/**
 * Refuse unless can() allows it. Not a member, or not allowed to so much as
 * see a personal task: 404, so the existence of the thing is not confirmed.
 */
export async function assertCan(params: {
  userId: string;
  workspaceId: string;
  action: Action;
  task?: TaskFacts | null;
  extra?: Extra;
  facts?: GroupFacts;
}): Promise<GroupFacts> {
  const facts = params.facts ?? (await groupFacts(params.workspaceId, params.userId));
  if (can({ userId: params.userId }, params.action, facts, params.task, params.extra)) return facts;
  if (!facts.role) throw new HttpError(404, 'ไม่พบงานนี้');
  if (facts.kind === 'personal' && params.task) throw new HttpError(404, 'ไม่พบงานนี้');
  throw new HttpError(403, refusal(params.action, facts, params.task, params.userId));
}

/**
 * Change someone's role in a group.
 *
 * The count and the change happen inside ONE transaction with the group's
 * membership rows locked (SELECT … FOR UPDATE), so two Managers demoting each
 * other at the same moment are serialised: the second sees one Manager left
 * and is refused. A group never reaches zero Managers this way.
 */
export async function changeMemberRole(params: {
  workspaceId: string;
  actorUserId: string;
  targetUserId: string;
  role: Role;
}): Promise<{ changed: boolean }> {
  const { workspaceId, actorUserId, targetUserId, role } = params;
  return db().transaction(async (tx) => {
    const locked = (await tx.execute(sql`
      select user_id, role from ${workspaceMember}
       where workspace_id = ${workspaceId}
       order by user_id
       for update
    `)) as unknown as { rows: Array<{ user_id: string; role: string }> };
    const rows = locked.rows ?? [];
    const [ws] = await tx
      .select({ kind: workspace.kind, createdByUserId: workspace.createdByUserId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);
    const actor = rows.find((r) => r.user_id === actorUserId);
    const facts: GroupFacts = {
      role: actor ? (roleOf(actor.role) ?? MEMBER) : null,
      kind: ws?.kind === 'personal' ? 'personal' : 'team',
      managerCount: rows.filter((r) => roleOf(r.role) === MANAGER).length,
      createdByUserId: ws?.createdByUserId ?? null,
    };
    await assertCan({
      userId: actorUserId,
      workspaceId,
      action: 'change_member_role',
      extra: { targetUserId },
      facts,
    });
    const target = rows.find((r) => r.user_id === targetUserId);
    if (!target) throw new HttpError(404, 'คนนี้ไม่ได้อยู่ในพื้นที่งานนี้');
    const before = roleOf(target.role) ?? MEMBER;
    if (before === role) return { changed: false };
    // Never zero Managers: demoting the last one is refused, counted under
    // the lock above.
    if (before === MANAGER && role !== MANAGER && facts.managerCount <= 1) {
      throw new HttpError(409, 'ต้องมีผู้จัดการอย่างน้อยหนึ่งคน · แต่งตั้งคนอื่นก่อนจึงลดบทบาทคนนี้ได้');
    }
    await tx
      .update(workspaceMember)
      .set({ role })
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, targetUserId)));
    await audit(
      {
        actorUserId,
        action: 'role_changed',
        workspaceId,
        targetUserId,
        before: { role: before },
        after: { role },
      },
      tx,
    );
    return { changed: true };
  });
}

/**
 * Someone left the LINE group (memberLeft). A Manager who leaves stops being
 * one: they are no longer in the group. Their tasks stay. If they were the
 * last, the group has no Manager until the person who set it up names one —
 * approvals wait, and the app shows members a banner.
 */
export async function managerLeftGroup(workspaceId: string, userId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const updated = await tx
      .update(workspaceMember)
      .set({ role: MEMBER })
      .where(
        and(
          eq(workspaceMember.workspaceId, workspaceId),
          eq(workspaceMember.userId, userId),
          eq(workspaceMember.role, MANAGER),
        ),
      )
      .returning({ userId: workspaceMember.userId });
    if (!updated.length) return;
    await audit(
      {
        actorUserId: userId,
        action: 'manager_left',
        workspaceId,
        targetUserId: userId,
        before: { role: MANAGER },
        after: { role: MEMBER, reason: 'left the LINE group' },
      },
      tx,
    );
  });
}

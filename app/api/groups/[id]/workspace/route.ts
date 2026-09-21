import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { groupWorkspace, lineGroup, lineGroupMember, workspace, workspaceMember } from '@/lib/db/schema.ts';
import { requireSession, HttpError } from '@/lib/auth/session.ts';
import { errorResponse, isUniqueViolation } from '@/lib/api/handler.ts';
import { grantWorkspaceToGroup, syncGroupMemberships } from '@/lib/auth/membership.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Give a LINE group its own workspace, in one tap.
 *
 * The only way to connect a group used to be "เชื่อมกับพื้นที่งานนี้", which
 * for a new user meant their personal "งานของฉัน" — so the whole team was
 * added to one person's private space, and everyone saw a workspace called
 * "งานของฉัน" that was not theirs. The team's workspace should be named after
 * the team's group and owned by whoever set it up.
 *
 * Same checks as binding: the caller must have been seen in the group. The
 * unique index on group_workspace makes a double tap (or two people at once)
 * safe: the loser's empty workspace is removed and they are told which
 * workspace the group already belongs to.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await requireSession();

    const [group] = await db()
      .select({ id: lineGroup.id, name: lineGroup.name })
      .from(lineGroupMember)
      .innerJoin(lineGroup, eq(lineGroup.id, lineGroupMember.lineGroupId))
      .where(and(eq(lineGroupMember.lineGroupId, id), eq(lineGroupMember.userId, user.userId)))
      .limit(1);
    if (!group) throw new HttpError(404, 'ไม่พบกลุ่มนี้ หรือคุณไม่ได้อยู่ในกลุ่ม');

    const already = await boundWorkspace(id);
    if (already) {
      // They are in the group, so the group's workspace is theirs too — the
      // same access sign-in would have given them.
      await syncGroupMemberships(user.userId);
      return alreadyBound(already);
    }

    const workspaceId = crypto.randomUUID();
    const name = group.name || 'ทีมจาก LINE';
    await db().insert(workspace).values({ id: workspaceId, name });
    await db().insert(workspaceMember).values({
      workspaceId,
      userId: user.userId,
      role: 'owner',
      nickname: user.displayName,
    });
    try {
      await db().insert(groupWorkspace).values({
        lineGroupId: id,
        workspaceId,
        boundByUserId: user.userId,
      });
    } catch (error) {
      // Someone connected it a moment earlier. Remove ours, point at theirs.
      await db().delete(workspace).where(eq(workspace.id, workspaceId));
      if (!isUniqueViolation(error)) throw error;
      const winner = await boundWorkspace(id);
      if (winner) {
        await syncGroupMemberships(user.userId);
        return alreadyBound(winner);
      }
      throw error;
    }

    const granted = await grantWorkspaceToGroup(id, workspaceId);
    return NextResponse.json({ workspaceId, name, membersGranted: granted }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

async function boundWorkspace(lineGroupRowId: string) {
  const [row] = await db()
    .select({ workspaceId: groupWorkspace.workspaceId, name: workspace.name })
    .from(groupWorkspace)
    .innerJoin(workspace, eq(workspace.id, groupWorkspace.workspaceId))
    .where(eq(groupWorkspace.lineGroupId, lineGroupRowId))
    .limit(1);
  return row ?? null;
}

function alreadyBound(row: { workspaceId: string; name: string }) {
  return NextResponse.json(
    { error: `กลุ่มนี้เชื่อมกับ “${row.name}” แล้ว`, workspaceId: row.workspaceId, name: row.name },
    { status: 409 },
  );
}

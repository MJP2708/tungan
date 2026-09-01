import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import {
  lineUser,
  workspaceMember,
  groupWorkspace,
  lineGroupMember,
} from '@/lib/db/schema.ts';
import { requireMembership } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    // Membership is resolved server-side before any row is read.
    await requireMembership(id);

    // People who signed in and joined the workspace.
    const accountMembers = await db()
      .select({
        userId: lineUser.id,
        lineUserId: lineUser.lineUserId,
        displayName: lineUser.displayName,
        nickname: workspaceMember.nickname,
        role: workspaceMember.role,
        canReceiveDirectMessages: lineUser.isOaFriend,
      })
      .from(workspaceMember)
      .innerJoin(lineUser, eq(lineUser.id, workspaceMember.userId))
      .where(eq(workspaceMember.workspaceId, id));

    // People seen in a LINE group bound to this workspace who have not signed
    // in yet. They can be assigned work — the LINE user id is the identity —
    // but they cannot open the app until they log in.
    const groups = await db()
      .select({ lineGroupId: groupWorkspace.lineGroupId })
      .from(groupWorkspace)
      .where(eq(groupWorkspace.workspaceId, id));

    let groupOnly: typeof accountMembers = [];
    if (groups.length) {
      const seen = await db()
        .select({
          userId: lineUser.id,
          lineUserId: lineUser.lineUserId,
          displayName: lineUser.displayName,
          canReceiveDirectMessages: lineUser.isOaFriend,
        })
        .from(lineGroupMember)
        .innerJoin(lineUser, eq(lineUser.id, lineGroupMember.userId))
        .where(
          inArray(
            lineGroupMember.lineGroupId,
            groups.map((g) => g.lineGroupId),
          ),
        );
      const known = new Set(accountMembers.map((m) => m.userId));
      groupOnly = seen
        .filter((s) => !known.has(s.userId))
        .map((s) => ({
          userId: s.userId,
          lineUserId: s.lineUserId,
          displayName: s.displayName,
          nickname: s.displayName || 'สมาชิกในกลุ่ม',
          role: 'guest',
          canReceiveDirectMessages: s.canReceiveDirectMessages,
        }));
    }

    const members = [...accountMembers, ...groupOnly].map((m) => ({
      ...m,
      // Two different reasons a person may be unreachable, and the fix is
      // different for each, so the UI must not merge them.
      linkStatus: !m.canReceiveDirectMessages
        ? 'not_friend'
        : m.role === 'guest'
          ? 'not_signed_in'
          : 'ok',
    }));

    return NextResponse.json({
      members,
      // Without a Verified/Premium account the member-list endpoint is not
      // available, so this list is everyone we have *seen*, not everyone in
      // the group. Saying so is the difference between a degraded feature and
      // one that looks broken.
      completeness: 'known_members_only',
      completenessNote:
        'แสดงเฉพาะสมาชิกที่เคยพูดในกลุ่มหรือเข้าใช้แอปแล้ว ยังดึงรายชื่อทั้งกลุ่มไม่ได้',
    });
  } catch (error) {
    return errorResponse(error);
  }
}

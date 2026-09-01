import { NextResponse } from 'next/server';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { lineGroup, lineGroupMember, groupWorkspace, workspace } from '@/lib/db/schema.ts';
import { requireSession } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * LINE groups this user can connect.
 *
 * Scoped to groups we have actually seen them in. Listing every group the bot
 * has ever joined would let anyone with an account connect a stranger's group
 * and start receiving its messages.
 */
export async function GET() {
  try {
    const user = await requireSession();
    const rows = await db()
      .select({
        id: lineGroup.id,
        lineGroupId: lineGroup.lineGroupId,
        name: lineGroup.name,
        boundWorkspaceId: groupWorkspace.workspaceId,
        boundWorkspaceName: workspace.name,
      })
      .from(lineGroupMember)
      .innerJoin(lineGroup, eq(lineGroup.id, lineGroupMember.lineGroupId))
      .leftJoin(groupWorkspace, eq(groupWorkspace.lineGroupId, lineGroup.id))
      .leftJoin(workspace, eq(workspace.id, groupWorkspace.workspaceId))
      .where(eq(lineGroupMember.userId, user.userId))
      .orderBy(desc(lineGroup.createdAt));

    return NextResponse.json({
      groups: rows.map((g) => ({
        id: g.id,
        name: g.name || 'กลุ่ม LINE',
        bound: Boolean(g.boundWorkspaceId),
        workspaceId: g.boundWorkspaceId,
        workspaceName: g.boundWorkspaceName,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

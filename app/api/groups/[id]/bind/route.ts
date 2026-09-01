import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { lineGroup, lineGroupMember, groupWorkspace } from '@/lib/db/schema.ts';
import { requireMembership, HttpError } from '@/lib/auth/session.ts';
import { errorResponse } from '@/lib/api/handler.ts';
import { grantWorkspaceToGroup } from '@/lib/auth/membership.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Connect a LINE group to a workspace so its messages have somewhere to land. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const workspaceId = String(body.workspaceId ?? '');

    // Two independent checks, because the caller controls both ids:
    // they must be a member of the workspace, and we must have seen them
    // in the group.
    const membership = await requireMembership(workspaceId);

    const seen = await db()
      .select({ userId: lineGroupMember.userId })
      .from(lineGroupMember)
      .where(
        and(eq(lineGroupMember.lineGroupId, id), eq(lineGroupMember.userId, membership.userId)),
      )
      .limit(1);
    if (!seen[0]) {
      throw new HttpError(404, 'ไม่พบกลุ่มนี้ หรือคุณไม่ได้อยู่ในกลุ่ม');
    }

    const already = await db()
      .select({ workspaceId: groupWorkspace.workspaceId })
      .from(groupWorkspace)
      .where(eq(groupWorkspace.lineGroupId, id))
      .limit(1);
    if (already[0]) {
      return NextResponse.json(
        {
          error:
            already[0].workspaceId === workspaceId
              ? 'กลุ่มนี้เชื่อมกับพื้นที่งานนี้อยู่แล้ว'
              : 'กลุ่มนี้เชื่อมกับพื้นที่งานอื่นอยู่แล้ว',
        },
        { status: 409 },
      );
    }

    await db().insert(groupWorkspace).values({
      lineGroupId: id,
      workspaceId,
      boundByUserId: membership.userId,
    });

    // Everyone already known in the group gets access now, rather than
    // waiting until their next sign-in to see their own team's work.
    const granted = await grantWorkspaceToGroup(id, workspaceId);

    return NextResponse.json({ ok: true, membersGranted: granted }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Disconnect it again. Messages stop landing; existing tasks are untouched. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const rows = await db()
      .select({ workspaceId: groupWorkspace.workspaceId })
      .from(groupWorkspace)
      .where(eq(groupWorkspace.lineGroupId, id))
      .limit(1);
    if (!rows[0]) throw new HttpError(404, 'กลุ่มนี้ยังไม่ได้เชื่อม');
    await requireMembership(rows[0].workspaceId, { roles: ['owner', 'admin'] });
    await db().delete(groupWorkspace).where(eq(groupWorkspace.lineGroupId, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

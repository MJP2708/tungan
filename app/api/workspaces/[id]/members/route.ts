import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { lineUser, workspaceMember } from '@/lib/db/schema.ts';
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
    const rows = await db()
      .select({
        userId: lineUser.id,
        displayName: lineUser.displayName,
        nickname: workspaceMember.nickname,
        role: workspaceMember.role,
        // Surfaced so the UI can warn instead of dropping reminders silently.
        canReceiveDirectMessages: lineUser.isOaFriend,
      })
      .from(workspaceMember)
      .innerJoin(lineUser, eq(lineUser.id, workspaceMember.userId))
      .where(eq(workspaceMember.workspaceId, id));
    return NextResponse.json({
      members: rows,
      // Without a Verified/Premium account we only know members who have
      // produced a webhook event. Say so rather than looking broken.
      completeness: 'known_members_only',
    });
  } catch (error) {
    return errorResponse(error);
  }
}

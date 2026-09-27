import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { workspace, workspaceMember, lineUser } from '@/lib/db/schema.ts';
import { requireSession, HttpError } from '@/lib/auth/session.ts';
import { refreshFriendFlag, addFriendUrl } from '@/lib/line/messaging.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireSession();
    const rows = await db()
      .select({
        id: workspace.id,
        name: workspace.name,
        role: workspaceMember.role,
        cutoff: workspace.cutoff,
      })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
      .where(eq(workspaceMember.userId, user.userId));

    const me = await db()
      .select({ isOaFriend: lineUser.isOaFriend })
      .from(lineUser)
      .where(eq(lineUser.id, user.userId))
      .limit(1);

    // Nobody who has not added the OA receives a single reminder, so this
    // answer decides whether the app warns them. A stored `false` goes stale
    // (a missed follow event, a restored database), and warning someone who
    // *is* a friend teaches them to ignore the warning — so check with LINE
    // before saying it, and offer the link when it is true.
    let isOaFriend = me[0]?.isOaFriend ?? false;
    if (!isOaFriend) isOaFriend = await refreshFriendFlag(user.userId, user.lineUserId);

    return NextResponse.json({
      user: {
        ...user,
        isOaFriend,
        addFriendUrl: isOaFriend ? null : await addFriendUrl(),
      },
      workspaces: rows,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

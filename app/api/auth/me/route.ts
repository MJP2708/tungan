import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/index.ts';
import { workspace, workspaceMember, lineUser } from '@/lib/db/schema.ts';
import { requireSession, HttpError } from '@/lib/auth/session.ts';

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

    return NextResponse.json({
      user: { ...user, isOaFriend: me[0]?.isOaFriend ?? false },
      workspaces: rows,
    });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}

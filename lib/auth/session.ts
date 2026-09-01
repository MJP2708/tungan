import 'server-only';
import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { session, lineUser, workspaceMember, workspace } from '../db/schema.ts';

export const SESSION_COOKIE = 'tungan_session';
const SESSION_DAYS = 30;

/**
 * Our own session, not a LINE token.
 *
 * A LINE access or ID token in the browser would be a bearer credential for
 * LINE itself; we mint our own opaque id instead and keep it httpOnly so
 * script on the page can never read it.
 */
export function newSessionId() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string) {
  const token = newSessionId();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db().insert(session).values({ id: hashToken(token), userId, expiresAt });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
  return token;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db().delete(session).where(eq(session.id, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

export type SessionUser = {
  userId: string;
  lineUserId: string;
  displayName: string;
};

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Resolve the caller from the session cookie. Throws 401 if absent/expired.
 * Nothing the browser sends other than this cookie contributes to identity.
 */
export async function requireSession(): Promise<SessionUser> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) throw new HttpError(401, 'ต้องเข้าสู่ระบบก่อน');

  const rows = await db()
    .select({
      userId: lineUser.id,
      lineUserId: lineUser.lineUserId,
      displayName: lineUser.displayName,
      expiresAt: session.expiresAt,
    })
    .from(session)
    .innerJoin(lineUser, eq(lineUser.id, session.userId))
    .where(eq(session.id, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row) throw new HttpError(401, 'เซสชันไม่ถูกต้อง');
  if (row.expiresAt.getTime() < Date.now()) {
    await db().delete(session).where(eq(session.id, hashToken(token)));
    throw new HttpError(401, 'เซสชันหมดอายุ');
  }
  return {
    userId: row.userId,
    lineUserId: row.lineUserId,
    displayName: row.displayName,
  };
}

export type Membership = {
  workspaceId: string;
  userId: string;
  role: string;
  cutoff: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  monthlyMessageCap: number;
};

/**
 * The only way to get access to a workspace's data.
 *
 * The workspace id arrives from the client, so it is treated as a *request*,
 * not as proof. Access is decided by whether a workspace_member row exists for
 * this session's user. A caller who is not a member gets 404, not 403, so the
 * API does not confirm that someone else's workspace exists.
 */
export async function requireMembership(
  workspaceId: string,
  options: { roles?: string[] } = {},
): Promise<Membership> {
  const user = await requireSession();
  if (!workspaceId) throw new HttpError(400, 'ต้องระบุพื้นที่งาน');

  const rows = await db()
    .select({
      workspaceId: workspaceMember.workspaceId,
      userId: workspaceMember.userId,
      role: workspaceMember.role,
      cutoff: workspace.cutoff,
      quietHoursStart: workspace.quietHoursStart,
      quietHoursEnd: workspace.quietHoursEnd,
      monthlyMessageCap: workspace.monthlyMessageCap,
    })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.userId, user.userId),
      ),
    )
    .limit(1);

  const membership = rows[0];
  if (!membership) throw new HttpError(404, 'ไม่พบพื้นที่งานนี้');
  if (options.roles && !options.roles.includes(membership.role)) {
    throw new HttpError(403, 'สิทธิ์ไม่พอสำหรับการกระทำนี้');
  }
  return membership;
}

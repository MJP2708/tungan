import 'server-only';
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { db } from './db/index.ts';
import { announcement, announcementRead, lineUser, workspace, workspaceMember } from './db/schema.ts';
import { HttpError } from './http-error.ts';
import { normalizeMeetingLink } from './meeting-link.ts';

/**
 * Announcements: something everyone in a workspace needs to know.
 *
 * Owners and admins post (the route checks the role). Every member sees each
 * one once, as a popup the next time they open the app, and closing it is
 * recorded server-side, so it does not come back on another phone. In the app
 * only: a LINE group post would cost one counted message per member.
 */

export const TITLE_MAX = 120;
export const BODY_MAX = 2000;
/** Popups older than this are history, not news. */
const POPUP_DAYS = 30;

export type AnnouncementView = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  body: string;
  /** Where to join, when it is about a meeting. */
  link: string | null;
  authorName: string | null;
  createdAt: Date;
  read: boolean;
};

/** Read receipts, on the workspace's history only (2026-10-08). */
export type AnnouncementWithReceipts = AnnouncementView & {
  /** Current members who have pressed รับทราบ or X. */
  readCount: number;
  /** Current members, author included. */
  audience: number;
  /** Who has not seen it yet. Only for the author, owners and admins —
   *  everyone else gets null, so a list of names is not passed around. */
  unreadNames: string[] | null;
};

export async function postAnnouncement(params: {
  workspaceId: string;
  authorUserId: string;
  title: string;
  body: string;
  link?: string | null;
}): Promise<{ id: string }> {
  const title = params.title.trim().slice(0, TITLE_MAX);
  const body = params.body.trim().slice(0, BODY_MAX);
  if (!title) throw new HttpError(400, 'ใส่หัวข้อประกาศก่อน');
  let link: string | null;
  try {
    link = normalizeMeetingLink(params.link);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const id = crypto.randomUUID();
  await db().insert(announcement).values({
    id,
    workspaceId: params.workspaceId,
    authorUserId: params.authorUserId,
    title,
    body,
    link,
  });
  // The author sees it too, like everyone else: it is the same notice the
  // whole team gets before using the app, and it confirms what went out.
  return { id };
}

/** What this person has not closed yet, in every workspace they are in. */
export async function unreadAnnouncementsFor(userId: string, now = new Date()): Promise<AnnouncementView[]> {
  const since = new Date(now.getTime() - POPUP_DAYS * 86400000);
  const rows = await db()
    .select({
      id: announcement.id,
      workspaceId: announcement.workspaceId,
      workspaceName: workspace.name,
      title: announcement.title,
      body: announcement.body,
      link: announcement.link,
      authorName: lineUser.displayName,
      createdAt: announcement.createdAt,
    })
    .from(announcement)
    .innerJoin(
      workspaceMember,
      and(eq(workspaceMember.workspaceId, announcement.workspaceId), eq(workspaceMember.userId, userId)),
    )
    .innerJoin(workspace, eq(workspace.id, announcement.workspaceId))
    .leftJoin(lineUser, eq(lineUser.id, announcement.authorUserId))
    .leftJoin(
      announcementRead,
      and(eq(announcementRead.announcementId, announcement.id), eq(announcementRead.userId, userId)),
    )
    .where(and(isNull(announcementRead.userId), gt(announcement.createdAt, since)))
    // Oldest first: they are read in the order they were said.
    .orderBy(announcement.createdAt);
  return rows.map((r) => ({ ...r, read: false }));
}

/** Close it for this person. Only someone in its workspace may. */
export async function markAnnouncementRead(announcementId: string, userId: string): Promise<void> {
  const [found] = await db()
    .select({ workspaceId: announcement.workspaceId })
    .from(announcement)
    .innerJoin(
      workspaceMember,
      and(eq(workspaceMember.workspaceId, announcement.workspaceId), eq(workspaceMember.userId, userId)),
    )
    .where(eq(announcement.id, announcementId))
    .limit(1);
  // Not found and not yours look the same, so the API does not confirm that
  // someone else's announcement exists.
  if (!found) throw new HttpError(404, 'ไม่พบประกาศนี้');
  await db().insert(announcementRead).values({ announcementId, userId }).onConflictDoNothing();
}

/**
 * The workspace's recent announcements, newest first, with this person's read
 * state and how many of the team have seen each one. Names of who has not
 * are for the author and the workspace's owners and admins only.
 */
export async function listAnnouncements(
  workspaceId: string,
  userId: string,
  opts: { manager?: boolean } = {},
): Promise<AnnouncementWithReceipts[]> {
  const rows = await db()
    .select({
      id: announcement.id,
      workspaceId: announcement.workspaceId,
      workspaceName: workspace.name,
      title: announcement.title,
      body: announcement.body,
      link: announcement.link,
      authorUserId: announcement.authorUserId,
      authorName: lineUser.displayName,
      createdAt: announcement.createdAt,
    })
    .from(announcement)
    .innerJoin(workspace, eq(workspace.id, announcement.workspaceId))
    .leftJoin(lineUser, eq(lineUser.id, announcement.authorUserId))
    .where(eq(announcement.workspaceId, workspaceId))
    .orderBy(desc(announcement.createdAt))
    .limit(30);
  if (!rows.length) return [];

  const [members, reads] = await Promise.all([
    db()
      .select({
        userId: workspaceMember.userId,
        nickname: workspaceMember.nickname,
        displayName: lineUser.displayName,
      })
      .from(workspaceMember)
      .leftJoin(lineUser, eq(lineUser.id, workspaceMember.userId))
      .where(eq(workspaceMember.workspaceId, workspaceId)),
    db()
      .select({ id: announcementRead.announcementId, userId: announcementRead.userId })
      .from(announcementRead)
      .where(inArray(announcementRead.announcementId, rows.map((r) => r.id))),
  ]);
  const readers = new Map<string, Set<string>>();
  for (const r of reads) {
    if (!readers.has(r.id)) readers.set(r.id, new Set());
    readers.get(r.id)!.add(r.userId);
  }

  return rows.map(({ authorUserId, ...r }) => {
    const seen = readers.get(r.id) ?? new Set<string>();
    const missing = members.filter((m) => !seen.has(m.userId));
    const mayName = opts.manager === true || authorUserId === userId;
    return {
      ...r,
      read: seen.has(userId),
      readCount: members.length - missing.length,
      audience: members.length,
      unreadNames: mayName
        ? missing.map((m) => m.nickname || m.displayName || 'ไม่ทราบชื่อ')
        : null,
    };
  });
}

/** The workspace an announcement belongs to, for the delete route's role check. */
export async function announcementWorkspace(announcementId: string): Promise<string> {
  const [found] = await db()
    .select({ workspaceId: announcement.workspaceId })
    .from(announcement)
    .where(eq(announcement.id, announcementId))
    .limit(1);
  if (!found) throw new HttpError(404, 'ไม่พบประกาศนี้');
  return found.workspaceId;
}

export async function deleteAnnouncement(announcementId: string): Promise<void> {
  await db().delete(announcement).where(eq(announcement.id, announcementId));
}

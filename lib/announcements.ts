import 'server-only';
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { db } from './db/index.ts';
import { announcement, announcementRead, lineUser, workspace, workspaceMember } from './db/schema.ts';
import { HttpError } from './http-error.ts';

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
  authorName: string | null;
  createdAt: Date;
  read: boolean;
};

export async function postAnnouncement(params: {
  workspaceId: string;
  authorUserId: string;
  title: string;
  body: string;
}): Promise<{ id: string }> {
  const title = params.title.trim().slice(0, TITLE_MAX);
  const body = params.body.trim().slice(0, BODY_MAX);
  if (!title) throw new HttpError(400, 'ใส่หัวข้อประกาศก่อน');
  const id = crypto.randomUUID();
  await db().insert(announcement).values({
    id,
    workspaceId: params.workspaceId,
    authorUserId: params.authorUserId,
    title,
    body,
  });
  // The author has obviously seen it.
  await db().insert(announcementRead).values({ announcementId: id, userId: params.authorUserId });
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

/** The workspace's recent announcements, newest first, with this person's read state. */
export async function listAnnouncements(workspaceId: string, userId: string): Promise<AnnouncementView[]> {
  const rows = await db()
    .select({
      id: announcement.id,
      workspaceId: announcement.workspaceId,
      workspaceName: workspace.name,
      title: announcement.title,
      body: announcement.body,
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
  const read = await db()
    .select({ id: announcementRead.announcementId })
    .from(announcementRead)
    .where(and(eq(announcementRead.userId, userId), inArray(announcementRead.announcementId, rows.map((r) => r.id))));
  const readIds = new Set(read.map((r) => r.id));
  return rows.map((r) => ({ ...r, read: readIds.has(r.id) }));
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

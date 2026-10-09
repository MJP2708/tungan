import 'server-only';
import { and, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import {
  calendarEvent,
  calendarEventAttendee,
  lineUser,
  reminder,
  workspace,
  workspaceMember,
} from './db/schema.ts';
import { HttpError } from './http-error.ts';
import {
  canSeeEvent,
  normalizeEventInput,
  notifyInstant,
  notifyRecipients,
  EventInputError,
  type EventInput,
} from './calendar-event-rules.ts';
import { scheduleReminder } from './reminders/schedule.ts';
import { everyoneAssignable } from './auth/assignable.ts';

/**
 * Calendar events: all database access for them (2026-10-09). Visibility and
 * input rules are in calendar-event-rules.ts; this decides who may change
 * what and keeps each event's notifications in step with it.
 */

export type EventView = {
  id: string;
  workspaceId: string;
  title: string;
  note: string;
  link: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  audience: string;
  notifyMinutes: number | null;
  createdByUserId: string | null;
  createdByName: string | null;
  attendees: Array<{ userId: string; name: string }>;
  /** May this person edit and delete it. */
  canEdit: boolean;
};

function parse(body: Record<string, unknown>): EventInput {
  try {
    return normalizeEventInput(body);
  } catch (error) {
    if (error instanceof EventInputError) throw new HttpError(400, error.message);
    throw error;
  }
}

/**
 * Everyone an event can reach: workspace members and people seen in its LINE
 * group, the same "everyone" as a ทุกคน task (everyoneAssignable). People
 * seen in the group have not opened the app, but a LINE message reaches them.
 */
async function memberIdsOf(workspaceId: string): Promise<string[]> {
  return everyoneAssignable(workspaceId);
}

/** Events overlapping [from, to) that this person may see. */
export async function listEvents(params: {
  workspaceId: string;
  userId: string;
  role: string;
  from: Date;
  to: Date;
}): Promise<EventView[]> {
  const { workspaceId, userId, role, from, to } = params;
  const rows = await db()
    .select({
      event: calendarEvent,
      createdByName: lineUser.displayName,
    })
    .from(calendarEvent)
    .leftJoin(lineUser, eq(lineUser.id, calendarEvent.createdByUserId))
    .where(
      and(
        eq(calendarEvent.workspaceId, workspaceId),
        lt(calendarEvent.startsAt, to),
        or(
          gte(calendarEvent.startsAt, from),
          and(sql`${calendarEvent.endsAt} is not null`, gte(calendarEvent.endsAt, from)),
        ),
      ),
    )
    .orderBy(calendarEvent.startsAt);
  if (!rows.length) return [];

  const attendeeRows = await db()
    .select({
      eventId: calendarEventAttendee.eventId,
      userId: calendarEventAttendee.userId,
      nickname: workspaceMember.nickname,
      displayName: lineUser.displayName,
    })
    .from(calendarEventAttendee)
    .leftJoin(lineUser, eq(lineUser.id, calendarEventAttendee.userId))
    .leftJoin(
      workspaceMember,
      and(eq(workspaceMember.userId, calendarEventAttendee.userId), eq(workspaceMember.workspaceId, workspaceId)),
    )
    .where(inArray(calendarEventAttendee.eventId, rows.map((r) => r.event.id)));
  const byEvent = new Map<string, Array<{ userId: string; name: string }>>();
  for (const a of attendeeRows) {
    if (!byEvent.has(a.eventId)) byEvent.set(a.eventId, []);
    byEvent.get(a.eventId)!.push({ userId: a.userId, name: a.nickname || a.displayName || 'ไม่ทราบชื่อ' });
  }

  const manager = role === 'owner' || role === 'admin';
  return rows
    .filter(({ event }) =>
      canSeeEvent(event, userId, (byEvent.get(event.id) ?? []).map((a) => a.userId)),
    )
    .map(({ event, createdByName }) => ({
      id: event.id,
      workspaceId: event.workspaceId,
      title: event.title,
      note: event.note,
      link: event.link,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      audience: event.audience,
      notifyMinutes: event.notifyMinutes,
      createdByUserId: event.createdByUserId,
      createdByName,
      attendees: byEvent.get(event.id) ?? [],
      // A shared event can be changed by whoever made it or a manager; a
      // private one only by its owner (a manager cannot see it anyway).
      canEdit: event.createdByUserId === userId || (manager && event.audience !== 'me'),
    }));
}

/** How many LINE messages one notification of this event would use. */
export async function notificationCost(params: {
  workspaceId: string;
  createdBy: string;
  input: Pick<EventInput, 'audience' | 'attendeeIds' | 'notifyMinutes'>;
}): Promise<number> {
  if (params.input.notifyMinutes === null) return 0;
  return notifyRecipients({
    audience: params.input.audience,
    createdBy: params.createdBy,
    attendeeIds: params.input.attendeeIds,
    memberIds: await memberIdsOf(params.workspaceId),
  }).length;
}

async function assertAttendeesAreMembers(workspaceId: string, attendeeIds: string[]) {
  if (!attendeeIds.length) return;
  const members = new Set(await memberIdsOf(workspaceId));
  // Not found and not a member look the same: no probing for who exists.
  if (attendeeIds.some((id) => !members.has(id))) {
    throw new HttpError(400, 'คนนี้ไม่ได้อยู่ในพื้นที่งานนี้');
  }
}

/**
 * Replace the event's pending notifications with ones for its current time,
 * people and setting. Sent ones are left alone: they happened.
 */
async function replanNotifications(eventId: string, now = new Date()) {
  const [event] = await db().select().from(calendarEvent).where(eq(calendarEvent.id, eventId)).limit(1);
  await db()
    .delete(reminder)
    .where(and(eq(reminder.eventId, eventId), eq(reminder.state, 'pending')));
  if (!event) return;
  const intended = notifyInstant(event.startsAt, event.notifyMinutes);
  // Nothing to send for a time already gone (a minute of grace).
  if (!intended || intended.getTime() < now.getTime() - 60_000) return;

  const [ws] = await db()
    .select({ start: workspace.quietHoursStart, end: workspace.quietHoursEnd })
    .from(workspace)
    .where(eq(workspace.id, event.workspaceId))
    .limit(1);
  const attendeeIds = (
    await db()
      .select({ userId: calendarEventAttendee.userId })
      .from(calendarEventAttendee)
      .where(eq(calendarEventAttendee.eventId, eventId))
  ).map((r) => r.userId);
  const recipients = notifyRecipients({
    audience: event.audience as EventInput['audience'],
    createdBy: event.createdByUserId ?? '',
    attendeeIds,
    memberIds: await memberIdsOf(event.workspaceId),
  });
  if (!recipients.length) return;

  // Quiet hours as for every reminder; scheduleReminder never moves a
  // notification to after the thing it is about.
  const decision = scheduleReminder({
    dueAt: event.startsAt,
    leadMinutes: event.notifyMinutes ?? 0,
    quiet: { start: ws?.start ?? '21:00', end: ws?.end ?? '08:00' },
  });
  await db()
    .insert(reminder)
    .values(
      recipients.map((recipientUserId) => ({
        id: crypto.randomUUID(),
        workspaceId: event.workspaceId,
        eventId,
        recipientUserId,
        kind: 'event',
        sendAt: decision.sendAt,
        originalSendAt: decision.originalSendAt,
      })),
    )
    .onConflictDoNothing();
}

export async function createEvent(params: {
  workspaceId: string;
  createdBy: string;
  body: Record<string, unknown>;
  now?: Date;
}): Promise<{ id: string; recipients: number }> {
  const input = parse(params.body);
  await assertAttendeesAreMembers(params.workspaceId, input.attendeeIds);
  const id = crypto.randomUUID();
  await db().insert(calendarEvent).values({
    id,
    workspaceId: params.workspaceId,
    createdByUserId: params.createdBy,
    title: input.title,
    note: input.note,
    link: input.link,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    allDay: input.allDay,
    audience: input.audience,
    notifyMinutes: input.notifyMinutes,
  });
  if (input.attendeeIds.length) {
    await db()
      .insert(calendarEventAttendee)
      .values(input.attendeeIds.map((userId) => ({ eventId: id, userId })))
      .onConflictDoNothing();
  }
  await replanNotifications(id, params.now);
  const recipients = await notificationCost({ workspaceId: params.workspaceId, createdBy: params.createdBy, input });
  return { id, recipients };
}

/** The event, if this person may change it. Not found and not allowed look alike. */
async function editableEvent(eventId: string, userId: string) {
  const [event] = await db().select().from(calendarEvent).where(eq(calendarEvent.id, eventId)).limit(1);
  if (!event) throw new HttpError(404, 'ไม่พบกิจกรรมนี้');
  const [membership] = await db()
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, event.workspaceId), eq(workspaceMember.userId, userId)))
    .limit(1);
  if (!membership) throw new HttpError(404, 'ไม่พบกิจกรรมนี้');
  const attendeeIds = (
    await db()
      .select({ userId: calendarEventAttendee.userId })
      .from(calendarEventAttendee)
      .where(eq(calendarEventAttendee.eventId, eventId))
  ).map((r) => r.userId);
  if (!canSeeEvent(event, userId, attendeeIds)) throw new HttpError(404, 'ไม่พบกิจกรรมนี้');
  const manager = membership.role === 'owner' || membership.role === 'admin';
  if (event.createdByUserId !== userId && !(manager && event.audience !== 'me')) {
    throw new HttpError(403, 'แก้ได้เฉพาะคนที่สร้างกิจกรรมหรือผู้ดูแลพื้นที่งาน');
  }
  return event;
}

export async function updateEvent(params: {
  eventId: string;
  userId: string;
  body: Record<string, unknown>;
  now?: Date;
}): Promise<{ id: string; recipients: number }> {
  const event = await editableEvent(params.eventId, params.userId);
  const input = parse(params.body);
  await assertAttendeesAreMembers(event.workspaceId, input.attendeeIds);
  await db()
    .update(calendarEvent)
    .set({
      title: input.title,
      note: input.note,
      link: input.link,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      allDay: input.allDay,
      audience: input.audience,
      notifyMinutes: input.notifyMinutes,
      updatedAt: new Date(),
    })
    .where(eq(calendarEvent.id, event.id));
  await db().delete(calendarEventAttendee).where(eq(calendarEventAttendee.eventId, event.id));
  if (input.attendeeIds.length) {
    await db()
      .insert(calendarEventAttendee)
      .values(input.attendeeIds.map((userId) => ({ eventId: event.id, userId })));
  }
  await replanNotifications(event.id, params.now);
  const recipients = await notificationCost({
    workspaceId: event.workspaceId,
    createdBy: event.createdByUserId ?? params.userId,
    input,
  });
  return { id: event.id, recipients };
}

export async function deleteEvent(eventId: string, userId: string): Promise<void> {
  const event = await editableEvent(eventId, userId);
  // Its notifications go with it (on delete cascade).
  await db().delete(calendarEvent).where(eq(calendarEvent.id, event.id));
}

/** Titles and times for the dispatcher's message. */
export async function eventsForMessages(eventIds: string[]) {
  const map = new Map<string, { title: string; startsAt: Date; allDay: boolean; link: string | null }>();
  if (!eventIds.length) return map;
  const rows = await db()
    .select({
      id: calendarEvent.id,
      title: calendarEvent.title,
      startsAt: calendarEvent.startsAt,
      allDay: calendarEvent.allDay,
      link: calendarEvent.link,
    })
    .from(calendarEvent)
    .where(inArray(calendarEvent.id, eventIds));
  for (const r of rows) map.set(r.id, r);
  return map;
}

import { normalizeMeetingLink } from './meeting-link.ts';
import { fromZonedWallClock, zonedDateParts, PRODUCT_TIME_ZONE } from './deadline.ts';

/**
 * Calendar events (2026-10-09): what is a valid event, and when does it
 * notify. Pure — the browser form and the server give the same answers.
 */

export const EVENT_TITLE_MAX = 120;
export const EVENT_NOTE_MAX = 1000;

export type Audience = 'me' | 'everyone' | 'people';
export const AUDIENCES: readonly Audience[] = ['me', 'everyone', 'people'];

/** Minutes before the start. For an all-day event the start is its Bangkok
 *  midnight, so -540 is 09:00 that day and 900 is 09:00 the day before. */
export const TIMED_NOTIFY = [0, 10, 30, 60, 1440] as const;
export const ALL_DAY_NOTIFY = [-540, 900] as const;

export type EventInput = {
  title: string;
  note: string;
  link: string | null;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  audience: Audience;
  attendeeIds: string[];
  notifyMinutes: number | null;
};

export class EventInputError extends Error {}

const asDate = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : null;
};

/** Bangkok midnight of the day an instant falls on. */
export function startOfBangkokDay(at: Date): Date {
  const p = zonedDateParts(at, PRODUCT_TIME_ZONE);
  return fromZonedWallClock(p.year, p.month, p.day, 0, 0, PRODUCT_TIME_ZONE);
}

/** Check and clean what the client sent. Throws a person-readable Thai message. */
export function normalizeEventInput(body: Record<string, unknown>): EventInput {
  const title = String(body.title ?? '').trim().slice(0, EVENT_TITLE_MAX);
  if (!title) throw new EventInputError('ใส่ชื่อกิจกรรมก่อน');
  const note = String(body.note ?? '').trim().slice(0, EVENT_NOTE_MAX);
  let link: string | null;
  try {
    link = normalizeMeetingLink(body.link);
  } catch (error) {
    throw new EventInputError((error as Error).message);
  }

  const allDay = body.allDay === true;
  let startsAt = asDate(body.startsAt);
  if (!startsAt) throw new EventInputError('ต้องระบุเวลาเริ่ม');
  let endsAt = asDate(body.endsAt);
  if (allDay) {
    startsAt = startOfBangkokDay(startsAt);
    endsAt = endsAt ? startOfBangkokDay(endsAt) : null;
    if (endsAt && endsAt.getTime() === startsAt.getTime()) endsAt = null;
  }
  if (endsAt && endsAt.getTime() < startsAt.getTime()) {
    throw new EventInputError('เวลาจบต้องไม่ก่อนเวลาเริ่ม');
  }

  const audience = AUDIENCES.includes(body.audience as Audience) ? (body.audience as Audience) : 'me';
  const attendeeIds =
    audience === 'people' && Array.isArray(body.attendeeIds)
      ? [...new Set(body.attendeeIds.map(String).filter(Boolean))].slice(0, 100)
      : [];
  if (audience === 'people' && attendeeIds.length === 0) {
    throw new EventInputError('เลือกคนที่จะเชิญอย่างน้อยหนึ่งคน');
  }

  let notifyMinutes: number | null = null;
  if (body.notifyMinutes !== null && body.notifyMinutes !== undefined && body.notifyMinutes !== '') {
    const n = Number(body.notifyMinutes);
    const allowed: readonly number[] = allDay ? ALL_DAY_NOTIFY : TIMED_NOTIFY;
    if (!allowed.includes(n)) throw new EventInputError('เวลาเตือนไม่ถูกต้อง');
    notifyMinutes = n;
  }

  return { title, note, link, startsAt, endsAt, allDay, audience, attendeeIds, notifyMinutes };
}

/** The intended moment to notify, before any quiet-hours adjustment. */
export function notifyInstant(startsAt: Date, notifyMinutes: number | null): Date | null {
  if (notifyMinutes === null) return null;
  return new Date(startsAt.getTime() - notifyMinutes * 60000);
}

/** Who gets the notification: the person who made it is always told. */
export function notifyRecipients(params: {
  audience: Audience;
  createdBy: string;
  attendeeIds: string[];
  memberIds: string[];
}): string[] {
  const { audience, createdBy, attendeeIds, memberIds } = params;
  const list =
    audience === 'everyone'
      ? memberIds
      : audience === 'people'
        ? [createdBy, ...attendeeIds.filter((id) => memberIds.includes(id))]
        : [createdBy];
  return [...new Set(list.filter(Boolean))];
}

/** May this person see the event? Private ones stay private, even from admins. */
export function canSeeEvent(
  event: { audience: string; createdByUserId: string | null },
  userId: string,
  attendeeIds: readonly string[],
): boolean {
  if (event.audience === 'everyone') return true;
  if (event.createdByUserId === userId) return true;
  return event.audience === 'people' && attendeeIds.includes(userId);
}

// Deadline resolution for TUNGAN.
//
// Every deadline in this product is a real instant, resolved in Asia/Bangkok
// at the moment the task is created. Display strings are produced from that
// instant and never stored back into it. The Worker and the UI both import
// this file so a reminder fires at the time the user actually meant.

export const PRODUCT_TIME_ZONE = 'Asia/Bangkok';

/** Minutes that `timeZone` is ahead of UTC at the given instant. */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const at = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUTC = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    at('hour') % 24,
    at('minute'),
    at('second'),
  );
  return (asUTC - Math.floor(instant.getTime() / 1000) * 1000) / 60000;
}

/** The calendar date in `timeZone` at the given instant. */
export function zonedDateParts(
  instant: Date,
  timeZone: string = PRODUCT_TIME_ZONE,
): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(instant);
  const at = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(at('year')),
    month: Number(at('month')),
    day: Number(at('day')),
    weekday: Math.max(0, weekdays.indexOf(at('weekday'))),
  };
}

/** Turn a wall-clock reading in `timeZone` into a real UTC instant. */
export function fromZonedWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string = PRODUCT_TIME_ZONE,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let instant = naive;
  // Two passes settle the case where the offset differs either side of the
  // guess. Thailand has no DST today, but this must not depend on that.
  for (let pass = 0; pass < 2; pass++) {
    const offset = zoneOffsetMinutes(new Date(instant), timeZone);
    instant = naive - offset * 60000;
  }
  return new Date(instant);
}

export type DeadlineConfidence = 'explicit' | 'inferred' | 'fallback';

export type ResolvedDeadline = {
  /** The real instant the work is due. */
  at: Date;
  /** How much of it came from the text rather than from defaults. */
  confidence: DeadlineConfidence;
  /** What the parser recognised, for the confirmation screen. */
  matched: { day: string | null; time: string | null };
  /** The exact words the reading came from, so a person can check it
   *  rather than trust it. */
  sourcePhrase: string | null;
};

const HOUR_WORDS: Array<[RegExp, (n: number) => number]> = [
  // "ก่อนบ่าย 3" -> 15:00. Guard the nonsensical "ก่อนบ่าย 12" -> 12:00,
  // which the prototype turned into 24:00.
  [/ก่อนบ่าย\s*(\d{1,2})/, (n) => (n < 12 ? n + 12 : n)],
  [/บ่าย\s*(\d{1,2})\s*โมง/, (n) => (n < 12 ? n + 12 : n)],
  [/(\d{1,2})\s*โมงเย็น/, (n) => (n < 12 ? n + 12 : n)],
  [/(\d{1,2})\s*โมงเช้า/, (n) => n],
  [/(\d{1,2})\s*ทุ่ม/, (n) => (n + 18 <= 23 ? n + 18 : 23)],
];

/**
 * Resolve Thai deadline text against a reference instant.
 *
 * `cutoff` is the workspace's end-of-day ("17:00") and is used only when the
 * text names a day but no time. Text that names neither is reported as
 * `fallback` so the caller can ask a human instead of guessing.
 */
export function resolveDeadline(
  text: string,
  options: { now?: Date; cutoff?: string; timeZone?: string } = {},
): ResolvedDeadline {
  const now = options.now ?? new Date();
  const cutoff = options.cutoff ?? '17:00';
  const timeZone = options.timeZone ?? PRODUCT_TIME_ZONE;
  const value = (text ?? '').trim();

  const today = zonedDateParts(now, timeZone);
  let dayOffset = 0;
  let matchedDay: string | null = null;
  const phrases: string[] = [];

  const dayRules: Array<[RegExp, number, string]> = [
    [/มะรืน(นี้)?/, 2, 'มะรืนนี้'],
    [/พรุ่งนี้/, 1, 'พรุ่งนี้'],
    [/ภายในวันนี้|ก่อนเลิกงาน|วันนี้/, 0, 'วันนี้'],
    [/(วัน)?ศุกร์/, (5 - today.weekday + 7) % 7 || 7, 'วันศุกร์'],
  ];
  for (const [pattern, offset, label] of dayRules) {
    const found = value.match(pattern);
    if (found) {
      dayOffset = offset;
      matchedDay = label;
      phrases.push(found[0]);
      break;
    }
  }

  let hour: number | null = null;
  let minute = 0;
  let matchedTime: string | null = null;

  const explicit = value.match(/(\d{1,2})[:.](\d{2})/);
  if (explicit) {
    const h = Number(explicit[1]);
    const m = Number(explicit[2]);
    if (h <= 23 && m <= 59) {
      hour = h;
      minute = m;
      matchedTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      phrases.push(explicit[0]);
    }
  }

  if (hour === null) {
    for (const [pattern, toHour] of HOUR_WORDS) {
      const found = value.match(pattern);
      if (found) {
        const candidate = toHour(Number(found[1]));
        if (candidate >= 0 && candidate <= 23) {
          hour = candidate;
          matchedTime = `${String(candidate).padStart(2, '0')}:00`;
          phrases.push(found[0]);
        }
        break;
      }
    }
  }

  if (hour === null) {
    const bare = value.match(/(\d{1,2})\s*โมง/);
    if (bare) {
      let candidate = Number(bare[1]);
      // "บ่าย"/"เย็น" anywhere in the phrase pushes a bare hour into the PM.
      if (/บ่าย|เย็น|ค่ำ/.test(value) && candidate < 12) candidate += 12;
      if (candidate >= 0 && candidate <= 23) {
        hour = candidate;
        matchedTime = `${String(candidate).padStart(2, '0')}:00`;
        phrases.push(bare[0]);
      }
    }
  }

  if (hour === null) {
    // Bare parts of day. These apply whether or not a day was named — the
    // prototype only honoured "เช้า" when "พรุ่งนี้" was also present, so
    // "วันนี้เช้า" silently became the 17:00 cutoff.
    if (/เที่ยง/.test(value)) {
      hour = 12;
      matchedTime = '12:00';
    } else if (/เช้า/.test(value)) {
      hour = 9;
      matchedTime = '09:00';
    } else if (/บ่าย/.test(value)) {
      hour = 14;
      matchedTime = '14:00';
    } else if (/เย็น|ค่ำ/.test(value)) {
      hour = 17;
      matchedTime = '17:00';
    }
  }

  let confidence: DeadlineConfidence;
  if (matchedTime && matchedDay) confidence = 'explicit';
  else if (matchedTime || matchedDay) confidence = 'inferred';
  else confidence = 'fallback';

  if (hour === null) {
    const [h, m] = cutoff.split(':').map(Number);
    hour = Number.isFinite(h) ? h : 17;
    minute = Number.isFinite(m) ? m : 0;
  }

  const at = fromZonedWallClock(
    today.year,
    today.month,
    today.day + dayOffset,
    hour,
    minute,
    timeZone,
  );

  return {
    at,
    confidence,
    matched: { day: matchedDay, time: matchedTime },
    sourcePhrase: phrases.length ? phrases.join(' ').trim() : null,
  };
}

export type QuickDay = 'today' | 'tomorrow' | 'friday' | 'nextweek';

/**
 * The dates behind the quick buttons, so each one can show what it resolves
 * to. A button labelled only "ศุกร์" is ambiguous exactly when it matters.
 *
 * The ศุกร์ rule, stated rather than left to be discovered:
 *  - Monday to Thursday → this week's Friday.
 *  - On Friday, before the working day ends → today. Someone typing "ศุกร์"
 *    on a Friday morning means today, not eight days away.
 *  - On Friday after hours, and at the weekend → next Friday, because this
 *    week's has effectively gone.
 */
export function quickDayDate(
  which: QuickDay,
  options: { now?: Date; endOfDay?: string; timeZone?: string } = {},
): { year: number; month: number; day: number } {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? PRODUCT_TIME_ZONE;
  const today = zonedDateParts(now, timeZone);
  const shift = (days: number) => {
    const at = fromZonedWallClock(today.year, today.month, today.day + days, 12, 0, timeZone);
    const p = zonedDateParts(at, timeZone);
    return { year: p.year, month: p.month, day: p.day };
  };

  if (which === 'today') return shift(0);
  if (which === 'tomorrow') return shift(1);
  if (which === 'nextweek') return shift(7);

  const [endH, endM] = (options.endOfDay ?? '18:00').split(':').map(Number);
  const nowMinutes = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now).replace(':', ''),
  );
  const endMinutes = (Number.isFinite(endH) ? endH : 18) * 100 + (Number.isFinite(endM) ? endM : 0);

  if (today.weekday === 5) return nowMinutes < endMinutes ? shift(0) : shift(7);
  const until = (5 - today.weekday + 7) % 7;
  return shift(until === 0 ? 7 : until);
}

export type DayBucket = 'today' | 'tomorrow' | 'friday' | 'later' | 'none';

/**
 * Which column of the deadline view an instant belongs to.
 *
 * Derived on read from the stored instant and the current time, so a task
 * cannot sit in "today" because that is where it was filed yesterday.
 */
export function dayBucket(
  dueAt: Date | string | null,
  now: Date = new Date(),
  timeZone: string = PRODUCT_TIME_ZONE,
): DayBucket {
  if (!dueAt) return 'none';
  const at = typeof dueAt === 'string' ? new Date(dueAt) : dueAt;
  if (!Number.isFinite(at.getTime())) return 'none';
  const target = zonedDateParts(at, timeZone);
  const today = zonedDateParts(now, timeZone);
  const days = Math.round(
    (Date.UTC(target.year, target.month - 1, target.day) -
      Date.UTC(today.year, today.month - 1, today.day)) /
      86400000,
  );
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  const untilFriday = (5 - today.weekday + 7) % 7 || 7;
  if (days === untilFriday) return 'friday';
  return 'later';
}

/** A deadline is late when its instant has passed. No string matching. */
export function isOverdue(dueAt: Date | string, now: Date = new Date()): boolean {
  const at = typeof dueAt === 'string' ? new Date(dueAt) : dueAt;
  if (!Number.isFinite(at.getTime())) return false;
  return at.getTime() < now.getTime();
}

/** Thai display label for a stored instant. Derived, never stored. */
export function formatDeadline(
  dueAt: Date | string,
  options: { now?: Date; timeZone?: string } = {},
): string {
  const at = typeof dueAt === 'string' ? new Date(dueAt) : dueAt;
  if (!Number.isFinite(at.getTime())) return 'ไม่มีกำหนด';
  const timeZone = options.timeZone ?? PRODUCT_TIME_ZONE;
  const now = options.now ?? new Date();

  const target = zonedDateParts(at, timeZone);
  const today = zonedDateParts(now, timeZone);
  const dayDelta =
    Date.UTC(target.year, target.month - 1, target.day) -
    Date.UTC(today.year, today.month - 1, today.day);
  const days = Math.round(dayDelta / 86400000);

  const time = new Intl.DateTimeFormat('th-TH', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);

  if (days === 0) return `วันนี้ ${time}`;
  if (days === 1) return `พรุ่งนี้ ${time}`;
  if (days === -1) return `เมื่อวาน ${time}`;
  const date = new Intl.DateTimeFormat('th-TH', {
    timeZone,
    day: 'numeric',
    month: 'short',
  }).format(at);
  return `${date} ${time}`;
}

import { t, intlLocale } from './i18n/index.ts';
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
  /** The same words one by one, so a title can be cleaned of them. */
  phrases: string[];
};

/** Hours said as words: "บ่ายสาม", "หกโมงเย็น", "สองทุ่ม". Longest first. */
const THAI_NUMBERS: Array<[string, number]> = [
  ['สิบเอ็ด', 11], ['สิบสอง', 12], ['สิบ', 10], ['หนึ่ง', 1], ['สอง', 2], ['สาม', 3],
  ['สี่', 4], ['ห้า', 5], ['หก', 6], ['เจ็ด', 7], ['แปด', 8], ['เก้า', 9],
];
const NUM = `(\\d{1,2}|${THAI_NUMBERS.map(([w]) => w).join('|')})`;
function toNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  return THAI_NUMBERS.find(([w]) => w === value)?.[1] ?? NaN;
}

/** Monday 1 … Saturday 6, Sunday 0 — as zonedDateParts counts them. The
 *  bare word อาทิตย์ also means "week", so Sunday needs its วัน. */
const WEEKDAYS: Array<[string, number]> = [
  ['(?:วัน)?จันทร์', 1], ['(?:วัน)?อังคาร', 2], ['(?:วัน)?พุธ', 3],
  ['(?:วัน)?พฤหัส(?:บดี)?', 4], ['(?:วัน)?ศุกร์', 5], ['(?:วัน)?เสาร์', 6], ['วันอาทิตย์', 0],
];

/** Month names, full and short, with or without dots. */
const MONTHS: Array<[string, number]> = [
  ['มกราคม|มกรา|ม\\.?ค\\.?', 1], ['กุมภาพันธ์|กุมภา|ก\\.?พ\\.?', 2], ['มีนาคม|มีนา|มี\\.?ค\\.?', 3],
  ['เมษายน|เมษา|เม\\.?ย\\.?', 4], ['พฤษภาคม|พฤษภา|พ\\.?ค\\.?', 5], ['มิถุนายน|มิถุนา|มิ\\.?ย\\.?', 6],
  ['กรกฎาคม|กรกฎา|ก\\.?ค\\.?', 7], ['สิงหาคม|สิงหา|ส\\.?ค\\.?', 8], ['กันยายน|กันยา|ก\\.?ย\\.?', 9],
  ['ตุลาคม|ตุลา|ต\\.?ค\\.?', 10], ['พฤศจิกายน|พฤศจิกา|พ\\.?ย\\.?', 11], ['ธันวาคม|ธันวา|ธ\\.?ค\\.?', 12],
];

/** A written year: Buddhist (2569, 69) or Christian (2026, 26). */
function toYear(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (value.length === 4) return n > 2400 ? n - 543 : n;
  return n >= 50 ? 2500 + n - 543 : 2000 + n;
}

const HOUR_WORDS: Array<[RegExp, (n: number) => number]> = [
  // "บ่ายโมง" is 13:00 — one o'clock in the afternoon, with no number said.
  [/บ่าย\s*โมง()/, () => 13],
  // "ก่อนบ่าย 3", "บ่าย 3", "บ่ายสาม", "บ่าย 3 โมง" -> 15:00. Guard the
  // nonsensical "ก่อนบ่าย 12" -> 12:00, which the prototype turned into 24:00.
  [new RegExp(`(?:ก่อน)?บ่าย\\s*${NUM}(?:\\s*โมง)?`), (n) => (n < 12 ? n + 12 : n)],
  [new RegExp(`${NUM}\\s*โมงเย็น`), (n) => (n < 12 ? n + 12 : n)],
  [new RegExp(`${NUM}\\s*โมงเช้า`), (n) => n],
  [new RegExp(`${NUM}\\s*ทุ่ม`), (n) => (n + 18 <= 23 ? n + 18 : 23)],
];

/**
 * Days from today to a weekday (0 Sunday … 6 Saturday). `next`: that day in
 * next week (Monday-start). `this`: this week's, today included. `bare`: the
 * coming one, never today — "ศุกร์" said on a Friday is about next Friday.
 * Shared with the AI's reading (lib/ai/jev-questions.ts) so both agree.
 */
export function weekdayOffset(todayWeekday: number, target: number, which: 'this' | 'next' | 'bare'): number {
  if (which === 'next') {
    const toMonday = todayWeekday === 0 ? 1 : 8 - todayWeekday;
    return toMonday + ((target + 6) % 7);
  }
  const until = (target - todayWeekday + 7) % 7;
  return which === 'this' ? until : until || 7;
}

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
  const daysUntil = (year: number, month: number, day: number) =>
    Math.round((Date.UTC(year, month - 1, day) - Date.UTC(today.year, today.month - 1, today.day)) / 86400000);
  /** A date said without a year that has already passed means next year's. */
  const ahead = (month: number, day: number, year?: number) =>
    year !== undefined || daysUntil(today.year, month, day) >= 0
      ? daysUntil(year ?? today.year, month, day)
      : daysUntil(today.year + 1, month, day);
  const validDay = (month: number, day: number) => month >= 1 && month <= 12 && day >= 1 && day <= 31;

  // First match wins, most specific first: a written date beats a weekday,
  // and "วันศุกร์หน้า" beats "ศุกร์".
  const dayRules: Array<[RegExp, (m: RegExpMatchArray) => number | null]> = [
    // 30/10, 30/10/69, 30/10/2026
    [/(?<![\d:.])(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2}|\d{4}))?(?![\d:])/, (m) => {
      const [day, month] = [Number(m[1]), Number(m[2])];
      if (!validDay(month, day)) return null;
      return ahead(month, day, m[3] ? toYear(m[3], today.year) : undefined);
    }],
    // 5 พ.ย., วันที่ 5 พฤศจิกายน 2569
    ...MONTHS.map(([names, month]): [RegExp, (m: RegExpMatchArray) => number | null] => [
      new RegExp(`(?:วันที่\\s*)?(\\d{1,2})\\s*(?:${names})(?:\\s*(\\d{4}|\\d{2})(?!\\s*(?:โมง|ทุ่ม|:|\\.)))?`),
      (m) => (validDay(month, Number(m[1])) ? ahead(month, Number(m[1]), m[2] ? toYear(m[2], today.year) : undefined) : null),
    ]),
    // "วันที่ 5": this month's, or next month's once it has passed.
    [/วันที่\s*(\d{1,2})(?!\s*\/)/, (m) => {
      const day = Number(m[1]);
      if (day < 1 || day > 31) return null;
      if (day >= today.day) return daysUntil(today.year, today.month, day);
      return today.month === 12 ? daysUntil(today.year + 1, 1, day) : daysUntil(today.year, today.month + 1, day);
    }],
    [/สิ้นเดือนหน้า/, () => daysUntil(today.year, today.month + 2, 0)],
    [/สิ้นเดือน(นี้)?/, () => daysUntil(today.year, today.month + 1, 0)],
    [/สิ้นปี(นี้)?/, () => daysUntil(today.year, 12, 31)],
    [/มะรืน(นี้)?/, () => 2],
    [/พรุ่งนี้/, () => 1],
    [/ภายในวันนี้|ก่อนเลิกงาน|วันนี้/, () => 0],
    [new RegExp(`อีก\\s*${NUM}\\s*วัน`), (m) => {
      const n = toNumber(m[1]);
      return n >= 1 && n <= 60 ? n : null;
    }],
    // วันศุกร์หน้า: next week's Friday. วันศุกร์นี้: this week's, today
    // included. A bare ศุกร์: the coming one, never today (it is said about
    // work still to do — "ศุกร์" on a Friday means next Friday).
    ...WEEKDAYS.map(([names, target]): [RegExp, (m: RegExpMatchArray) => number | null] => [
      new RegExp(`(?:${names})(\\s*(?:นี้|หน้า))?`),
      (m) => {
        const which = (m[1] ?? '').trim();
        return weekdayOffset(today.weekday, target, which === 'หน้า' ? 'next' : which === 'นี้' ? 'this' : 'bare');
      },
    ]),
    // ภายในสัปดาห์นี้: the end of this working week (Friday); at the weekend,
    // Sunday.
    [/(?:สัปดาห์|อาทิตย์)นี้/, () => (today.weekday === 0 ? 0 : today.weekday === 6 ? 1 : 5 - today.weekday)],
  ];
  for (const [pattern, toOffset] of dayRules) {
    const found = value.match(pattern);
    if (!found) continue;
    const offset = toOffset(found);
    if (offset === null) continue;
    dayOffset = offset;
    const said = found[0].trim();
    // The label shown on the card: the words said, with the old fixed names
    // kept for the ways of saying today and the day after tomorrow.
    matchedDay = /วันนี้|ก่อนเลิกงาน/.test(said) ? 'วันนี้' : /มะรืน/.test(said) ? 'มะรืนนี้' : said;
    phrases.push(said);
    break;
  }

  let hour: number | null = null;
  let minute = 0;
  let matchedTime: string | null = null;

  // Every way a time can be said, and the one said FIRST wins: in "พรุ่งนี้
  // 9 โมง … ส่วนนนท์ตอนบ่ายสาม" the deadline is 9:00. (Each kind used to be
  // tried in turn, so a later "บ่าย" won over an earlier "9 โมง".)
  const times: Array<{ index: number; text: string; hour: number; minute: number }> = [];
  const explicit = value.match(/(?<![\d/])(\d{1,2})[:.](\d{2})(?![\d/])/);
  if (explicit && Number(explicit[1]) <= 23 && Number(explicit[2]) <= 59) {
    times.push({ index: explicit.index ?? 0, text: explicit[0], hour: Number(explicit[1]), minute: Number(explicit[2]) });
  }
  for (const [pattern, toHour] of HOUR_WORDS) {
    const found = value.match(pattern);
    if (!found) continue;
    const candidate = toHour(toNumber(found[1] ?? ''));
    if (candidate >= 0 && candidate <= 23) times.push({ index: found.index ?? 0, text: found[0], hour: candidate, minute: 0 });
  }
  const bare = value.match(new RegExp(`${NUM}\\s*โมง`));
  if (bare && !times.some((t) => t.index <= (bare.index ?? 0) && (bare.index ?? 0) < t.index + t.text.length)) {
    let candidate = toNumber(bare[1]);
    // "บ่าย"/"เย็น" said just before a bare hour puts it in the PM
    // ("เย็นนี้ 6 โมง"); one said elsewhere in the message does not.
    const before = value.slice(Math.max(0, (bare.index ?? 0) - 8), bare.index ?? 0);
    if (/บ่าย|เย็น|ค่ำ/.test(before) && candidate < 12) candidate += 12;
    if (candidate >= 0 && candidate <= 23) times.push({ index: bare.index ?? 0, text: bare[0], hour: candidate, minute: 0 });
  }
  const first = times.sort((a, b) => a.index - b.index)[0];
  if (first) {
    hour = first.hour;
    minute = first.minute;
    matchedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    phrases.push(first.text.trim());
  }

  if (hour === null) {
    // Bare parts of day. These apply whether or not a day was named — the
    // prototype only honoured "เช้า" when "พรุ่งนี้" was also present, so
    // "วันนี้เช้า" silently became the 17:00 cutoff.
    if (/เที่ยง/.test(value)) {
      hour = 12;
      matchedTime = '12:00';
    } else if (/เช้า(?!ไป|มา)/.test(value)) {
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
    phrases,
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

/**
 * A deadline is late when its instant has passed. No string matching.
 *
 * Takes null because that is what a task without a deadline actually holds.
 * Requiring every caller to guard first meant one missed `?? ''` would throw
 * inside a render — and no deadline is not the same as an overdue one.
 */
export function isOverdue(
  dueAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  const at = toInstant(dueAt);
  if (!at) return false;
  return at.getTime() < now.getTime();
}

/** One place that turns anything deadline-shaped into an instant, or null. */
function toInstant(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const at = typeof value === 'string' ? new Date(value) : value;
  return Number.isFinite(at.getTime()) ? at : null;
}

/** Thai display label for a stored instant. Derived, never stored. */
export function formatDeadline(
  dueAt: Date | string | null | undefined,
  options: { now?: Date; timeZone?: string } = {},
): string {
  const at = toInstant(dueAt);
  if (!at) return t('ไม่มีกำหนด');
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

  if (days === 0) return t('วันนี้ {0}', time);
  if (days === 1) return t('พรุ่งนี้ {0}', time);
  if (days === -1) return t('เมื่อวาน {0}', time);
  const date = new Intl.DateTimeFormat(intlLocale(), {
    timeZone,
    day: 'numeric',
    month: 'short',
  }).format(at);
  return `${date} ${time}`;
}


/**
 * Relative time for lists: "อีก 2 ชม.", "เลย 1 วัน".
 *
 * Lists are scanned, not read — "อีก 2 ชม." answers the question the reader
 * actually has, where "2 ก.ย. 16:00" makes them do the subtraction. Detail
 * screens keep the absolute time, where precision is what is wanted.
 */
export function relativeDeadline(
  dueAt: Date | string | null,
  now: Date = new Date(),
): string {
  const at = toInstant(dueAt);
  if (!at) return t('ไม่มีกำหนด');

  const diffMs = at.getTime() - now.getTime();
  const late = diffMs < 0;
  const mins = Math.floor(Math.abs(diffMs) / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  const amount =
    mins < 1 ? t('ไม่ถึงนาที')
    : mins < 60 ? t('{0} นาที', mins)
    : hours < 24 ? t('{0} ชม.', hours)
    : days < 30 ? t('{0} วัน', days)
    : t('{0} เดือน', Math.floor(days / 30));

  return late ? t('เลย {0}', amount) : t('อีก {0}', amount);
}

/** How long something has sat in one state: "ติดปัญหา 3 วัน". */
export function relativeSince(
  since: Date | string | null | undefined,
  now: Date = new Date(),
): string {
  const at = toInstant(since);
  if (!at) return '';
  const mins = Math.floor((now.getTime() - at.getTime()) / 60000);
  if (mins < 60) return t('{0} นาที', Math.max(0, mins));
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('{0} ชม.', hours);
  return t('{0} วัน', Math.floor(hours / 24));
}

import type { JevAnswers, JevQuestion } from './jev.ts';
import type { Member } from './read-message.ts';
import { fromZonedWallClock, PRODUCT_TIME_ZONE, weekdayOffset, zonedDateParts } from '../deadline.ts';

/**
 * What we ask Jev about a tagged message, and what our code decides from the
 * answers (2026-10-26). Pure, and every word Jev is shown lives here.
 *
 * Jev judges; code decides. Jev is asked only what a person would see at a
 * glance — is this asking someone to do something, does it say who, which
 * day and time does it say — each as its own question, all in one call.
 * The calendar math is ours (TypeSafe's date-extraction pattern): Jev reads
 * which day was said, code counts from today, and a day already gone is
 * refused. A Choice always picks something, so each one has a yes/no
 * question beside it that says whether there was anything to pick.
 *
 * The truth table (readJev):
 *   is_task < 0.3                  → not a task: the draft is marked, the
 *                                    writing model is not asked
 *   is_task 0.3–0.7                → unsure: nothing filled from Jev
 *   is_task ≥ 0.7, names ≥ 0.7     → the person Jev picked
 *   is_task ≥ 0.7, deadline ≥ 0.7  → the day Jev read, the time if one was
 *                                    said (else the team's end of day)
 */

/** Starting thresholds from TypeSafe's guidance; not fitted to test cases. */
export const YES = 0.7;
export const NO = 0.3;

const WEEKDAY_OPTIONS: Record<string, [number, string]> = {
  monday: [1, 'วันจันทร์'], tuesday: [2, 'วันอังคาร'], wednesday: [3, 'วันพุธ'],
  thursday: [4, 'วันพฤหัสบดี'], friday: [5, 'วันศุกร์'], saturday: [6, 'วันเสาร์'], sunday: [0, 'วันอาทิตย์'],
};
const MONTH_OPTIONS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const TIMES = Array.from({ length: 33 }, (_, i) => {
  const minutes = 6 * 60 + i * 30; // 06:00 … 22:00
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

export type JevNeed = { assignee: boolean; deadline: boolean };

export type JevRequest = {
  state: { message: string; sender: string | null };
  questions: Record<string, JevQuestion>;
  /** Choice option name → user id. */
  people: Map<string, string>;
};

export function jevRequest(params: {
  text: string;
  members: Member[];
  senderUserId?: string | null;
  need: JevNeed;
}): JevRequest {
  const message = params.text.replace(/@ทันงาน|@tungan/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
  const sender = params.members.find((m) => m.userId === params.senderUserId)?.names[0] ?? null;
  const questions: Record<string, JevQuestion> = {
    is_task: {
      type: 'noul',
      instructions: 'ข้อความนี้ขอให้คนในทีมทำงานบางอย่าง',
      criteria: {
        true: 'ขอหรือสั่งให้ทำ ส่ง เตรียม ตาม ซื้อ หรือแก้อะไรบางอย่าง เช่น "เมย์ ส่งรายงานพรุ่งนี้"',
        false: 'ทักทาย ขอบคุณ หรือคุยเล่น โดยไม่มีงานให้ใครทำ เช่น "ขอบคุณครับ" หรือ "สวัสดีครับทุกคน"',
      },
    },
  };

  // Option names are what Jev reads, so each is the person's name; a second
  // person with the same name gets a number rather than a lookup id.
  const people = new Map<string, string>();
  if (params.need.assignee && params.members.length) {
    const criteria: Record<string, string | null> = {};
    for (const m of params.members.slice(0, 200)) {
      const base = m.names[0] || 'สมาชิก';
      let key = base;
      for (let n = 2; people.has(key); n += 1) key = `${base} (${n})`;
      people.set(key, m.userId);
      const also = m.names.slice(1, 4);
      criteria[key] = [
        also.length ? `เรียกอีกชื่อว่า ${also.join(', ')}` : '',
        m.userId === params.senderUserId ? 'คนที่ส่งข้อความนี้' : '',
      ].filter(Boolean).join(' · ') || null;
    }
    questions.names_person = {
      type: 'noul',
      instructions: 'ข้อความนี้บอกว่าใครเป็นคนทำงานนี้',
      criteria: {
        true: 'มีชื่อคนที่ต้องทำ หรือคนส่งบอกว่าจะทำเอง เช่น "นนท์รับไป" หรือ "บอสเองจะรีวิว"',
        false: 'ไม่ได้บอกว่าใครทำ เช่น "ใครว่างช่วยดูที" หรือ "ฝากทีมดูหน่อย"',
      },
    };
    questions.assignee = { type: 'choice', instructions: 'ใครเป็นคนที่ต้องทำงานในข้อความนี้', criteria };
  }

  if (params.need.deadline) {
    questions.states_deadline = {
      type: 'noul',
      instructions: 'ข้อความนี้บอกว่างานต้องเสร็จวันไหน',
      criteria: {
        true: 'มีวัน เช่น วันนี้ พรุ่งนี้ วันศุกร์ 30/10 วันที่ 5 สิ้นเดือน หรือ tomorrow',
        false: 'ไม่มีวันเลย เช่น "ส่งของให้ลูกค้าที่บางนา"',
      },
    };
    questions.day_kind = {
      type: 'choice',
      instructions: 'วันที่งานต้องเสร็จ เขียนไว้แบบไหน',
      criteria: {
        today: 'วันนี้ เย็นนี้ ภายในวันนี้',
        tomorrow: 'พรุ่งนี้',
        day_after_tomorrow: 'มะรืน',
        named_weekday: 'ชื่อวันในสัปดาห์ เช่น วันพุธ วันศุกร์หน้า',
        calendar_date: 'วันที่ของเดือน เช่น 30/10 วันที่ 5 พ.ย.',
        end_of_month: 'สิ้นเดือน',
      },
    };
    questions.weekday = {
      type: 'choice',
      instructions: 'ถ้าข้อความบอกชื่อวันในสัปดาห์ เป็นวันไหน',
      criteria: Object.fromEntries(Object.entries(WEEKDAY_OPTIONS).map(([k, [, th]]) => [k, th])),
    };
    questions.week_offset = {
      type: 'choice',
      instructions: 'ถ้าข้อความบอกชื่อวันในสัปดาห์ เป็นของสัปดาห์ไหน',
      criteria: {
        this_week: 'มีคำว่า นี้ เช่น วันพฤหัสนี้',
        next_week: 'มีคำว่า หน้า เช่น วันศุกร์หน้า',
        unqualified: 'บอกแค่ชื่อวัน เช่น วันพุธ',
      },
    };
    questions.day_of_month = {
      type: 'choice',
      instructions: 'ถ้าข้อความบอกวันที่ของเดือน เป็นวันที่เท่าไร',
      criteria: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(i + 1), null])),
    };
    questions.month = {
      type: 'choice',
      instructions: 'ถ้าข้อความบอกเดือน เป็นเดือนไหน',
      criteria: { ...Object.fromEntries(MONTH_OPTIONS.map((m) => [m, null])), not_stated: 'ไม่ได้บอกเดือน' },
    };
    questions.states_time = {
      type: 'noul',
      instructions: 'ข้อความนี้บอกเวลาที่งานต้องเสร็จ',
      criteria: {
        true: 'มีเวลา เช่น 10 โมง บ่ายสาม 17:00 ก่อนเที่ยง 9am',
        false: 'บอกแค่วัน ไม่บอกเวลา',
      },
    };
    questions.time = {
      type: 'choice',
      instructions: 'งานต้องเสร็จกี่โมง (เวลาไทย แบบ 24 ชั่วโมง)',
      criteria: Object.fromEntries(TIMES.map((t) => [t, null])),
    };
  }
  return { state: { message, sender }, questions, people };
}

export type JevReading = {
  isTask: 'yes' | 'no' | 'unsure';
  assigneeUserId: string | null;
  dueAt: Date | null;
};

const noul = (answers: JevAnswers, key: string): number | null => {
  const a = answers[key];
  return a && a.type === 'noul' && typeof a.noul === 'number' ? a.noul : null;
};
const choice = (answers: JevAnswers, key: string): string | null => {
  const a = answers[key];
  return a && a.type === 'choice' && typeof a.choice === 'string' ? a.choice : null;
};

/** The truth table at the top of this file. */
export function readJev(
  answers: JevAnswers,
  ctx: { people: Map<string, string>; need: JevNeed; now: Date; cutoff: string },
): JevReading {
  const isTaskP = noul(answers, 'is_task');
  const isTask = isTaskP === null ? 'unsure' : isTaskP < NO ? 'no' : isTaskP >= YES ? 'yes' : 'unsure';
  const out: JevReading = { isTask, assigneeUserId: null, dueAt: null };
  if (isTask !== 'yes') return out;

  if (ctx.need.assignee && (noul(answers, 'names_person') ?? 0) >= YES) {
    out.assigneeUserId = ctx.people.get(choice(answers, 'assignee') ?? '') ?? null;
  }

  if (ctx.need.deadline && (noul(answers, 'states_deadline') ?? 0) >= YES) {
    const today = zonedDateParts(ctx.now, PRODUCT_TIME_ZONE);
    const daysUntil = (y: number, m: number, d: number) =>
      Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.year, today.month - 1, today.day)) / 86400000);
    let offset: number | null = null;
    switch (choice(answers, 'day_kind')) {
      case 'today': offset = 0; break;
      case 'tomorrow': offset = 1; break;
      case 'day_after_tomorrow': offset = 2; break;
      case 'end_of_month': offset = daysUntil(today.year, today.month + 1, 0); break;
      case 'named_weekday': {
        const target = WEEKDAY_OPTIONS[choice(answers, 'weekday') ?? '']?.[0];
        const week = choice(answers, 'week_offset');
        if (target !== undefined) {
          offset = weekdayOffset(today.weekday, target, week === 'next_week' ? 'next' : week === 'this_week' ? 'this' : 'bare');
        }
        break;
      }
      case 'calendar_date': {
        const day = Number(choice(answers, 'day_of_month'));
        const monthIndex = MONTH_OPTIONS.indexOf(choice(answers, 'month') ?? '');
        if (day >= 1 && day <= 31) {
          if (monthIndex >= 0) {
            const m = monthIndex + 1;
            const thisYear = daysUntil(today.year, m, day);
            offset = thisYear >= 0 ? thisYear : daysUntil(today.year + 1, m, day);
          } else {
            // A day of the month alone: this month's, or next month's once past.
            offset = day >= today.day ? daysUntil(today.year, today.month, day) : daysUntil(today.year, today.month + 1, day);
          }
        }
        break;
      }
      default:
        offset = null;
    }
    if (offset !== null) {
      const said = (noul(answers, 'states_time') ?? 0) >= YES ? choice(answers, 'time') : null;
      const [hh, mm] = (said && TIMES.includes(said) ? said : ctx.cutoff).split(':').map(Number);
      const at = fromZonedWallClock(today.year, today.month, today.day + offset, hh, mm, PRODUCT_TIME_ZONE);
      // A day already gone is a misreading, not a deadline.
      if (at.getTime() >= ctx.now.getTime() - 60_000) out.dueAt = at;
    }
  }
  return out;
}

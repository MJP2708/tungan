import { fromZonedWallClock, zonedDateParts, PRODUCT_TIME_ZONE } from '../deadline.ts';

/**
 * Reading a tagged LINE message with the model (2026-10-25). Pure: the
 * prompt, the answer's shape, the strict check of what came back, and how
 * it combines with what the rules already read.
 *
 * The model is asked only when the rules could not read the message well
 * (`needsModel`). It proposes; a person confirms on the same card as always.
 * People are sent as short refs (M1, M2…), never LINE ids, and a ref the
 * model makes up is dropped. Dates come back as a calendar date and a time,
 * which lib/deadline.ts turns into the real instant — the model never
 * produces a timestamp itself.
 */

export type RulesReading = {
  title: string;
  assigneeUserId: string | null;
  dueAt: Date | null;
};

export type Member = { userId: string; names: string[] };

export type ModelTask = {
  title: string;
  assigneeUserId: string | null;
  dueAt: Date | null;
  reason: string;
};

/** Rules alone were not enough: nothing found, or the "title" is a paragraph. */
export function needsModel(rules: RulesReading): boolean {
  if (rules.title.length > 60) return true;
  return !rules.dueAt && !rules.assigneeUserId;
}

const MAX_MEMBERS = 30;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'assignee', 'dueDate', 'dueTime', 'reason'],
        properties: {
          title: { type: 'string', maxLength: 120 },
          assignee: { type: ['string', 'null'] },
          dueDate: { type: ['string', 'null'] },
          dueTime: { type: ['string', 'null'] },
          reason: { type: 'string', maxLength: 200 },
        },
      },
    },
  },
} as const;

const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

export function buildReadRequest(params: {
  text: string;
  members: Member[];
  senderUserId?: string | null;
  now: Date;
}) {
  const members = params.members.slice(0, MAX_MEMBERS);
  const refOf = new Map(members.map((m, i) => [m.userId, `M${i + 1}`]));
  const p = zonedDateParts(params.now, PRODUCT_TIME_ZONE);
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: PRODUCT_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(params.now);
  const today = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const system = [
    'คุณอ่านข้อความ LINE หนึ่งข้อความที่แท็ก @ทันงาน แล้วเสนองานที่ต้องทำ ไม่เกิน 3 งาน',
    'ตอบเป็น JSON ตามโครงสร้างที่กำหนดเท่านั้น',
    '- title: ชื่องานสั้น ๆ เป็นคำสั่ง ไม่เกิน 80 ตัวอักษร ไม่มี @ชื่อ และไม่มีคำบอกเวลา',
    '- assignee: ใช้ได้เฉพาะรหัสสมาชิกที่ให้มา (เช่น M2) หรือ null ถ้าไม่แน่ใจ ห้ามเดา',
    '- dueDate: YYYY-MM-DD ตามเวลาไทย หรือ null ถ้าข้อความไม่ได้บอกวัน',
    '- dueTime: HH:MM แบบ 24 ชั่วโมง หรือ null ถ้าไม่ได้บอกเวลา',
    '- reason: ประโยคไทยสั้น ๆ หนึ่งประโยค บอกว่าอ่านแบบนี้เพราะอะไร',
    'ถ้าข้อความไม่ใช่งาน ให้ตอบ tasks เป็นรายการว่าง',
  ].join('\n');
  const user = JSON.stringify({
    now: `${today} ${hhmm} (วัน${WEEKDAYS[p.weekday]}) เวลาประเทศไทย`,
    sender: params.senderUserId ? (refOf.get(params.senderUserId) ?? null) : null,
    members: members.map((m) => ({ ref: refOf.get(m.userId), names: m.names.slice(0, 4) })),
    message: params.text.slice(0, 2000),
  });
  return { system, user, refs: new Map([...refOf].map(([id, ref]) => [ref, id])) };
}

/** Turn the model's answer into tasks, refusing anything malformed. */
export function parseReadResponse(
  data: unknown,
  ctx: { refs: Map<string, string>; cutoff: string },
): ModelTask[] | null {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { tasks?: unknown }).tasks)) return null;
  const out: ModelTask[] = [];
  for (const raw of (data as { tasks: unknown[] }).tasks.slice(0, 3)) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Record<string, unknown>;
    const title = typeof t.title === 'string'
      ? t.title.replace(/@\S+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
      : '';
    if (!title) continue;
    const assigneeUserId = typeof t.assignee === 'string' ? (ctx.refs.get(t.assignee.trim()) ?? null) : null;
    let dueAt: Date | null = null;
    if (typeof t.dueDate === 'string' && DATE.test(t.dueDate)) {
      const [y, m, d] = t.dueDate.split('-').map(Number);
      const time = typeof t.dueTime === 'string' && TIME.test(t.dueTime) ? t.dueTime : ctx.cutoff;
      const [hh, mm] = time.split(':').map(Number);
      const at = fromZonedWallClock(y, m, d, hh, mm, PRODUCT_TIME_ZONE);
      // A real calendar day only: 2026-02-31 rolls over in Date.UTC.
      const check = zonedDateParts(at, PRODUCT_TIME_ZONE);
      if (check.year === y && check.month === m && check.day === d) dueAt = at;
    }
    const reason = typeof t.reason === 'string' ? t.reason.trim().slice(0, 200) : '';
    out.push({ title, assigneeUserId, dueAt, reason });
  }
  return out;
}

/**
 * What goes on the card: what the rules found stays (it is exact), and the
 * model fills what they could not. Several tasks from the model replace a
 * single unreadable rules draft, each still confirmed one by one.
 */
export function mergeReadings(rules: RulesReading[], model: ModelTask[]): Array<RulesReading & { reason: string | null; fromModel: boolean }> {
  if (!model.length) return rules.map((r) => ({ ...r, reason: null, fromModel: false }));
  if (rules.length === 1 && model.length === 1) {
    const r = rules[0];
    const m = model[0];
    return [{
      title: r.title.length > 60 ? m.title : r.title,
      assigneeUserId: r.assigneeUserId ?? m.assigneeUserId,
      dueAt: r.dueAt ?? m.dueAt,
      reason: m.reason || null,
      fromModel: true,
    }];
  }
  const fallback = rules[0];
  return model.map((m) => ({
    title: m.title,
    assigneeUserId: m.assigneeUserId ?? fallback?.assigneeUserId ?? null,
    dueAt: m.dueAt ?? null,
    reason: m.reason || null,
    fromModel: true,
  }));
}

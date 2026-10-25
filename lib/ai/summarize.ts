/**
 * Summaries for a person to read (2026-10-25): one task and its history, or
 * a group's day or week. Pure. Not a chat: one request, one structured
 * answer, shown once.
 *
 * Only what the reader may already see is sent. A task's history arrives
 * already filtered by the reader's audience (a private ติดปัญหา note only if
 * can() lets them read it); a period summary uses titles, counts and the
 * public blocked preset — never a private note.
 */

export const TASK_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'nextStep'],
  properties: {
    summary: { type: 'string', maxLength: 600 },
    nextStep: { type: ['string', 'null'], maxLength: 200 },
  },
} as const;

export const PERIOD_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'highlights'],
  properties: {
    summary: { type: 'string', maxLength: 800 },
    highlights: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 160 } },
  },
} as const;

const SYSTEM_COMMON = [
  'เขียนสรุปภาษาไทยที่อ่านง่าย กระชับ เป็นกลาง สำหรับคนในทีม',
  'ใช้เฉพาะข้อมูลที่ให้มา ห้ามแต่งเติม ห้ามเดาเหตุผลที่ไม่ได้เขียนไว้',
  'ตอบเป็น JSON ตามโครงสร้างที่กำหนดเท่านั้น',
];

export function buildTaskSummaryRequest(input: {
  title: string;
  status: string;
  due: string;
  assignee: string;
  history: Array<{ at: string; who: string; what: string }>;
}) {
  return {
    system: [...SYSTEM_COMMON, 'สรุปงานนี้: ตอนนี้อยู่ตรงไหน ผ่านอะไรมาแล้ว และขั้นต่อไปคืออะไร (nextStep เป็น null ถ้าไม่มี)'].join('\n'),
    user: JSON.stringify({ ...input, history: input.history.slice(-40) }),
  };
}

export function buildPeriodSummaryRequest(input: {
  group: string;
  range: 'day' | 'week';
  closed: string[];
  created: string[];
  overdue: Array<{ title: string; who: string }>;
  blocked: Array<{ title: string; who: string; reason: string }>;
  inReview: string[];
}) {
  const cap = <T,>(list: T[]) => list.slice(0, 40);
  return {
    system: [
      ...SYSTEM_COMMON,
      input.range === 'day' ? 'สรุปงานของกลุ่มวันนี้' : 'สรุปงานของกลุ่มสัปดาห์นี้',
      'highlights: ไม่เกิน 5 ข้อ เรื่องที่ควรรู้หรือควรตาม',
    ].join('\n'),
    user: JSON.stringify({
      ...input,
      closed: cap(input.closed),
      created: cap(input.created),
      overdue: cap(input.overdue),
      blocked: cap(input.blocked),
      inReview: cap(input.inReview),
    }),
  };
}

export function parseTaskSummary(data: unknown): { summary: string; nextStep: string | null } | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const summary = typeof d.summary === 'string' ? d.summary.trim().slice(0, 600) : '';
  if (!summary) return null;
  const nextStep = typeof d.nextStep === 'string' && d.nextStep.trim() ? d.nextStep.trim().slice(0, 200) : null;
  return { summary, nextStep };
}

export function parsePeriodSummary(data: unknown): { summary: string; highlights: string[] } | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const summary = typeof d.summary === 'string' ? d.summary.trim().slice(0, 800) : '';
  if (!summary) return null;
  const highlights = Array.isArray(d.highlights)
    ? d.highlights.filter((h): h is string => typeof h === 'string' && h.trim().length > 0).map((h) => h.trim().slice(0, 160)).slice(0, 5)
    : [];
  return { summary, highlights };
}

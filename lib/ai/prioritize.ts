import { MY_SECTION_TITLES, mySections, type MyTask } from '../tasks/my-tasks.ts';
import { formatDeadline } from '../deadline.ts';

/**
 * "What should I do first?" (2026-10-25). Pure. The model may SUGGEST up to
 * three of my tasks, each with a reason a person can read. It never reorders
 * anything: งานฉัน keeps its own deterministic order (lib/tasks/my-tasks.ts),
 * and the suggestion is shown beside it, labelled as a suggestion.
 *
 * Sent: titles, section, deadline, status, group name. Never a private
 * ติดปัญหา note — only whether a task is blocked.
 */

export type Suggestion = { taskId: string; reason: string };

const MAX_TASKS = 30;

export const PRIORITIZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['picks'],
  properties: {
    picks: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['task', 'reason'],
        properties: {
          task: { type: 'string' },
          reason: { type: 'string', maxLength: 160 },
        },
      },
    },
  },
} as const;

export function buildPrioritizeRequest(tasks: readonly MyTask[], now: Date) {
  const ordered = mySections(tasks, now)
    .filter((s) => s.key !== 'review') // handed in: nothing for me to do now
    .flatMap((s) => s.items.map((t) => ({ t, section: s.key })))
    .slice(0, MAX_TASKS);
  const refs = new Map(ordered.map(({ t }, i) => [`T${i + 1}`, t.id]));
  const system = [
    'คุณช่วยคนทำงานตัดสินใจว่าควรทำงานไหนก่อน จากรายการงานของเขาเอง',
    'เลือกได้ไม่เกิน 3 งาน (ใช้รหัสเช่น T3) พร้อมเหตุผลภาษาไทยสั้น ๆ ที่คนอ่านเข้าใจ',
    'คำนึงถึง: เลยกำหนด ใกล้กำหนด งานที่ถูกส่งกลับให้แก้ งานที่ติดปัญหา (อาจต้องไปตามคนอื่นก่อน)',
    'ห้ามใช้รหัสที่ไม่มีในรายการ ตอบเป็น JSON ตามโครงสร้างที่กำหนดเท่านั้น',
  ].join('\n');
  const user = JSON.stringify({
    tasks: ordered.map(({ t, section }, i) => ({
      ref: `T${i + 1}`,
      title: t.title,
      section: MY_SECTION_TITLES[section],
      due: t.dueAt ? formatDeadline(t.dueAt, { now }) : 'ไม่มีกำหนด',
      blocked: t.status === 'blocked',
      group: t.groupName ?? 'ส่วนตัว',
    })),
  });
  return { system, user, refs, count: ordered.length };
}

export function parsePrioritizeResponse(data: unknown, refs: Map<string, string>): Suggestion[] | null {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { picks?: unknown }).picks)) return null;
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const raw of (data as { picks: unknown[] }).picks.slice(0, 3)) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const taskId = typeof p.task === 'string' ? refs.get(p.task.trim()) : undefined;
    const reason = typeof p.reason === 'string' ? p.reason.trim().slice(0, 160) : '';
    if (!taskId || !reason || seen.has(taskId)) continue;
    seen.add(taskId);
    out.push({ taskId, reason });
  }
  return out;
}

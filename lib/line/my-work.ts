/**
 * "@ทันงาน งานของฉัน" — what is on my plate, asked from LINE (2026-10-09).
 *
 * Answered with the reply token, so it costs nothing against the quota however
 * often it is asked. Recognised only when the whole message is the question:
 * "@ทันงาน งานของฉันคือส่งรายงานพรุ่งนี้" is still a task to draft.
 *
 * In a group the answer lists only that group's workspace — the group can see
 * those tasks anyway. In a private chat with the bot it lists every workspace.
 * Pure: the database part is lib/tasks/my-work.ts.
 */
import { formatDeadline, relativeDeadline, dayBucket } from '../deadline.ts';

const BOT = /@ทันงาน|@tungan/gi;
// Particles and punctuation people add around a question.
const TAIL = /(ครับ|คับ|ค่ะ|คะ|นะ|จ้า|จ้ะ|หน่อย|บ้าง|มั้ย|ไหม|\?|？|!|\.|…)+$/u;

// The whole message, spaces and particles removed, must be one of these.
const ME = '(ฉัน|ผม|หนู|เรา|กู|เค้า|เขา)';
const ASK = new RegExp(
  '^(' +
    [
      `งาน(ของ)?${ME}?(มี)?(อะไร)?(บ้าง)?`, // งานของฉัน, งานฉันมีอะไร
      `${ME}?มีงานอะไร(ต้องทำ)?`, // มีงานอะไร, ผมมีงานอะไรต้องทำ
      'งานอะไร',
      `งานค้าง(ของ${ME})?`,
      'งานที่ต้องทำ',
      `(วันนี้)?(${ME})?ต้องทำอะไร`,
      'งานวันนี้',
      `เช็[คก]งาน(ของ${ME})?`,
      `ดูงาน(ของ${ME})?`,
      `สรุปงาน(ของ${ME})?`,
      'my(tasks?|work|todo)',
      'tasks?',
      'todo',
      'whatsonmyplate',
    ].join('|') +
    ')$',
  'u',
);

/** Is this whole message asking for my tasks? */
export function isMyWorkRequest(text: string): boolean {
  let value = (text ?? '').replace(BOT, ' ').trim().toLowerCase();
  if (!value) return false;
  value = value.replace(/['’]/g, '').replace(/\s+/g, '');
  for (let i = 0; i < 3; i += 1) value = value.replace(TAIL, '');
  return ASK.test(value);
}

export type MyWorkItem = {
  id: string;
  title: string;
  dueAt: Date | null;
  status: string;
  workspaceName: string;
  /** mine: assigned to me; handoff: waiting for me to accept; review: I asked
   *  for it and it has been handed in to me. */
  role: 'mine' | 'handoff' | 'review';
};

export type MyWorkSection = {
  key: 'overdue' | 'today' | 'handoff' | 'review' | 'soon';
  title: string;
  items: MyWorkItem[];
};

export type MyWork = {
  sections: MyWorkSection[];
  /** Mine, open, and further off than a week or with no deadline. */
  later: number;
  /** Mine and handed in, waiting for someone else to check. */
  submitted: number;
  total: number;
};

const WEEK = 7 * 86400000;

export function summarizeMyWork(items: MyWorkItem[], now: Date): MyWork {
  const by = (a: MyWorkItem, b: MyWorkItem) =>
    (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity);
  const mine = items.filter((i) => i.role === 'mine' && i.status !== 'done');
  const open = mine.filter((i) => i.status !== 'review');
  const overdue = open.filter((i) => i.dueAt && i.dueAt.getTime() < now.getTime());
  const today = open.filter((i) => !overdue.includes(i) && dayBucket(i.dueAt, now) === 'today');
  const soon = open.filter(
    (i) => !overdue.includes(i) && !today.includes(i) && i.dueAt && i.dueAt.getTime() - now.getTime() <= WEEK,
  );
  const later = open.length - overdue.length - today.length - soon.length;
  const sections: MyWorkSection[] = [
    { key: 'overdue', title: 'เลยกำหนด', items: overdue.sort(by) },
    { key: 'today', title: 'วันนี้', items: today.sort(by) },
    { key: 'handoff', title: 'รอคุณรับ', items: items.filter((i) => i.role === 'handoff').sort(by) },
    { key: 'review', title: 'รอคุณตรวจ', items: items.filter((i) => i.role === 'review').sort(by) },
    { key: 'soon', title: '7 วันข้างหน้า', items: soon.sort(by) },
  ].filter((s) => s.items.length > 0) as MyWorkSection[];
  return {
    sections,
    later,
    submitted: mine.length - open.length,
    total: sections.reduce((n, s) => n + s.items.length, 0) + later,
  };
}

/** The card shows this many rows at most; the rest are counted. */
export const MY_WORK_ROWS = 10;

const INK = '#090909';
const INK_3 = '#5D5D57';
const RED = '#C4241F';
const HAIRLINE = '#09090914';

/** Plain text, for the notification preview and anything that cannot show a card. */
export function myWorkText(work: MyWork): string {
  if (!work.total && !work.submitted) return 'ไม่มีงานค้าง · ว่างแล้ว';
  const lines = [`งานของคุณ ${work.total} งาน`];
  for (const s of work.sections) {
    lines.push(`${s.title} ${s.items.length}: ${s.items.slice(0, 3).map((i) => i.title).join(', ')}`);
  }
  return lines.join(' · ').slice(0, 380);
}

export function myWorkMessage(
  work: MyWork,
  ctx: {
    now: Date;
    /** Shown top right: the group's workspace, or ทุกพื้นที่งาน in a 1:1 chat. */
    scope: string;
    /** In a 1:1 chat tasks come from several workspaces: say which. */
    showWorkspace: boolean;
    appUrl: string;
    taskUrl: (id: string) => string;
  },
) {
  const { now } = ctx;
  const rows: Array<Record<string, unknown>> = [];
  let shown = 0;
  for (const section of work.sections) {
    if (shown >= MY_WORK_ROWS) break;
    rows.push({
      type: 'text',
      text: `${section.title} · ${section.items.length}`,
      size: 'xs',
      weight: 'bold',
      color: section.key === 'overdue' ? RED : INK_3,
      margin: rows.length ? 'lg' : 'none',
    });
    for (const item of section.items) {
      if (shown >= MY_WORK_ROWS) break;
      shown += 1;
      const when =
        section.key === 'review'
          ? `ส่งตรวจแล้ว${item.dueAt ? ` · กำหนด ${formatDeadline(item.dueAt, { now })}` : ''}`
          : item.dueAt
            ? `${relativeDeadline(item.dueAt, now)} · ${formatDeadline(item.dueAt, { now })}`
            : 'ไม่มีกำหนด';
      const url = ctx.taskUrl(item.id);
      rows.push({
        type: 'box',
        layout: 'vertical',
        margin: 'sm',
        paddingAll: '10px',
        cornerRadius: '12px',
        backgroundColor: '#FFFFFFB8',
        ...(url ? { action: { type: 'uri', label: 'เปิดงาน', uri: url } } : {}),
        contents: [
          { type: 'text', text: item.title, size: 'sm', weight: 'bold', color: INK, wrap: true, maxLines: 2 },
          {
            type: 'text',
            text: ctx.showWorkspace ? `${when} · ${item.workspaceName}` : when,
            size: 'xxs',
            color: section.key === 'overdue' ? RED : INK_3,
            wrap: true,
          },
        ],
      });
    }
  }
  const hidden = work.sections.reduce((n, s) => n + s.items.length, 0) - shown;
  const extra = [
    hidden > 0 ? `อีก ${hidden} งาน` : '',
    work.later ? `หลังจากนั้นหรือไม่มีกำหนด ${work.later} งาน` : '',
    work.submitted ? `ส่งแล้วรอตรวจ ${work.submitted} งาน` : '',
  ].filter(Boolean);

  const empty = !work.total;
  const contents: Array<Record<string, unknown>> = [
    {
      type: 'box',
      layout: 'horizontal',
      alignItems: 'center',
      contents: [
        { type: 'text', text: 'ทันงาน', size: 'sm', weight: 'bold', color: INK, flex: 0 },
        { type: 'text', text: ctx.scope, size: 'xxs', color: INK_3, align: 'end' },
      ],
    },
    {
      type: 'text',
      text: empty ? 'ไม่มีงานค้าง' : `งานของคุณ ${work.total} งาน`,
      size: 'xl',
      color: INK,
      wrap: true,
    },
    ...(empty
      ? [{ type: 'text', text: 'ว่างแล้ว ไม่มีอะไรรอคุณอยู่', size: 'sm', color: INK_3, wrap: true }]
      : rows),
    ...(extra.length
      ? [{ type: 'separator', color: HAIRLINE, margin: 'lg' }, { type: 'text', text: extra.join(' · '), size: 'xs', color: INK_3, wrap: true, margin: 'md' }]
      : []),
    ...(ctx.appUrl
      ? [{
          type: 'button',
          style: 'primary',
          color: INK,
          height: 'sm',
          margin: 'lg',
          action: { type: 'uri', label: 'เปิดในแอป', uri: ctx.appUrl },
        }]
      : []),
  ];

  return {
    type: 'flex',
    altText: myWorkText(work),
    contents: {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '20px',
        background: {
          type: 'linearGradient',
          angle: '150deg',
          startColor: '#FFE1D8',
          centerColor: '#F6F2FB',
          endColor: '#D9E6FF',
          centerPosition: '45%',
        },
        contents,
      },
    },
  };
}

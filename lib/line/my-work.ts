/**
 * "งานฉัน" asked from LINE (2026-10-09, reworked 2026-10-17).
 *
 * Answered with the reply token, so it costs nothing against the quota however
 * often it is asked. Recognised only when the whole message is the question:
 * "@ทันงาน งานของฉันคือส่งรายงานพรุ่งนี้" is still a task to draft.
 *
 * In a private chat: the 5 most urgent tasks, in งานฉัน's own section order
 * (lib/tasks/my-tasks.ts), and a button to the full page. In a group: ONLY a
 * short line and the button — someone's tasks are never listed in a group.
 * Pure: the database part is lib/tasks/my-work.ts.
 */
import { formatDeadline, relativeDeadline } from '../deadline.ts';
import { MY_SECTION_TITLES, type MySectionKey, type MyTask } from '../tasks/my-tasks.ts';

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

const INK = '#090909';
const INK_3 = '#5D5D57';
const RED = '#C4241F';
const HAIRLINE = '#09090914';

const BACKGROUND = {
  type: 'linearGradient',
  angle: '150deg',
  startColor: '#FFE1D8',
  centerColor: '#F6F2FB',
  endColor: '#D9E6FF',
  centerPosition: '45%',
};

function openButton(appUrl: string, label: string) {
  return appUrl
    ? [{ type: 'button', style: 'primary', color: INK, height: 'sm', margin: 'lg', action: { type: 'uri', label, uri: appUrl } }]
    : [];
}

/**
 * Private chat: the most urgent of my tasks — at most 5 — and the way to the
 * whole งานฉัน page. `total` is every open task I have, for the count line.
 */
export function myTasksCard(
  urgent: Array<MyTask & { section: MySectionKey }>,
  ctx: { now: Date; total: number; appUrl: string; taskUrl: (id: string) => string },
) {
  const { now } = ctx;
  const rows = urgent.map((item) => {
    const late = item.section === 'overdue';
    const due = item.dueAt
      ? `${relativeDeadline(item.dueAt, now)} · ${formatDeadline(item.dueAt, { now })}`
      : 'ไม่มีกำหนด';
    const meta = [
      MY_SECTION_TITLES[item.section],
      item.section === 'review' ? null : due,
      item.groupName ?? 'ส่วนตัว',
      item.status === 'blocked' ? 'ติดปัญหา' : null,
    ].filter(Boolean).join(' · ');
    const url = ctx.taskUrl(item.id);
    return {
      type: 'box',
      layout: 'vertical',
      margin: 'sm',
      paddingAll: '10px',
      cornerRadius: '12px',
      backgroundColor: '#FFFFFFB8',
      ...(url ? { action: { type: 'uri', label: 'เปิดงาน', uri: url } } : {}),
      contents: [
        { type: 'text', text: item.title, size: 'sm', weight: 'bold', color: INK, wrap: true, maxLines: 2 },
        { type: 'text', text: meta, size: 'xxs', color: late || item.section === 'revision' ? RED : INK_3, wrap: true },
      ],
    };
  });
  const more = ctx.total - urgent.length;
  const empty = ctx.total === 0;
  return {
    type: 'flex',
    altText: empty
      ? 'ไม่มีงานค้าง'
      : `งานฉัน ${ctx.total} งาน: ${urgent.map((u) => u.title).join(', ')}`.slice(0, 380),
    contents: {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '20px',
        background: BACKGROUND,
        contents: [
          { type: 'text', text: 'ทันงาน · งานฉัน', size: 'xs', weight: 'bold', color: INK_3 },
          { type: 'text', text: empty ? 'ไม่มีงานค้าง' : `ด่วนที่สุด ${urgent.length} จาก ${ctx.total} งาน`, size: 'lg', color: INK, wrap: true },
          ...(empty ? [{ type: 'text', text: 'ว่างแล้ว ไม่มีอะไรรอคุณอยู่', size: 'sm', color: INK_3, wrap: true }] : rows),
          ...(more > 0
            ? [{ type: 'separator', color: HAIRLINE, margin: 'lg' }, { type: 'text', text: `อีก ${more} งานในงานฉัน`, size: 'xs', color: INK_3, margin: 'md' }]
            : []),
          ...openButton(ctx.appUrl, 'เปิดงานฉัน'),
        ],
      },
    },
  };
}

/**
 * In a group: a short line and the button — nothing about anyone's tasks.
 * The group is a broadcast; your list is yours.
 */
export function myTasksPointer(ctx: { appUrl: string }) {
  return {
    type: 'flex',
    altText: 'ดูงานของคุณได้ในงานฉัน',
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '16px',
        background: BACKGROUND,
        contents: [
          { type: 'text', text: 'งานของคุณดูได้ในงานฉัน', size: 'sm', weight: 'bold', color: INK, wrap: true },
          { type: 'text', text: 'ไม่แสดงรายการงานในกลุ่ม · เปิดแล้วเห็นเฉพาะคุณ', size: 'xxs', color: INK_3, wrap: true },
          ...openButton(ctx.appUrl, 'เปิดงานฉัน'),
        ],
      },
    },
  };
}

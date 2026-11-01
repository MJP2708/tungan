import { formatDeadline, PRODUCT_TIME_ZONE } from '../deadline.ts';

/**
 * The confirmation card, and the edits that can happen without leaving LINE.
 *
 * Sending someone into the app to fix a wrong date is where confirmations get
 * abandoned, so the two things most often wrong — the deadline and the
 * assignee — are correctable in the chat. All of it runs on the reply token,
 * so editing is free.
 */

export type ConfirmDraft = {
  id: string;
  title: string;
  dueAt: Date | null;
  dueSource: string | null;
  assigneeName: string | null;
  assigneeSource: string | null;
  /** Set in a 1:1 chat, where the workspace was chosen rather than implied. */
  workspaceName?: string | null;
  /** What just changed ("แก้กำหนดส่งแล้ว"), shown on its own line. It used
   *  to be glued onto the task name, which then read as part of the task. */
  notice?: string | null;
};

/** LINE shows at most 13 quick reply items. */
export const QUICK_REPLY_LIMIT = 13;

/** "พรุ่งนี้ 10 โมง → 2 ก.ย. 10:00" — the reading, next to what produced it. */
function derivation(source: string | null, resolved: string): string {
  return source ? `${source} → ${resolved}` : resolved;
}

export function confirmBody(draft: ConfirmDraft, now = new Date()): string {
  const due = draft.dueAt
    ? derivation(draft.dueSource, formatDeadline(draft.dueAt, { now }))
    : 'ยังไม่ระบุ · แตะ เปลี่ยนกำหนดส่ง';
  const who = draft.assigneeName
    ? derivation(draft.assigneeSource, draft.assigneeName)
    : 'ยังไม่ระบุ · แตะ เปลี่ยนผู้รับผิดชอบ';
  return [
    ...(draft.notice ? [`✓ ${draft.notice}`] : []),
    `งาน: ${draft.title}`,
    `ใคร: ${who}`,
    `เมื่อไหร่: ${due}`,
    ...(draft.workspaceName ? [`ที่: ${draft.workspaceName}`] : []),
  ].join('\n');
}

function isoLocal(at: Date, timeZone = PRODUCT_TIME_ZONE): string {
  // LINE's datetime picker wants local wall-clock, not UTC.
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at);
  return parts.replace(' ', 't').slice(0, 16);
}

/** The site's palette, as LINE Flex colours (#RRGGBBAA where see-through). */
const INK = '#090909';
const INK_3 = '#5D5D57';
const BLUE = '#0080FF';
const AMBER = '#B45309';

/** One fact on the card: a small label, the reading, and what produced it. */
function fact(label: string, value: string | null, source: string | null, missingHint: string) {
  return {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    contents: [
      { type: 'text', text: label, size: 'xs', color: INK_3 },
      value
        ? { type: 'text', text: value, size: 'md', weight: 'bold', color: INK, wrap: true }
        : { type: 'text', text: 'ยังไม่ระบุ', size: 'md', weight: 'bold', color: AMBER },
      value
        ? source
          ? { type: 'text', text: `อ่านจาก “${source}”`, size: 'xxs', color: INK_3, wrap: true }
          : null
        : { type: 'text', text: missingHint, size: 'xxs', color: INK_3, wrap: true },
    ].filter(Boolean),
  };
}

/**
 * The confirmation card, as a Flex Message in the app's look (2026-10-08):
 * a pastel gradient, a frosted panel for who and when, an ink primary button
 * and quieter glass ones. LINE draws it, so no blur and no custom fonts —
 * the gradient, the translucent white and the hierarchy carry the look.
 *
 * A datetime picker rather than asking someone to type a date: typing a date
 * on a phone keyboard, in a chat, is where people give up.
 *
 * A compact version shipped and was reverted the same day: too small to read.
 * LINE never lets a bot delete or edit a message it sent, so a used card stays
 * in the chat whatever its size; the follow-up reply is what changes.
 */
export function confirmBubble(draft: ConfirmDraft, now = new Date()) {
  // Suggest a time rather than opening the picker on nothing. A task with no
  // deadline gets no reminders and quietly dies, so "none" is not a safe
  // default to leave sitting there.
  const suggested = draft.dueAt ?? new Date(now.getTime() + 24 * 3600000);
  const due = draft.dueAt ? formatDeadline(draft.dueAt, { now }) : null;

  const panel: Array<Record<string, unknown>> = [
    fact('ใคร', draft.assigneeName, draft.assigneeSource, 'แตะ “เปลี่ยนคน” ด้านล่าง'),
    { type: 'separator', color: '#09090914' },
    fact('เมื่อไร', due, draft.dueSource, 'แตะ “เปลี่ยนเวลา” ด้านล่าง · ไม่มีกำหนดจะไม่มีการเตือน'),
  ];
  if (draft.workspaceName) {
    panel.push({ type: 'separator', color: '#09090914' });
    panel.push(fact('ที่', draft.workspaceName, null, ''));
  }

  const glassButton = (label: string, action: Record<string, unknown>) => ({
    type: 'button',
    style: 'secondary',
    color: '#FFFFFFCC',
    height: 'sm',
    flex: 1,
    action: { ...action, label },
  });

  const bubble = {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'lg',
      paddingAll: '20px',
      background: {
        type: 'linearGradient',
        angle: '150deg',
        startColor: '#FFE1D8',
        centerColor: '#F6F2FB',
        endColor: '#D9E6FF',
        centerPosition: '45%',
      },
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          alignItems: 'center',
          contents: [
            { type: 'text', text: 'ทันงาน', size: 'sm', weight: 'bold', color: INK, flex: 0 },
            {
              type: 'box',
              layout: 'vertical',
              width: '7px',
              height: '7px',
              cornerRadius: '4px',
              backgroundColor: BLUE,
              margin: 'xs',
              offsetTop: '3px',
              contents: [],
            },
            { type: 'text', text: 'ร่างงาน · รอยืนยัน', size: 'xxs', color: INK_3, align: 'end' },
          ],
        },
        ...(draft.notice
          ? [
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'box',
                    layout: 'vertical',
                    flex: 0,
                    backgroundColor: '#0080FF1F',
                    cornerRadius: '12px',
                    paddingTop: '4px',
                    paddingBottom: '4px',
                    paddingStart: '10px',
                    paddingEnd: '10px',
                    contents: [
                      { type: 'text', text: `✓ ${draft.notice}`, size: 'xs', weight: 'bold', color: BLUE },
                    ],
                  },
                ],
              },
            ]
          : []),
        {
          type: 'text',
          text: draft.title,
          size: 'xl',
          color: INK,
          wrap: true,
          maxLines: 4,
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '14px',
          cornerRadius: '16px',
          backgroundColor: '#FFFFFFB8',
          borderWidth: '1px',
          borderColor: '#FFFFFFE6',
          contents: panel,
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          margin: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: INK,
              height: 'md',
              action: {
                type: 'postback',
                label: 'ยืนยันสร้างงาน',
                data: `action=confirm&inbox=${draft.id}`,
                displayText: 'ยืนยันสร้างงาน',
              },
            },
            {
              type: 'box',
              layout: 'horizontal',
              spacing: 'sm',
              contents: [
                glassButton('เปลี่ยนเวลา', {
                  type: 'datetimepicker',
                  data: `action=setdue&inbox=${draft.id}`,
                  mode: 'datetime',
                  initial: isoLocal(suggested),
                  min: isoLocal(new Date(now.getTime() - 60 * 60000)),
                }),
                glassButton('เปลี่ยนคน', {
                  type: 'postback',
                  data: `action=pickassignee&inbox=${draft.id}`,
                  displayText: 'เปลี่ยนผู้รับผิดชอบ',
                }),
              ],
            },
            {
              type: 'button',
              style: 'link',
              color: INK_3,
              height: 'sm',
              action: {
                type: 'postback',
                label: 'ไม่ใช่งาน',
                data: `action=dismiss&inbox=${draft.id}`,
                displayText: 'ไม่ใช่งาน',
              },
            },
          ],
        },
      ],
    },
  };
  return bubble;
}

/** One draft, one card. */
export function confirmMessage(draft: ConfirmDraft, now = new Date()) {
  return {
    type: 'flex',
    altText: confirmBody(draft, now).replace(/\n/g, ' · ').slice(0, 380),
    contents: confirmBubble(draft, now),
  };
}

/**
 * Several drafts from one message: one card you swipe through, the height of
 * a single draft, instead of a tall stack of them down the chat.
 */
export function confirmCarousel(drafts: ConfirmDraft[], now = new Date()) {
  if (drafts.length === 1) return confirmMessage(drafts[0], now);
  return {
    type: 'flex',
    altText: `ร่างงาน ${drafts.length} รายการ: ${drafts.map((d) => d.title).join(' · ')}`.slice(0, 380),
    contents: {
      type: 'carousel',
      // LINE allows 12 bubbles in a carousel.
      contents: drafts.slice(0, 12).map((d) => confirmBubble(d, now)),
    },
  };
}

/** Every action on the card, in reading order — for tests and checks. */
export function cardActions(message: ReturnType<typeof confirmMessage>) {
  const found: Array<Record<string, unknown>> = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'button' && n.action) found.push(n.action as Record<string, unknown>);
    for (const value of Object.values(n)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  };
  walk(message.contents);
  return found;
}

/**
 * Choosing an assignee from the people we know in this group.
 *
 * Past the platform's quick-reply limit the list is not usable in a chat, so
 * it points at the app rather than silently showing a truncated set of people
 * and letting someone assign work to the wrong one.
 */
export function assigneePicker(
  draftId: string,
  members: Array<{ userId: string; name: string }>,
  appUrl: string,
) {
  if (!members.length) {
    return {
      type: 'text',
      text: 'ยังไม่รู้จักใครในกลุ่มนี้ ให้แต่ละคนพิมพ์อะไรก็ได้ในกลุ่มสักครั้ง แล้วลองใหม่',
    };
  }
  if (members.length > QUICK_REPLY_LIMIT) {
    return {
      type: 'text',
      text: `กลุ่มนี้มีสมาชิกมากกว่า ${QUICK_REPLY_LIMIT} คน เลือกผู้รับผิดชอบในแอปแทน\n${appUrl}`,
    };
  }
  return {
    type: 'text',
    text: 'ให้ใครรับผิดชอบงานนี้',
    quickReply: {
      items: members.map((m) => ({
        type: 'action',
        action: {
          type: 'postback',
          label: m.name.slice(0, 20),
          data: `action=setassignee&inbox=${draftId}&user=${m.userId}`,
          displayText: m.name,
        },
      })),
    },
  };
}

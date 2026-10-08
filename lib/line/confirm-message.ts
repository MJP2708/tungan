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

/** One line of the card: a short label, then the value (amber when missing). */
function factLine(label: string, value: string | null, missing: string) {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'xs', color: INK_3, flex: 0 },
      value
        ? { type: 'text', text: value, size: 'sm', weight: 'bold', color: INK, wrap: true, flex: 1 }
        : { type: 'text', text: missing, size: 'sm', weight: 'bold', color: AMBER, wrap: true, flex: 1 },
    ],
  };
}

/**
 * One draft as a compact bubble (2026-10-08). LINE never lets a bot delete
 * or edit a message it sent, so a card stays in the chat for good; the only
 * way to make it take less room is to make it small. Name, who, when, the
 * confirm button and one row of small buttons — about half the old height.
 * What a deadline was read from stays in the notification text (altText).
 */
export function confirmBubble(draft: ConfirmDraft, now = new Date()) {
  // Suggest a time rather than opening the picker on nothing. A task with no
  // deadline gets no reminders and quietly dies, so "none" is not a safe
  // default to leave sitting there.
  const suggested = draft.dueAt ?? new Date(now.getTime() + 24 * 3600000);
  const due = draft.dueAt ? formatDeadline(draft.dueAt, { now }) : null;
  const small = (label: string, action: Record<string, unknown>) => ({
    type: 'button',
    style: 'secondary',
    color: '#FFFFFFCC',
    height: 'sm',
    flex: 1,
    action: { ...action, label },
  });

  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '14px',
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
            {
              type: 'box',
              layout: 'vertical',
              width: '7px',
              height: '7px',
              cornerRadius: '4px',
              backgroundColor: BLUE,
              flex: 0,
              contents: [],
            },
            {
              type: 'text',
              text: draft.notice ? `✓ ${draft.notice}` : 'ร่างงาน · รอยืนยัน',
              size: 'xxs',
              color: draft.notice ? BLUE : INK_3,
              weight: draft.notice ? 'bold' : 'regular',
              margin: 'sm',
            },
          ],
        },
        { type: 'text', text: draft.title, size: 'md', weight: 'bold', color: INK, wrap: true, maxLines: 3 },
        factLine('ใคร', draft.assigneeName, 'ยังไม่ระบุ'),
        factLine('เมื่อไร', due, 'ยังไม่มีกำหนด'),
        ...(draft.workspaceName ? [factLine('ที่', draft.workspaceName, '')] : []),
        {
          type: 'button',
          style: 'primary',
          color: INK,
          height: 'sm',
          margin: 'md',
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
          spacing: 'xs',
          contents: [
            small('เวลา', {
              type: 'datetimepicker',
              data: `action=setdue&inbox=${draft.id}`,
              mode: 'datetime',
              initial: isoLocal(suggested),
              min: isoLocal(new Date(now.getTime() - 60 * 60000)),
            }),
            small('คน', {
              type: 'postback',
              data: `action=pickassignee&inbox=${draft.id}`,
              displayText: 'เปลี่ยนผู้รับผิดชอบ',
            }),
            small('ไม่ใช่งาน', {
              type: 'postback',
              data: `action=dismiss&inbox=${draft.id}`,
              displayText: 'ไม่ใช่งาน',
            }),
          ],
        },
      ],
    },
  };
}

/** One draft, one compact card. */
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

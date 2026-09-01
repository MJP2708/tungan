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
  return [`งาน: ${draft.title}`, `ใคร: ${who}`, `เมื่อไหร่: ${due}`].join('\n');
}

function isoLocal(at: Date, timeZone = PRODUCT_TIME_ZONE): string {
  // LINE's datetime picker wants local wall-clock, not UTC.
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at);
  return parts.replace(' ', 't').slice(0, 16);
}

/**
 * The confirmation message.
 *
 * A datetime picker rather than asking someone to type a date: typing a date
 * on a phone keyboard, in a chat, is where people give up.
 */
export function confirmMessage(draft: ConfirmDraft, now = new Date()) {
  const body = confirmBody(draft, now);
  // Suggest a time rather than opening the picker on nothing. A task with no
  // deadline gets no reminders and quietly dies, so "none" is not a safe
  // default to leave sitting there.
  const suggested = draft.dueAt ?? new Date(now.getTime() + 24 * 3600000);
  return {
    type: 'template',
    altText: body.replace(/\n/g, ' · ').slice(0, 380),
    template: {
      type: 'buttons',
      text: body.slice(0, 160),
      actions: [
        {
          type: 'postback',
          label: 'ยืนยันสร้างงาน',
          data: `action=confirm&inbox=${draft.id}`,
          displayText: 'ยืนยันสร้างงาน',
        },
        {
          type: 'datetimepicker',
          label: 'เปลี่ยนกำหนดส่ง',
          data: `action=setdue&inbox=${draft.id}`,
          mode: 'datetime',
          initial: isoLocal(suggested),
          min: isoLocal(new Date(now.getTime() - 60 * 60000)),
        },
        {
          type: 'postback',
          label: 'เปลี่ยนผู้รับผิดชอบ',
          data: `action=pickassignee&inbox=${draft.id}`,
          displayText: 'เปลี่ยนผู้รับผิดชอบ',
        },
        {
          type: 'postback',
          label: 'ไม่ใช่งาน',
          data: `action=dismiss&inbox=${draft.id}`,
          displayText: 'ไม่ใช่งาน',
        },
      ],
    },
  };
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

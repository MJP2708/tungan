import { BLOCKED_REASONS } from '../tasks/reasons.ts';

/**
 * The five worker actions, as buttons inside LINE.
 *
 * Quick replies rather than a template: they sit above the keyboard, work the
 * same in a group and a DM, and every one of them is answered with the reply
 * token — so handling a whole day's work from inside chat costs nothing
 * against the monthly message quota.
 *
 * LINE allows 13 quick-reply items and 300 bytes of postback data. Five
 * actions and a task id fit with room to spare.
 */

/** LINE's own limit. Exceeding it silently drops the extras. */
export const QUICK_REPLY_LIMIT = 13;

export type QuickAction = { type: 'action'; action: Record<string, unknown> };

function postback(label: string, data: string, displayText: string): QuickAction {
  return {
    type: 'action',
    action: {
      type: 'postback',
      // LINE truncates past 20 characters; do it here so the label is chosen
      // rather than cut mid-word by the client.
      label: label.slice(0, 20),
      data,
      // What the tap looks like in the chat transcript afterwards. Without it
      // the conversation shows a reply to nothing.
      displayText,
    },
  };
}

/**
 * What this person can do to this task right now.
 *
 * Deliberately state-aware. Offering รับงาน on a task already accepted, or
 * เสร็จแล้ว on one already waiting for review, trains people that the buttons
 * are decorative.
 */
export function statusActions(task: {
  id: string;
  status: string;
  acceptedAt: Date | null;
  pendingAssigneeUserId?: string | null;
}, viewerUserId?: string): QuickAction[] {
  const t = `task=${encodeURIComponent(task.id)}`;
  const items: QuickAction[] = [];

  // Answering a handoff offer replaces everything else: until they accept, the
  // task is not theirs to act on.
  if (task.pendingAssigneeUserId && task.pendingAssigneeUserId === viewerUserId) {
    return [
      postback('รับงานที่ส่งต่อ', `action=status&${t}&do=accept_handoff`, 'รับงานที่ส่งต่อมา'),
      postback('ปฏิเสธ', `action=status&${t}&do=decline_handoff`, 'ปฏิเสธงานที่ส่งต่อ'),
    ];
  }

  if (task.status === 'done') return [];
  // Already handed in. The only honest thing to show is that it is waiting.
  if (task.status === 'review') return [];

  if (!task.acceptedAt) {
    items.push(postback('รับงาน', `action=status&${t}&do=accept`, 'รับงาน'));
  }
  items.push(postback('ขอข้อมูลเพิ่ม', `action=status&${t}&do=info`, 'ขอข้อมูลเพิ่ม'));
  items.push(postback('ติดปัญหา', `action=status&${t}&do=blocked`, 'ติดปัญหา'));
  items.push(postback('ส่งต่อ', `action=status&${t}&do=handoff`, 'ส่งต่อ'));
  items.push(postback('เสร็จแล้ว', `action=status&${t}&do=submit`, 'เสร็จแล้ว'));
  return items.slice(0, QUICK_REPLY_LIMIT);
}

/** Attach actions to a message, or send it plain when there are none. */
export function withActions(text: string, items: QuickAction[]) {
  const message: Record<string, unknown> = { type: 'text', text };
  if (items.length) message.quickReply = { items };
  return message;
}

/**
 * The preset reasons, as one tap each.
 *
 * ติดปัญหา and ขอข้อมูลเพิ่ม both need to say what is wanted, but requiring
 * prose is how a mandatory field turns into "-" and stops meaning anything.
 * A preset is countable, sortable, and free to answer.
 */
export function reasonPrompt(taskId: string, action: 'info' | 'blocked') {
  const t = `task=${encodeURIComponent(taskId)}`;
  return {
    type: 'text',
    text:
      action === 'blocked'
        ? 'ติดเพราะอะไร\n(บันทึกนี้เห็นเฉพาะคุณกับหัวหน้า · งานจะขึ้นว่าติดปัญหา แต่ไม่บอกเหตุผล)'
        : 'ต้องการข้อมูลอะไร\n(บันทึกนี้เห็นเฉพาะคุณกับหัวหน้า)',
    quickReply: {
      items: BLOCKED_REASONS.map((reason) =>
        postback(reason, `action=status&${t}&do=${action}&reason=${encodeURIComponent(reason)}`, reason),
      ),
    },
  };
}

/**
 * Who to hand it to.
 *
 * Only people the bot has actually seen. Past the quick-reply limit this
 * points at the app rather than showing a truncated list and letting someone
 * hand work to the wrong person.
 */
export function handoffPicker(
  taskId: string,
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
    return { type: 'text', text: `สมาชิกมากกว่า ${QUICK_REPLY_LIMIT} คน เลือกผู้รับในแอปแทน\n${appUrl}` };
  }
  const t = `task=${encodeURIComponent(taskId)}`;
  return {
    type: 'text',
    text: 'ส่งต่อให้ใคร\n(งานยังอยู่กับคุณจนกว่าอีกฝ่ายจะกดรับ)',
    quickReply: {
      items: members.map((m) =>
        postback(m.name, `action=status&${t}&do=handoff&user=${encodeURIComponent(m.userId)}`, `ส่งต่อให้ ${m.name}`),
      ),
    },
  };
}

/**
 * เสร็จแล้ว on a task with no proof attached.
 *
 * Proof is the point of the review step, so the ask comes first — but a
 * refusal that cannot be answered from inside LINE would make the button a
 * dead end. Handing in without a link stays possible and is recorded as such,
 * so the reviewer sees the gap rather than the submission looking complete.
 */
export function evidencePrompt(taskId: string, appUrl: string) {
  const t = `task=${encodeURIComponent(taskId)}`;
  return {
    type: 'text',
    text: 'ยังไม่มีลิงก์หลักฐาน\nแนบในแอปได้ หรือส่งตรวจไปเลยก็ได้',
    quickReply: {
      items: [
        postback('ส่งโดยไม่มีลิงก์', `action=status&${t}&do=submit&nolink=1`, 'ส่งตรวจโดยไม่มีลิงก์'),
        {
          type: 'action',
          action: { type: 'uri', label: 'แนบลิงก์ในแอป', uri: `${appUrl}` },
        },
      ],
    },
  };
}

/** Undo, offered for 30 seconds after any of the five. */
export function undoAction(taskId: string, eventId: string): QuickAction {
  return postback(
    'ยกเลิก',
    `action=statusundo&task=${encodeURIComponent(taskId)}&event=${encodeURIComponent(eventId)}`,
    'ยกเลิกการเปลี่ยนสถานะ',
  );
}

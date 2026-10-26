import type { JevAnswers } from './jev.ts';
import { jevRequest, readJev, type JevRequest } from './jev-questions.ts';
import { mergeReadings, needsModel, peopleNamed, shouldAskModel, type Member, type ModelTask, type RulesReading } from './read-message.ts';
import { formatDeadline } from '../deadline.ts';

/**
 * Who reads a tagged message, in what order (2026-10-26). Pure: the two
 * models come in as functions, so the webhook and tools/ml/eval.ts run the
 * very same decisions.
 *
 *   1. The rules (free). Most messages stop here: shouldAskModel() is false.
 *   2. Jev, when one draft is missing its person or its day: is it a task,
 *      who, which day. Cheap and fast. "Not a task" stops here.
 *   3. The writing model, only when words are needed — a paragraph to turn
 *      into a title, several people to split into several tasks — or when
 *      Jev was not there or left the draft unread.
 *
 * What the rules read always stays; each later reader only fills gaps.
 * Nothing is created: a person confirms every draft, and a "not a task"
 * draft is kept and marked, never removed.
 */

export type Source = 'rules' | 'jev' | 'model' | null;

export type RoutedDraft = RulesReading & {
  assigneeFrom: Source;
  dueFrom: Source;
  /** Why the AI read it so, for the person confirming. */
  reason: string | null;
  /** What the AI read, kept beside the rules' reading for training. */
  reading: { title: string; assigneeUserId: string | null; dueAt: string | null } | null;
};

export type Routed = {
  drafts: RoutedDraft[];
  /** An AI read it as not a task. */
  notATask: boolean;
  /** One line for the card, or null when no AI was involved. */
  notice: string | null;
  asked: { jev: boolean; model: boolean };
};

export async function routeReading(
  input: {
    text: string;
    members: Member[];
    senderUserId?: string | null;
    drafts: RulesReading[];
    now: Date;
    cutoff: string;
  },
  deps: {
    jev?: (request: JevRequest) => Promise<JevAnswers | null>;
    write?: () => Promise<ModelTask[] | null>;
  },
): Promise<Routed> {
  const asked = { jev: false, model: false };
  let drafts: RoutedDraft[] = input.drafts.map((d) => ({
    ...d,
    assigneeFrom: d.assigneeUserId ? 'rules' : null,
    dueFrom: d.dueAt ? 'rules' : null,
    reason: null,
    reading: null,
  }));
  const done = (notATask: boolean): Routed => ({
    drafts,
    notATask,
    notice: notATask
      ? 'AI: อาจไม่ใช่งาน'
      : drafts.some((d) => d.reading) ? 'AI ช่วยอ่าน · ตรวจก่อนยืนยัน' : null,
    asked,
  });
  if (!shouldAskModel(input.drafts, input.text, input.members)) return done(false);

  const several = peopleNamed(input.text, input.members) >= 2;
  const paragraph = input.drafts.some((d) => d.title.length > 60);
  let jevSaysTask = false;

  // 2. Jev: one draft, one person at most, something missing.
  const one = drafts.length === 1 ? drafts[0] : null;
  if (deps.jev && one && !several && (!one.assigneeUserId || !one.dueAt)) {
    const need = { assignee: !one.assigneeUserId, deadline: !one.dueAt };
    const request = jevRequest({ text: input.text, members: input.members, senderUserId: input.senderUserId, need });
    asked.jev = true;
    const answers = await deps.jev(request);
    if (answers) {
      const read = readJev(answers, { people: request.people, need, now: input.now, cutoff: input.cutoff });
      if (read.isTask === 'no') {
        drafts = [{ ...one, reason: 'AI อ่านแล้วไม่พบงานในข้อความนี้ · ถ้าไม่ใช่งาน กด ไม่ใช่งาน' }];
        return done(true);
      }
      jevSaysTask = read.isTask === 'yes';
      if (read.assigneeUserId || read.dueAt) {
        const filled: RoutedDraft = {
          ...one,
          assigneeUserId: one.assigneeUserId ?? read.assigneeUserId,
          assigneeFrom: one.assigneeUserId ? one.assigneeFrom : read.assigneeUserId ? 'jev' : null,
          dueAt: one.dueAt ?? read.dueAt,
          dueFrom: one.dueAt ? one.dueFrom : read.dueAt ? 'jev' : null,
        };
        const parts = [
          read.assigneeUserId && !one.assigneeUserId
            ? `ให้ ${input.members.find((m) => m.userId === read.assigneeUserId)?.names[0] ?? 'สมาชิก'}`
            : '',
          read.dueAt && !one.dueAt ? `เสร็จ ${formatDeadline(read.dueAt, { now: input.now })}` : '',
        ].filter(Boolean);
        filled.reason = `AI อ่านว่า ${parts.join(' · ')}`;
        filled.reading = {
          title: filled.title,
          assigneeUserId: filled.assigneeUserId,
          dueAt: filled.dueAt ? filled.dueAt.toISOString() : null,
        };
        drafts = [filled];
      }
    }
  }

  // 3. The writing model: words needed, or still unread.
  const stillUnread = drafts.some((d) => needsModel(d));
  if (deps.write && (paragraph || several || stillUnread)) {
    asked.model = true;
    const tasks = await deps.write();
    if (tasks && tasks.length === 0) {
      // Not a task, unless Jev was sure it was.
      if (!jevSaysTask) {
        drafts = drafts.map((d) => ({ ...d, reason: 'AI อ่านแล้วไม่พบงานในข้อความนี้ · ถ้าไม่ใช่งาน กด ไม่ใช่งาน' }));
        return done(true);
      }
    } else if (tasks) {
      const merged = mergeReadings(drafts, tasks);
      drafts = merged.map((m, i) => {
        const base = drafts[i] ?? drafts[0];
        const keptPerson = base.assigneeUserId && m.assigneeUserId === base.assigneeUserId;
        const keptDue = base.dueAt && m.dueAt === base.dueAt;
        return {
          title: m.title,
          assigneeUserId: m.assigneeUserId,
          dueAt: m.dueAt,
          assigneeFrom: keptPerson ? base.assigneeFrom : m.assigneeUserId ? 'model' : null,
          dueFrom: keptDue ? base.dueFrom : m.dueAt ? 'model' : null,
          reason: m.reason ?? base.reason,
          reading: m.fromModel
            ? { title: m.title, assigneeUserId: m.assigneeUserId, dueAt: m.dueAt ? m.dueAt.toISOString() : null }
            : base.reading,
        };
      });
    }
  }
  return done(false);
}

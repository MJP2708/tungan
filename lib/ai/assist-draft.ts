import 'server-only';
import { fromZonedWallClock, quickDayDate } from '../deadline.ts';
import { askJev } from './jev.ts';
import { questionsFor, readAnswers, type AssistMember } from './read-message.ts';
import { refundAiRead, spendAiRead } from './allowance.ts';

/**
 * Ask Jev about one message, but only when the rules came up short.
 *
 * The order matters: the read is charged first, then the model is called.
 * Charging afterwards would mean a dropped connection is a free read.
 * If no answer arrives, the charge is given back.
 *
 * `sourceId` is the LINE message id, so a redelivery of the same message —
 * which LINE does on its own — is never charged twice.
 *
 * Returns null whenever AI is off, out of allowance, or unsure. Every caller
 * must carry on with what the rules produced; nothing here decides anything
 * on its own, and the person still confirms the card.
 */
export type DraftAssist = {
  assigneeUserId: string | null;
  dueAt: Date | null;
  /** Shown on the confirmation card, so the reading is never passed off as
   *  something the message plainly said. */
  source: string;
};

export async function assistDraft(params: {
  workspaceId: string;
  sourceId: string;
  text: string;
  members: AssistMember[];
  needAssignee: boolean;
  needDueDate: boolean;
  cutoff: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<DraftAssist | null> {
  if (!params.needAssignee && !params.needDueDate) return null;

  const questions = questionsFor({
    needAssignee: params.needAssignee,
    needDueDate: params.needDueDate,
    members: params.members,
  });
  // Only the "is this a task" question left: nothing it could tell us.
  if (Object.keys(questions).length < 2) return null;

  const spend = await spendAiRead({ workspaceId: params.workspaceId, sourceId: params.sourceId });
  if (spend === 'off' || spend === 'over_daily' || spend === 'over_allowance') return null;

  const answers = await askJev({ state: params.text, questions }, { fetchImpl: params.fetchImpl });
  if (!answers) {
    // Nothing came back, so nothing was read. Only give back a charge this
    // call made: 'already' means an earlier read is what paid for it.
    if (spend === 'ok') await refundAiRead(params.workspaceId, params.sourceId);
    return null;
  }

  const reading = readAnswers(answers, params.members);
  if (!reading.looksLikeTask) return null;
  if (!reading.assigneeUserId && !reading.dueDay) return null;

  const now = params.now ?? new Date();
  let dueAt: Date | null = null;
  if (reading.dueDay) {
    // The model names a DAY; the time of day comes from the workspace's own
    // end-of-day, through the same rules every other deadline uses.
    const [hour, minute] = params.cutoff.split(':').map(Number);
    const d = quickDayDate(reading.dueDay, { now, endOfDay: params.cutoff });
    dueAt = fromZonedWallClock(d.year, d.month, d.day, hour || 17, minute || 0);
  }

  return {
    assigneeUserId: params.needAssignee ? reading.assigneeUserId : null,
    dueAt: params.needDueDate ? dueAt : null,
    source: 'AI ช่วยอ่าน',
  };
}

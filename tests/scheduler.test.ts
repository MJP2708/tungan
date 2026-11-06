// P1-3 (2026-11-06): a scheduler that stops must reach a person.
import test from 'node:test';
import assert from 'node:assert/strict';
import { schedulerHealth, schedulerOf } from '../lib/reminders/scheduler.ts';

const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });
const now = new Date('2026-11-06T06:00:00Z'); // 13:00 Bangkok
const minutes = (m: number) => new Date(now.getTime() - m * 60_000);
const at13 = 13 * 60;

test('who is calling: GitHub says so, Vercel by its agent, anything else is cron-job.org', () => {
  assert.equal(schedulerOf(headers({ 'x-scheduler': 'github' })), 'github');
  assert.equal(schedulerOf(headers({ 'user-agent': 'vercel-cron/1.0' })), 'vercel');
  assert.equal(schedulerOf(headers({ 'user-agent': 'Mozilla/4.0 (compatible; cron-job.org)' })), 'primary');
});

test('the primary is silent after 90 quiet minutes inside its window, not outside it', () => {
  const base = { now, remindersLastSentAt: minutes(5), overdueReminders: 0 };
  assert.equal(schedulerHealth({ ...base, bangkokMinutes: at13, primaryLastSeenAt: minutes(15) }).primarySilent, false);
  assert.equal(schedulerHealth({ ...base, bangkokMinutes: at13, primaryLastSeenAt: minutes(120) }).primarySilent, true);
  assert.equal(schedulerHealth({ ...base, bangkokMinutes: at13, primaryLastSeenAt: null }).primarySilent, true);
  // 08:30: the primary only started at 08:00, so 90 minutes have not passed.
  assert.equal(schedulerHealth({ ...base, bangkokMinutes: 8 * 60 + 30, primaryLastSeenAt: null }).primarySilent, false);
  // 23:00: outside its window, quiet is expected.
  assert.equal(schedulerHealth({ ...base, bangkokMinutes: 23 * 60, primaryLastSeenAt: minutes(300) }).primarySilent, false);
});

test('stale means reminders are overdue AND nothing went out for a day', () => {
  const base = { now, bangkokMinutes: at13, primaryLastSeenAt: minutes(10) };
  assert.equal(schedulerHealth({ ...base, remindersLastSentAt: minutes(27 * 60), overdueReminders: 3 }).stale, true);
  assert.equal(schedulerHealth({ ...base, remindersLastSentAt: minutes(27 * 60), overdueReminders: 0 }).stale, false, 'a quiet week is not stale');
  assert.equal(schedulerHealth({ ...base, remindersLastSentAt: minutes(60), overdueReminders: 3 }).stale, false);
  assert.equal(schedulerHealth({ ...base, remindersLastSentAt: null, overdueReminders: 1 }).stale, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_CHOICES,
  MIN_CONFIDENCE,
  questionsFor,
  readAnswers,
} from '../lib/ai/read-message.ts';

/**
 * What we ask Jev, and what we refuse to believe.
 *
 * The model is a fallback for things the rules could not decide, and every
 * answer still goes on a card a person confirms. These pin the two ways it
 * could do harm anyway: suggesting somebody who is not in the team, and
 * sounding certain when it is not.
 */

const members = [
  { userId: 'u-may', name: 'เมย์' },
  { userId: 'u-tony', name: 'โทนี่' },
];

test('only asks about what the rules could not decide', () => {
  const both = questionsFor({ needAssignee: true, needDueDate: true, members });
  assert.deepEqual(Object.keys(both).sort(), ['assignee', 'due_day', 'is_task']);

  const onlyDate = questionsFor({ needAssignee: false, needDueDate: true, members });
  assert.deepEqual(Object.keys(onlyDate).sort(), ['due_day', 'is_task']);

  // Nobody known yet: asking who it is for cannot produce a usable answer.
  const noMembers = questionsFor({ needAssignee: true, needDueDate: false, members: [] });
  assert.deepEqual(Object.keys(noMembers), ['is_task']);
});

test('the assignee question always offers "nobody named"', () => {
  const { assignee } = questionsFor({ needAssignee: true, needDueDate: false, members });
  assert.ok(assignee && assignee.type === 'choice');
  assert.ok('unknown' in assignee.criteria, 'it must be able to decline');
  assert.deepEqual(Object.keys(assignee.criteria).sort(), ['u-may', 'u-tony', 'unknown']);
});

test('a confident reading is used', () => {
  const reading = readAnswers(
    {
      is_task: { type: 'noul', noul: 0.92 },
      assignee: { type: 'choice', choice: 'u-may', confidence: 0.81 },
      due_day: { type: 'choice', choice: 'tomorrow', confidence: 0.77 },
    },
    members,
  );
  assert.deepEqual(reading, { looksLikeTask: true, assigneeUserId: 'u-may', dueDay: 'tomorrow' });
});

test('an unsure answer is dropped, and the rules keep their result', () => {
  const reading = readAnswers(
    {
      is_task: { type: 'noul', noul: 0.95 },
      assignee: { type: 'choice', choice: 'u-tony', confidence: MIN_CONFIDENCE - 0.01 },
      due_day: { type: 'choice', choice: 'today' }, // no confidence reported
    },
    members,
  );
  assert.equal(reading.assigneeUserId, null);
  assert.equal(reading.dueDay, null);
});

test('a person who is not in this workspace is never suggested', () => {
  const reading = readAnswers(
    {
      is_task: { type: 'noul', noul: 0.99 },
      assignee: { type: 'choice', choice: 'u-somebody-else', confidence: 0.99 },
    },
    members,
  );
  assert.equal(reading.assigneeUserId, null);
});

test('chat that is not a request suggests nothing at all', () => {
  const reading = readAnswers(
    {
      is_task: { type: 'noul', noul: 0.2 },
      assignee: { type: 'choice', choice: 'u-may', confidence: 0.99 },
      due_day: { type: 'choice', choice: 'today', confidence: 0.99 },
    },
    members,
  );
  assert.deepEqual(reading, { looksLikeTask: false, assigneeUserId: null, dueDay: null });
});

test('no answer at all is the same as no opinion', () => {
  assert.deepEqual(readAnswers(null, members), {
    looksLikeTask: false,
    assigneeUserId: null,
    dueDay: null,
  });
});

test('"unknown" is an answer, not a day', () => {
  const reading = readAnswers(
    {
      is_task: { type: 'noul', noul: 0.9 },
      due_day: { type: 'choice', choice: 'unknown', confidence: 0.95 },
    },
    members,
  );
  assert.equal(reading.dueDay, null);
  assert.ok('unknown' in DAY_CHOICES);
});

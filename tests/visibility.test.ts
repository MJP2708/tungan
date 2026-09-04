import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  readableLevels,
  filterByAudience,
  canReadPrivate,
  audienceForViewer,
  defaultVisibilityFor,
  normalizeVisibility,
  audienceLabel,
  VISIBILITY_LEVELS,
} from '../lib/events/visibility.ts';

/**
 * A private ติดปัญหา note must not reach the group or the client.
 *
 * That is the whole promise the default makes, and it is the reason anyone
 * writes an honest one. These tests hold it from two directions: the rules
 * themselves, and the structural check that no route can go around them.
 */

const NOTE = {
  id: 'e1',
  kind: 'blocked',
  detail: 'ติดปัญหา: รอลูกค้า · ลูกค้ายังไม่ส่งไฟล์ต้นฉบับมาสามวันแล้ว',
  visibility: 'private',
};
const PUBLIC_NOTE = { id: 'e2', kind: 'submitted', detail: 'ส่งงาน', visibility: 'workspace' };
const CLIENT_NOTE = { id: 'e3', kind: 'approved', detail: 'อนุมัติงาน', visibility: 'client' };
const ALL = [NOTE, PUBLIC_NOTE, CLIENT_NOTE];

test('a private note cannot reach the group reply', () => {
  const seen = filterByAudience(ALL, 'group');
  assert.equal(seen.some((e) => e.id === NOTE.id), false);
  assert.equal(readableLevels('group').includes('private'), false);
});

test('a private note cannot reach the client summary', () => {
  const seen = filterByAudience(ALL, 'client');
  assert.equal(seen.some((e) => e.id === NOTE.id), false);
  assert.deepEqual(seen.map((e) => e.id), [CLIENT_NOTE.id]);
  assert.equal(readableLevels('client').includes('private'), false);
});

test('only the private audience can read a private note', () => {
  // Stated over every audience so adding one forces a decision rather than
  // inheriting whatever the last branch happened to do.
  const audiences = ['client', 'group', 'workspace', 'private'] as const;
  for (const a of audiences) {
    const canSee = filterByAudience(ALL, a).some((e) => e.id === NOTE.id);
    assert.equal(canSee, a === 'private', `${a} should ${a === 'private' ? '' : 'not '}see it`);
  }
});

test('the reason never leaks even when the detail text is long or unusual', () => {
  const odd = [{ id: 'x', visibility: 'PRIVATE' }, { id: 'y', visibility: null }, { id: 'z' }];
  // Unrecognised values fall back to the workspace default rather than being
  // treated as client-visible, so a bad write cannot widen a note.
  const forClient = filterByAudience(odd, 'client');
  assert.deepEqual(forClient, []);
});

test('ติดปัญหา and ขอข้อมูลเพิ่ม default to private, other events do not', () => {
  assert.equal(defaultVisibilityFor('blocked'), 'private');
  assert.equal(defaultVisibilityFor('info'), 'private');
  for (const kind of ['created', 'accepted', 'submitted', 'approved', 'revision', 'handoff']) {
    assert.equal(defaultVisibilityFor(kind), 'workspace', kind);
  }
});

test('an unknown visibility is treated as the safe default, never as client', () => {
  assert.equal(normalizeVisibility(undefined), 'workspace');
  assert.equal(normalizeVisibility('public'), 'workspace');
  assert.equal(normalizeVisibility('client'), 'client');
  assert.equal(normalizeVisibility(null, 'private'), 'private');
});

const TASK = {
  assigneeUserId: 'worker',
  primaryAssigneeUserId: null,
  createdByUserId: 'manager',
  reviewerUserId: 'manager',
};

test('worker and manager can read the private note, a bystander cannot', () => {
  assert.equal(canReadPrivate({ viewerUserId: 'worker', role: 'member', task: TASK }), true);
  assert.equal(canReadPrivate({ viewerUserId: 'manager', role: 'member', task: TASK }), true);
  // Everyone in the workspace can see the task is blocked. Not everyone gets
  // to read why.
  assert.equal(canReadPrivate({ viewerUserId: 'someone', role: 'member', task: TASK }), false);
});

test('the author of a note can always read it back', () => {
  // Otherwise a worker writes a note and immediately cannot see it, which
  // reads as the app having lost it.
  assert.equal(
    canReadPrivate({
      viewerUserId: 'helper',
      role: 'member',
      event: { actorUserId: 'helper' },
      task: TASK,
    }),
    true,
  );
});

test('a bystander reads the task at the same level the group does', () => {
  assert.equal(audienceForViewer({ viewerUserId: 'someone', role: 'member', task: TASK }), 'workspace');
  assert.equal(audienceForViewer({ viewerUserId: 'worker', role: 'member', task: TASK }), 'private');
  assert.equal(audienceForViewer({ viewerUserId: 'boss', role: 'owner', task: TASK }), 'private');
});

test('every level says plainly who will read it', () => {
  for (const level of VISIBILITY_LEVELS) {
    const label = audienceLabel(level);
    assert.ok(label.length > 0, level);
    // No jargon: the person writing the note has to understand it at a glance.
    assert.equal(/visibility|private|workspace|client/i.test(label), false, label);
  }
});

/**
 * The structural half.
 *
 * Rules applied per view leak the first time somebody adds a view. This walks
 * the source and asserts that reading task_event happens in exactly one place,
 * so a new screen cannot quietly select the rows itself.
 */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

test('nothing outside the data layer selects task events', () => {
  const offenders = [...sourceFiles('app'), ...sourceFiles('lib')]
    .filter((f) => f !== join('lib', 'db', 'events.ts'))
    .filter((f) => /\.from\(\s*taskEvent\s*\)/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(
    offenders,
    [],
    `read task events through lib/db/events.ts so the visibility rule applies:\n${offenders.join('\n')}`,
  );
});

test('the client surface is built in one place', () => {
  // Two client-facing surfaces answering "can they see this?" separately is
  // how they end up disagreeing.
  const offenders = sourceFiles('app')
    .filter((f) => f.includes('summary') || f.includes('client'))
    .filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /\.from\(\s*task\s*\)/.test(src) && !src.includes('clientDelivery');
    });
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

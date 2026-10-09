import test from 'node:test';
import assert from 'node:assert/strict';
import { track, pendingRequests, subscribe, isBackgroundRequest } from '../lib/api/activity.ts';

test('requests are counted while they run, including ones that fail', async () => {
  const seen: number[] = [];
  const stop = subscribe(() => seen.push(pendingRequests()));
  let finish!: () => void;
  const a = track(new Promise<void>((resolve) => (finish = resolve)));
  const b = track(Promise.reject(new Error('nope'))).catch(() => {});
  assert.equal(pendingRequests(), 2);
  await b;
  assert.equal(pendingRequests(), 1);
  finish();
  await a;
  assert.equal(pendingRequests(), 0);
  stop();
  assert.deepEqual(seen, [1, 2, 1, 0]);
});

test('only the checks the app makes by itself are background', () => {
  assert.equal(isBackgroundRequest('/api/workspaces/w1/changes'), true);
  assert.equal(isBackgroundRequest('/api/announcements'), true);
  // Closing an announcement is the person's own action.
  assert.equal(isBackgroundRequest('/api/announcements/a1/read', 'POST'), false);
  assert.equal(isBackgroundRequest('/api/tasks'), false);
  assert.equal(isBackgroundRequest('/api/workspaces/w1/announcements'), false);
});

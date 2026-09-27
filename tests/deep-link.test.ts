import test from 'node:test';
import assert from 'node:assert/strict';
import { appLink, safeNextPath, taskIdFromSearch, pageFromSearch, pageUrl } from '../lib/deep-link.ts';

/**
 * Links in and out of LINE.
 *
 * A reminder that opens the app's front page instead of the task makes the
 * person hunt for it; a `next` that can point off-site turns the login page
 * into an open redirect. Both are pinned here.
 */

test('a LINE link opens the task through LIFF', () => {
  process.env.NEXT_PUBLIC_LIFF_ID = '123-abc';
  assert.equal(appLink({ task: 't-1' }), 'https://liff.line.me/123-abc?task=t-1');
  assert.equal(appLink(), 'https://liff.line.me/123-abc');
});

test('without a LIFF ID the link falls back to the site', () => {
  delete process.env.NEXT_PUBLIC_LIFF_ID;
  process.env.APP_BASE_URL = 'https://example.test/';
  assert.equal(appLink({ task: 't-1' }), 'https://example.test/?task=t-1');
});

test('the task id is read directly and from inside liff.state', () => {
  assert.equal(taskIdFromSearch('?task=abc-123'), 'abc-123');
  assert.equal(taskIdFromSearch('?liff.state=%3Ftask%3Dabc-123'), 'abc-123');
  assert.equal(taskIdFromSearch(''), null);
  assert.equal(taskIdFromSearch('?task=<script>'), null);
});

test('after login the person returns to where they were going', () => {
  assert.equal(safeNextPath('/?task=abc'), '/?task=abc');
  assert.equal(safeNextPath('/?liff.state=%3Ftask%3Dabc'), '/?task=abc');
});

test('next can never leave the site', () => {
  for (const bad of [
    'https://evil.test/',
    '//evil.test/',
    '/\\evil.test',
    'javascript:alert(1)',
    '/?liff.state=%2F%2Fevil.test%2F',
    '/?liff.state=https%3A%2F%2Fevil.test',
    '',
    null,
    undefined,
  ]) {
    const out = safeNextPath(bad);
    assert.ok(out.startsWith('/') && !out.startsWith('//'), `${String(bad)} -> ${out}`);
    assert.ok(!out.includes('evil'), `${String(bad)} -> ${out}`);
  }
});

test('no LIFF id and no base URL means no link, not "/"', () => {
  delete process.env.NEXT_PUBLIC_LIFF_ID;
  delete process.env.APP_BASE_URL;
  assert.equal(appLink(), '');
  assert.equal(appLink({ task: 't-1' }), '');
});

/**
 * Screens in the address. Nine screens shared one URL, so Back left the app
 * and a reload always came back to วันนี้.
 */

test('a link can name the screen, directly or through liff.state', () => {
  assert.equal(pageFromSearch('?p=reminders'), 'reminders');
  assert.equal(pageFromSearch('?p=inbox&task=t-1'), 'inbox');
  assert.equal(pageFromSearch('?liff.state=%3Fp%3Dtasks'), 'tasks');
});

test('an unknown screen is ignored rather than shown blank', () => {
  for (const bad of ['', '?p=', '?p=admin', '?p=../settings', '?p=<script>']) {
    assert.equal(pageFromSearch(bad), null, bad);
  }
});

test('วันนี้ keeps the bare address, so the front page has one URL', () => {
  assert.equal(pageUrl('home'), '/');
  assert.equal(pageUrl('settings'), '/?p=settings');
  assert.equal(pageFromSearch(pageUrl('calendar').slice(1)), 'calendar');
});

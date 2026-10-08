import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appNavigation,
  pageKicker,
  mobilePrimaryPages,
  defaultSettings,
  normalizeSettings,
  visibleInTaskList,
} from '../lib/app-preferences.ts';

test('older saved settings migrate without losing cutoff', () => {
  assert.deepEqual(normalizeSettings({ cutoff: '16:45', smartCapture: true }), {
    ...defaultSettings,
    cutoff: '16:45',
  });
});
test('preferences survive a persistence round trip, including false values', () => {
  const settings = {
    cutoff: '18:15',
    startPage: 'calendar',
    notificationBadge: false,
    showCompleted: false,
    reducedMotion: true,
    language: 'en',
  };
  assert.deepEqual(
    normalizeSettings(JSON.parse(JSON.stringify(settings))),
    settings,
  );
});
test('invalid saved values use safe defaults', () => {
  for (const value of [
    null,
    'invalid',
    { cutoff: '25:80', startPage: 'unknown', reducedMotion: 'yes' },
  ]) {
    assert.deepEqual(normalizeSettings(value), defaultSettings);
  }
});
test('all desktop destinations are available in the shared mobile menu', () => {
  const pages = appNavigation.map((item) => item.page);
  assert.equal(new Set(pages).size, pages.length);
  for (const page of ['calendar', 'reports', 'ai', 'manage', 'settings'])
    assert.ok(pages.includes(page as (typeof pages)[number]));
  for (const page of mobilePrimaryPages) assert.ok(pages.includes(page));
  assert.equal(pages.length, 9);
});
test('completed preference filters the general list but explicit completed filter still works', () => {
  assert.equal(visibleInTaskList('done', 'all', false), false);
  assert.equal(visibleInTaskList('todo', 'all', false), true);
  assert.equal(visibleInTaskList('done', 'all', true), true);
  assert.equal(visibleInTaskList('done', 'done', false), true);
  assert.equal(visibleInTaskList('progress', 'done', false), false);
});

test('every screen has a numbered index line, in navigation order', () => {
  assert.equal(pageKicker('home'), '01 — TODAY');
  assert.equal(pageKicker('tasks'), '03 — TASKS');
  assert.equal(pageKicker('settings'), '09 — SETTINGS');
  for (const { page } of appNavigation) {
    assert.match(pageKicker(page), /^\d{2} — [A-Z ]+$/, page);
  }
});

test('language: auto unless a known one was chosen', () => {
  assert.equal(normalizeSettings({}).language, 'auto');
  assert.equal(normalizeSettings({ language: 'th' }).language, 'th');
  assert.equal(normalizeSettings({ language: 'fr' }).language, 'auto');
});

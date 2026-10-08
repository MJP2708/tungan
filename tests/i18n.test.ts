import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { t, setLocale, localeFromBrowser, intlLocale } from '../lib/i18n/index.ts';
import { en } from '../lib/i18n/en.ts';
import { relativeDeadline, formatDeadline } from '../lib/deadline.ts';

/** Every file that imports the translator. */
function translatedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !full.includes(`i18n${path.sep}`)) {
        if (/from '(@\/lib\/i18n|\.{1,2}\/(\.\.\/)*i18n\/index\.ts|\.\/i18n\/index\.ts)'/.test(fs.readFileSync(full, 'utf8'))) {
          out.push(full);
        }
      }
    }
  };
  for (const dir of ['app', 'components', 'lib']) walk(dir);
  return out;
}

test('every t() key has an English entry', () => {
  const files = translatedFiles();
  assert.ok(files.length >= 5, `found only ${files.length} translated files`);
  const missing: string[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      const key = m[1].replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
      if (!(key in en)) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], 'add these to lib/i18n/en.ts');
});

test('English entries keep their placeholders', () => {
  for (const [key, value] of Object.entries(en)) {
    if (typeof value !== 'string') continue;
    const want = (key.match(/\{\d+\}/g) ?? []).sort().join();
    const got = (value.match(/\{\d+\}/g) ?? []).sort().join();
    assert.equal(got, want, `"${key}" → "${value}"`);
  }
});

test('Thai is the source; English is looked up; unknown text passes through', () => {
  try {
    setLocale('th');
    assert.equal(t('งาน'), 'งาน');
    assert.equal(t('กำหนดส่ง@@field'), 'กำหนดส่ง', 'Thai never shows the context');
    assert.equal(t('{0} วัน', 3), '3 วัน');
    setLocale('en');
    assert.equal(t('งาน'), 'Tasks');
    assert.equal(t('{0} วัน', 1), '1 day');
    assert.equal(t('{0} วัน', 3), '3 days');
    assert.equal(t('ข้อความที่ไม่มีในพจนานุกรม'), 'ข้อความที่ไม่มีในพจนานุกรม');
    // One Thai word, two English ones, told apart by a context.
    assert.equal(t('กำหนดส่ง'), 'Deadlines');
    assert.equal(t('กำหนดส่ง@@field'), 'Deadline');
    assert.equal(intlLocale(), 'en-GB');
  } finally {
    setLocale('th');
  }
});

test('dates follow the language; the server stays Thai by default', () => {
  const now = new Date('2026-10-09T03:00:00Z');
  const due = new Date('2026-10-09T05:00:00Z');
  assert.equal(relativeDeadline(due, now), 'อีก 2 ชม.');
  try {
    setLocale('en');
    assert.equal(relativeDeadline(due, now), 'in 2 hr');
    assert.equal(relativeDeadline(new Date('2026-10-07T03:00:00Z'), now), '2 days overdue');
    assert.equal(formatDeadline(due, { now }), 'Today 12:00');
    assert.match(formatDeadline(new Date('2026-10-20T05:00:00Z'), { now }), /^20 Oct 12:00$/);
  } finally {
    setLocale('th');
  }
});

test('a phone in Thai gets Thai; anything else gets English', () => {
  assert.equal(localeFromBrowser('th-TH'), 'th');
  assert.equal(localeFromBrowser('th'), 'th');
  assert.equal(localeFromBrowser('en-US'), 'en');
  assert.equal(localeFromBrowser('ja-JP'), 'en');
  assert.equal(localeFromBrowser(undefined), 'th');
});

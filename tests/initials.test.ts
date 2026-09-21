import test from 'node:test';
import assert from 'node:assert/strict';
import { initialsFor } from '../lib/initials.ts';

test('Thai names use the first consonant, not a leading vowel', () => {
  assert.equal(initialsFor('เมย์'), 'ม');
  assert.equal(initialsFor('ศุภวัฒน์ เจริญพงศ์ไพศาล'), 'ศ');
  assert.equal(initialsFor('ไผ่'), 'ผ');
  assert.equal(initialsFor('พิม'), 'พ');
});

test('emoji never produce half a character', () => {
  assert.equal(initialsFor('เมย์ 🌸'), 'ม');
  assert.equal(initialsFor('🌸🌸'), '?');
  assert.ok(!initialsFor('🌸 Tony').includes('�'));
});

test('Latin names get two letters', () => {
  assert.equal(initialsFor('Tony Stark'), 'TS');
  assert.equal(initialsFor('Tony'), 'T');
  assert.equal(initialsFor('โทนี่ (ฝ่ายขาย)'), 'ท');
});

test('empty names are a question mark', () => {
  assert.equal(initialsFor(''), '?');
  assert.equal(initialsFor(null), '?');
});

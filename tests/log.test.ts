// P1-7 (2026-11-06): nothing personal goes into a log line or a stored error.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { maskLineId, safeErrorMessage } from '../lib/log.ts';

test("Drizzle's quoted values never survive", () => {
  const drizzle = Object.assign(
    new Error('Failed query: insert into "inbox_item" ("raw_message") values ($1)\nparams: เมย์ ส่งรายงานลูกค้า ABC,U1234567890abcdef'),
    { cause: Object.assign(new Error('duplicate key value violates unique constraint "x"'), { code: '23505' }) },
  );
  const out = safeErrorMessage(drizzle);
  assert.match(out, /^\[23505\] duplicate key/);
  assert.doesNotMatch(out, /เมย์|ABC|U1234567890/);
});

test('a driver message that quotes a value has it blanked', () => {
  const e = Object.assign(new Error('Key (line_user_id)=(U1234567890abcdef) already exists.'), { code: '23505' });
  assert.doesNotMatch(safeErrorMessage(e), /U1234567890/);
});

test('a wrapper with no cause still says only that a query failed', () => {
  assert.doesNotMatch(safeErrorMessage(new Error('Failed query: select ... params: secret text')), /secret/);
});

test('a LINE id is shortened to tell people apart without naming them', () => {
  assert.equal(maskLineId('U1234567890abcdef1234567890abcdef'), 'U1234…cdef');
  assert.equal(maskLineId(null), '-');
});

test('no log call prints a whole error object', () => {
  // console.*(…, error) prints the error with its message, and Drizzle's
  // message quotes the query's values. Errors go through safeErrorMessage.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && full !== path.join('app', 'error.tsx')) {
        for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
          if (/console\.(error|warn|log|info)\(.*(,\s*(error|err|e)\)|\(error as Error\)\.message)/.test(line)) offenders.push(`${full}: ${line.trim()}`);
        }
      }
    }
  };
  walk('app');
  walk('lib');
  assert.deepEqual(offenders, []);
});

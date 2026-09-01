import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dialogLayoutClasses } from '../lib/dialog-layout.ts';

test('task-entry layout has no inherited centering or transform animations', () => {
  assert.equal(dialogLayoutClasses('custom'), '');
  const component = readFileSync(
    new URL('../components/task-entry-dialog.tsx', import.meta.url),
    'utf8',
  );
  assert.match(component, /<DialogContent\s+\{\.\.\.props\}\s+layout="custom"/);
});

test('ordinary dialogs retain centered positioning and animation', () => {
  const classes = dialogLayoutClasses('centered');
  for (const value of [
    'top-1/2',
    'left-1/2',
    '-translate-x-1/2',
    '-translate-y-1/2',
    'data-open:animate-in',
  ]) {
    assert.ok(classes.split(' ').includes(value));
  }
});

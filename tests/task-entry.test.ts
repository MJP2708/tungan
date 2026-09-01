import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextTaskId,
  validateTaskEntry,
  visibleFormViewport,
} from '../lib/task-entry.ts';

test('empty and whitespace-only fields explain why saving failed', () => {
  assert.equal(validateTaskEntry({ title: '   ' })?.field, 'title');
  assert.equal(
    validateTaskEntry({ title: 'ส่งงาน', message: '   ' })?.field,
    'message',
  );
});
test('both task flows allow a custom day and time-independent valid date', () => {
  assert.equal(
    validateTaskEntry({
      title: 'ส่งงาน',
      customDate: true,
      date: new Date(2026, 8, 18),
    }),
    null,
  );
  assert.equal(
    validateTaskEntry({
      title: 'นำเข้า',
      message: 'ส่งเอกสาร',
      customDate: true,
      date: new Date(2026, 9, 15),
    }),
    null,
  );
  assert.equal(
    validateTaskEntry({
      title: 'ส่งงาน',
      customDate: true,
      date: new Date('invalid'),
    })?.field,
    'date',
  );
});
test('optional evidence accepts valid web links and rejects invalid protocols/hosts', () => {
  for (const evidenceUrl of [
    '',
    'https://drive.google.com/file/d/example',
    'http://example.com',
  ])
    assert.equal(
      validateTaskEntry({ title: 'นำเข้า', message: 'ข้อความ', evidenceUrl }),
      null,
    );
  for (const evidenceUrl of [
    'https://',
    'javascript:alert(1)',
    'file:///tmp/a',
    'drive.google.com',
  ])
    assert.equal(
      validateTaskEntry({ title: 'นำเข้า', message: 'ข้อความ', evidenceUrl })
        ?.field,
      'evidenceUrl',
    );
});
test('mixing creation and import cannot reuse an existing numeric task ID', () => {
  const tasks = [{ id: 'TNG-266' }, { id: 'TNG-286' }, { id: 'TNG-301' }];
  assert.equal(nextTaskId(tasks), 'TNG-302');
  assert.equal(nextTaskId([...tasks, { id: 'TNG-302' }]), 'TNG-303');
  assert.equal(nextTaskId([]), 'TNG-261');
});
test('form tracks keyboard-reduced viewport and Safari viewport panning', () => {
  assert.deepEqual(visibleFormViewport({ height: 844, offsetTop: 0 }), {
    height: 844,
    top: 0,
  });
  assert.deepEqual(visibleFormViewport({ height: 390, offsetTop: 82 }), {
    height: 390,
    top: 82,
  });
  assert.deepEqual(visibleFormViewport({ height: 420, offsetTop: -4 }), {
    height: 420,
    top: 0,
  });
});

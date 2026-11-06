// P1-4 (2026-11-06): AGENTS.md is a pointer to CLAUDE.md, never a second copy
// of the rules. A stale copy described the glass design removed on 1 Nov, and
// agents that read AGENTS.md (Codex, Cursor, Copilot) would have rebuilt it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const agents = fs.readFileSync('AGENTS.md', 'utf8');

test('AGENTS.md points at CLAUDE.md and holds no rules of its own', () => {
  assert.match(agents, /CLAUDE\.md/);
  // Next.js 16.4 keeps its own short block here (read the bundled docs);
  // that is all that may follow the pointer.
  const own = agents.replace(/<!-- BEGIN:nextjs-agent-rules -->[\s\S]*<!-- END:nextjs-agent-rules -->/, '');
  assert.ok(own.trim().split('\n').length <= 4, 'a pointer, not a copy');
  assert.doesNotMatch(agents, /glass|pastel|#0080ff|Prompt|LINE/i);
});

// Since 16.4, `next dev` always upserts its block into AGENTS.md, creating
// the file if it is missing — so the file stays, with the block already
// current, and `next dev` finds nothing to change.
test('`next dev` leaves AGENTS.md exactly as committed', () => {
  const require = createRequire(import.meta.url);
  const { writeAgentFiles } = require('next/dist/server/lib/generate-agent-files.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-'));
  fs.copyFileSync('AGENTS.md', path.join(dir, 'AGENTS.md'));
  assert.equal(writeAgentFiles(dir).agentsMd, 'unchanged');
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), agents);
  fs.rmSync(dir, { recursive: true, force: true });
});

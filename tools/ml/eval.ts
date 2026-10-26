/**
 * How well does a model read tagged LINE messages? (2026-10-26)
 *
 * Runs every case in tools/ml/eval-set.json three ways and scores each
 * against what a person would confirm:
 *   - rules:    the webhook's own reading today (lib/line/extract.ts), free;
 *   - model:    the model alone, through the app's real prompt and checker
 *               (lib/ai/read-message.ts, lib/ai/client.ts);
 *   - pipeline: what people would actually see — the rules, with the model
 *               asked only when shouldAskModel() says so, merged by mergeReadings.
 *
 *   ML_SERVICE_URL=http://127.0.0.1:11434 ML_SERVICE_TOKEN=local \
 *   ML_MODEL=hf.co/typhoon-ai/typhoon2.5-qwen3-4b-gguf:Q4_K_M \
 *   node --experimental-strip-types --conditions=react-server tools/ml/eval.ts
 *
 * Ollama, vLLM or any OpenAI-compatible server works. Nothing is stored and
 * no database is touched. VERBOSE=1 prints every miss.
 */
import { readFileSync } from 'node:fs';
import { extractDraft, splitInstructions } from '../../lib/line/extract.ts';
import { buildReadRequest, mergeReadings, parseReadResponse, READ_SCHEMA, shouldAskModel } from '../../lib/ai/read-message.ts';
import { callModel } from '../../lib/ai/client.ts';
import { fromZonedWallClock, zonedDateParts } from '../../lib/deadline.ts';

type Due = string | null;
type Expected = { title: string[]; assignee: Array<string | null>; due: Due[] };
type Case = { kind: string; text: string; tasks: Expected[] };
type Reading = { title: string; assigneeUserId: string | null; dueAt: Date | null };

const set = JSON.parse(readFileSync(new URL('./eval-set.json', import.meta.url), 'utf8')) as {
  now: string; cutoff: string; sender: string; members: Array<{ userId: string; names: string[] }>; cases: Case[];
};
const [d, t] = set.now.split(' ');
const [Y, M, D] = d.split('-').map(Number);
const [h, m] = t.split(':').map(Number);
const NOW = fromZonedWallClock(Y, M, D, h, m);

const bangkok = (at: Date) => {
  const p = zonedDateParts(at);
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  return { day: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`, time: hm };
};

function dueOk(got: Date | null, want: Due[]): boolean {
  return want.some((w) => {
    if (w === null) return got === null;
    if (!got) return false;
    const g = bangkok(got);
    if (w.includes('..')) {
      const [a, b] = w.split('..');
      return g.day >= a && g.day <= b;
    }
    const [day, time] = w.split(' ');
    return g.day === day && (!time || g.time === time);
  });
}
const titleOk = (got: string, want: string[]) =>
  got.length > 0 && got.length <= 60 && !got.includes('@') && want.some((w) => got.toLowerCase().includes(w.toLowerCase()));

/** Score one reading of one message: per field, and all-right. */
function score(got: Reading[], c: Case) {
  const fields = { count: got.length === c.tasks.length, title: 0, assignee: 0, due: 0, total: c.tasks.length };
  const used = new Set<number>();
  for (const want of c.tasks) {
    // Pair each expected task with the reading whose title fits it.
    let i = got.findIndex((g, k) => !used.has(k) && want.title.some((w) => g.title.toLowerCase().includes(w.toLowerCase())));
    if (i < 0) i = got.findIndex((_, k) => !used.has(k));
    if (i < 0) continue;
    used.add(i);
    const g = got[i];
    if (titleOk(g.title, want.title)) fields.title += 1;
    if (want.assignee.includes(g.assigneeUserId)) fields.assignee += 1;
    if (dueOk(g.dueAt, want.due)) fields.due += 1;
  }
  const allRight = fields.count && fields.title === fields.total && fields.assignee === fields.total && fields.due === fields.total;
  return { ...fields, allRight };
}

function rulesReading(text: string): Reading[] {
  return splitInstructions(text).map((part) => {
    const x = extractDraft(part, { members: set.members, senderUserId: set.sender, cutoff: set.cutoff, isGroup: true, now: NOW });
    return { title: x.title, assigneeUserId: x.assigneeUserId, dueAt: x.dueAt };
  });
}

async function modelReading(text: string): Promise<{ tasks: Reading[] | null; ms: number }> {
  const req = buildReadRequest({ text, members: set.members, senderUserId: set.sender, now: NOW });
  const started = Date.now();
  // Generous here: this measures accuracy. Production allows 15s (assist.ts).
  const res = await callModel({ task: 'read_message', system: req.system, user: req.user, schema: READ_SCHEMA, maxTokens: 500, timeoutMs: 180_000 });
  const ms = Date.now() - started;
  if (!res.ok) return { tasks: null, ms };
  const parsed = parseReadResponse(res.data, { refs: req.refs, cutoff: set.cutoff, text, members: set.members, now: NOW });
  return { tasks: parsed?.map((p) => ({ title: p.title, assigneeUserId: p.assigneeUserId, dueAt: p.dueAt })) ?? null, ms };
}

const verbose = process.env.VERBOSE === '1';
const show = (r: Reading[]) =>
  r.map((x) => `「${x.title}」 ${x.assigneeUserId ?? '-'} ${x.dueAt ? `${bangkok(x.dueAt).day} ${bangkok(x.dueAt).time}` : '-'}`).join(' | ') || '(none)';

type Tally = { cases: number; allRight: number; title: number; assignee: number; due: number; fields: number };
const blank = (): Tally => ({ cases: 0, allRight: 0, title: 0, assignee: 0, due: 0, fields: 0 });
const tallies: Record<string, Record<string, Tally>> = { rules: {}, model: {}, pipeline: {} };
const add = (way: string, kind: string, s: ReturnType<typeof score>) => {
  for (const k of [kind, 'ALL']) {
    const x = (tallies[way][k] ??= blank());
    x.cases += 1;
    x.allRight += s.allRight ? 1 : 0;
    x.title += s.title;
    x.assignee += s.assignee;
    x.due += s.due;
    x.fields += s.total;
  }
};

const times: number[] = [];
let failures = 0;
let asked = 0;
for (const c of set.cases) {
  const rules = rulesReading(c.text);
  const { tasks: model, ms } = await modelReading(c.text);
  times.push(ms);
  if (!model) failures += 1;
  // What the webhook does: ask only when the rules could not read it.
  const askModel = shouldAskModel(rules, c.text, set.members);
  if (askModel) asked += 1;
  // Flagged "AI: อาจไม่ใช่งาน": the person sees the model found no task.
  const flagged = askModel && model !== null && model.length === 0;
  const pipeline = flagged ? [] : askModel && model
    ? mergeReadings(rules, model.map((x) => ({ ...x, reason: '' }))).map((x) => ({ title: x.title, assigneeUserId: x.assigneeUserId, dueAt: x.dueAt }))
    : rules;
  const scored = { rules: score(rules, c), model: score(model ?? [], c), pipeline: score(pipeline, c) };
  for (const [way, s] of Object.entries(scored)) add(way, c.kind, s);
  process.stdout.write(scored.pipeline.allRight ? '.' : 'x');
  if (verbose && (!scored.pipeline.allRight || !scored.model.allRight)) {
    console.log(`\n[${c.kind}] ${c.text}\n  rules:    ${show(rules)}\n  model:    ${model ? show(model) : '(failed)'}  ${ms}ms\n  pipeline: ${show(pipeline)}${askModel ? '  (asked)' : ''}${flagged ? ' (flagged: อาจไม่ใช่งาน)' : ''}`);
  }
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%`.padStart(4) : '  - ');
console.log(`\n\nmodel ${process.env.ML_MODEL ?? '(default)'} · ${set.cases.length} messages · model asked by the pipeline for ${asked}`);
console.log('way       kind         all-right  title  person  deadline');
for (const way of ['rules', 'model', 'pipeline']) {
  for (const [kind, x] of Object.entries(tallies[way]).sort(([a], [b]) => (a === 'ALL' ? 1 : b === 'ALL' ? -1 : a.localeCompare(b)))) {
    console.log(`${way.padEnd(9)} ${kind.padEnd(12)} ${pct(x.allRight, x.cases)} ${String(`${x.allRight}/${x.cases}`).padStart(5)}  ${pct(x.title, x.fields)}   ${pct(x.assignee, x.fields)}    ${pct(x.due, x.fields)}`);
  }
}
times.sort((a, b) => a - b);
console.log(`model answers failed: ${failures}/${set.cases.length} · time per answer: median ${times[Math.floor(times.length / 2)]}ms, slowest ${times.at(-1)}ms`);

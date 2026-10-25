#!/usr/bin/env node
/**
 * A stand-in for our model service (2026-10-25), for tests and local runs
 * until the real one exists. It speaks the same OpenAI-compatible
 * /v1/chat/completions the app calls (lib/ai/client.ts), checks the bearer
 * token, and gives a fixed, deterministic answer per schema name. It is not
 * a model and reads nothing it does not need.
 *
 *   ML_STAND_IN_TOKEN=dev-token PORT=8790 node tools/ml/stand-in.mjs
 *   ML_SERVICE_URL=http://127.0.0.1:8790 ML_SERVICE_TOKEN=dev-token …
 *
 * A message containing STANDIN_FAIL answers 500, to test the fallbacks.
 * GET /calls returns how many completions were answered, and the last user
 * content it was sent — for the e2e checks that a retry is not asked twice
 * and that nothing private is sent.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8790);
const TOKEN = process.env.ML_STAND_IN_TOKEN ?? 'dev-token';
let calls = 0;
let last = '';

function tomorrow(now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(now ?? '');
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return d.toISOString().slice(0, 10);
}

function answer(task, schema, user) {
  let input = {};
  try {
    input = JSON.parse(user);
  } catch {}
  if (task === 'read_message') {
    const message = String(input.message ?? '');
    const member = (input.members ?? []).find((m) =>
      (m.names ?? []).some((n) => n && message.includes(n)),
    );
    const title = message.replace(/@\S+/g, ' ').replace(/พรุ่งนี้|วันนี้|ก่อนประชุม/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    return {
      tasks: title
        ? [{
            title,
            assignee: member?.ref ?? null,
            // "ก่อนประชุม" is something the rules cannot read: the stand-in
            // reads it as tomorrow 10:00, so a test can tell who read what.
            dueDate: /พรุ่งนี้|ก่อนประชุม/.test(message) ? tomorrow(input.now) : null,
            dueTime: /พรุ่งนี้|ก่อนประชุม/.test(message) ? '10:00' : null,
            reason: 'ตัวแทนโมเดล: อ่านจากคำในข้อความ',
          }]
        : [],
    };
  }
  if (task === 'prioritize') {
    const first = (input.tasks ?? [])[0];
    return { picks: first ? [{ task: first.ref, reason: `ตัวแทนโมเดล: ${first.section}` }] : [] };
  }
  if (task === 'summarize') {
    if ((schema?.required ?? []).includes('nextStep')) {
      return {
        summary: `ตัวแทนโมเดล: ${input.title ?? ''} · ${input.status ?? ''} · ${(input.history ?? []).length} รายการ`,
        nextStep: input.status === 'รอตรวจ' ? 'รอผู้จัดการตรวจ' : null,
      };
    }
    return {
      summary: `ตัวแทนโมเดล: ปิด ${(input.closed ?? []).length} · ใหม่ ${(input.created ?? []).length} · เลยกำหนด ${(input.overdue ?? []).length}`,
      highlights: (input.overdue ?? []).slice(0, 2).map((o) => `เลยกำหนด: ${o.title}`),
    };
  }
  return {};
}

createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/calls') return send(200, { calls, last });
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return send(404, { error: 'not found' });
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'unauthorized' });
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(400, { error: 'bad json' });
    }
    const user = body.messages?.find((m) => m.role === 'user')?.content ?? '';
    if (user.includes('STANDIN_FAIL')) return send(500, { error: 'asked to fail' });
    const format = body.response_format?.json_schema ?? {};
    calls += 1;
    last = user;
    send(200, {
      id: `standin-${calls}`,
      object: 'chat.completion',
      model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(answer(format.name, format.schema, user)) }, finish_reason: 'stop' }],
    });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`[ml stand-in] http://127.0.0.1:${PORT}`));

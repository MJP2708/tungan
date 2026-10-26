# The model service

**Now (2026-10-26): two hosted providers, until our own server exists.**

| | Jev (TypeSafe AI) | Writing model: Typhoon's hosted API |
|---|---|---|
| Does | is it a task, who, which day — typed answers | titles, splitting, summaries, reasons |
| Env | `TYPESAFE_API_KEY` (opt. `TYPESAFE_MODEL`, default `jev-latest`) | `ML_SERVICE_URL=https://api.opentyphoon.ai`, `ML_SERVICE_TOKEN=<key>`, `ML_MODEL=typhoon-v2.5-30b-a3b-instruct`, `ML_RESPONSE_FORMAT=prompt` |
| Code | `lib/ai/jev.ts`, `lib/ai/jev-questions.ts` | `lib/ai/client.ts` |

Either one alone works. Which is asked when: `lib/ai/route.ts`. Check the
live model id at `GET https://api.opentyphoon.ai/v1/models` before setting
`ML_MODEL`. Measure before switching a team on:

```
TYPESAFE_API_KEY=… ML_SERVICE_URL=https://api.opentyphoon.ai ML_SERVICE_TOKEN=… \
ML_MODEL=typhoon-v2.5-30b-a3b-instruct ML_RESPONSE_FORMAT=prompt VERBOSE=1 \
node --experimental-strip-types --conditions=react-server tools/ml/eval.ts
```

(That sends the 40 made-up test messages in `tools/ml/eval-set.json` to both
services.) The rest of this page is the plan for our own server.

---

ทันงาน's AI is our own open Thai model, run as a private inference service.
This is the one exception to "no second service" in CLAUDE.md: it does model
inference and nothing else. Every prompt, rule, permission check and charge
stays in this app (`lib/ai/`). Users never reach the service; only this app's
server calls it.

## What the app expects

An **OpenAI-compatible** `POST /v1/chat/completions` that honours
`response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`
and a bearer token. vLLM does both (`--api-key`, guided decoding), so does
SGLang. The app sends `temperature: 0`, a system and a user message, and reads
`choices[0].message.content` as JSON (`lib/ai/client.ts`).

Three schema names, one per feature:

| `name` | Feature | Built in |
|---|---|---|
| `read_message` | a tagged LINE message the rules could not read | `lib/ai/read-message.ts` |
| `prioritize` | "ควรทำอะไรก่อน" beside งานฉัน | `lib/ai/prioritize.ts` |
| `summarize` | a task, or a group's day/week | `lib/ai/summarize.ts` |

People go to the model as refs (`M1`, `T3`), never LINE ids. A private
ติดปัญหา note is sent only inside a summary for someone who may read it.

## Env (server-only — never `NEXT_PUBLIC_`)

| Var | |
|---|---|
| `ML_SERVICE_URL` | base URL, e.g. `https://ml.example.internal` (no `/v1`) |
| `ML_SERVICE_TOKEN` | the service's API key |
| `ML_MODEL` | served model name; default `tungan-th` |
| `AI_KILL_SWITCH` | `1` turns every AI call off at once |

AI is off everywhere until both URL and token are set (`aiConfigured()`), and
then still off per team until a Manager turns it on (หน้า AI).

## Serving (when the hosting is decided)

Not chosen yet. The user creates the server and hands over the URL and key.
Constraints: same region as the app and database (Singapore) so the LINE
reply token (about a minute) is not spent on the network; reading has a 15s
budget, summaries 12s.

A starting point, with an open Thai instruction model (Typhoon, or a Qwen
instruct model):

```
vllm serve <hf-model-id> \
  --served-model-name tungan-th \
  --api-key "$ML_SERVICE_TOKEN" \
  --max-model-len 8192
```

(Flag names move between vLLM releases; check `vllm serve --help` for the
installed version.)

Check it before pointing the app at it:

```
curl -s "$ML_SERVICE_URL/v1/chat/completions" -H "authorization: Bearer $ML_SERVICE_TOKEN" \
  -H 'content-type: application/json' -d '{"model":"tungan-th","messages":[{"role":"user","content":"ตอบ {\"ok\":true}"}],
  "response_format":{"type":"json_schema","json_schema":{"name":"t","strict":true,"schema":{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"]}}}}'
```

## Without a model: the stand-in

`tools/ml/stand-in.mjs` speaks the same API with fixed answers per schema
name. It is what the e2e run uses (`tools/e2e/phase6.mjs`):

```
ML_STAND_IN_TOKEN=dev-token PORT=8790 node tools/ml/stand-in.mjs
ML_SERVICE_URL=http://127.0.0.1:8790 ML_SERVICE_TOKEN=dev-token …
```

A message containing `STANDIN_FAIL` answers 500 (the fallback path);
`GET /calls` reports how many answers it gave and the last input.

## Charging and failure

- Spent **before** the call, per source (`lib/ai/allowance.ts`): daily cap,
  total allowance, kill switch, the team's switch; never negative.
- The answer is stored on the usage row; a retry under the same key gets it
  back with no second call and no second charge (kept 7 days, then cleared by
  `lib/retention.ts`).
- If the model fails or answers badly, the charge is given back and the
  product carries on exactly as without AI.

## Training data (approved 2026-10-25)

Per team, **off** until a Manager turns it on next to the consent wording
(version `TRAINING_CONSENT_VERSION` in `lib/ai/training.ts`). Then each
confirmed draft keeps: the tagged message, what the rules read, what the
model read, what the person confirmed, and whether they corrected it
(`ai_training_example`). Never other chat. Unsend deletes the example;
opting out deletes all of the team's. Nothing in this app trains on them —
exporting and training is a separate, later step.

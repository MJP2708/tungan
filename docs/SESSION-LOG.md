# Session log — read this to catch up

For Claude, at the start of a session. CLAUDE.md holds the **rules**; this
file holds **where things stand**: what is live, what is waiting, and the
practical gotchas of working on this machine. Newest first. When a session
ends with something worth knowing, add an entry at the top of "History" and
fix "Right now" — keep it short, and never put secrets here.

## Right now (2026-11-06, after the risk and bug fix pass)

- **Live:** https://www.humanmatter.work = `origin/main` at `5a6651a`
  (the flat look, `d58a636`, plus this log). Vercel deploys on push to
  `main`, about a minute after.
- **Committed locally, NOT pushed or deployed:** 17 commits, `cd8c595` →
  `c652d61`, the fix pass below. Migrations **0018–0021** come with them and
  are **not applied on production**. Deploying means: push (SSH), then run
  `drizzle-kit migrate` against production with the direct URL — say so
  first, it writes to the live database. The new code needs the new
  columns, so migrate as soon as the deploy is live (or just before).
- **AGENTS.md** is committed and is a pointer to CLAUDE.md plus Next.js's
  own managed block (since 16.4 `next dev` always keeps that block in
  AGENTS.md and creates the file if it is missing). It must never again hold
  a copy of the rules. `tests/agents-md.test.ts` enforces it.
- **AI is OFF in production.** No `TYPESAFE_API_KEY` / `ML_SERVICE_*` on
  Vercel. Jev is undecided (CEO).
- **CSP is Report-Only.** Flip `CSP_ENFORCE` in `next.config.ts` only after
  the deployed app has been used inside LINE on a phone with no `[csp]`
  lines in the Vercel log.

### Waiting on the user

1. **Deploy the fix pass** (push + migrations 0018–0021, see above).
2. **After it is live:** open the app inside LINE on a phone (Android and
   iPhone if possible), then check the Vercel log for `[csp]`. None → set
   `CSP_ENFORCE = true` (adds X-Frame-Options too).
3. **cron-job.org:** turn on its "notify on failure" email for the job. The
   GitHub backup now also fails — and GitHub emails you — when cron-job.org
   has been silent 90 minutes or reminders are stuck (lib/reminders/scheduler.ts).
4. **Jev or not** (CEO). Until then, no keys. If no: take Jev out of
   `lib/ai/route.ts`, /privacy, the AI page and the join message; bump the
   consent version.
5. **API keys**, then permission and a budget, before `tools/ml/eval.ts`
   runs against live services.
6. **Dev environment:** recommended before the beta — a Neon dev branch and
   separate dev LINE channels, so a forgotten override cannot message real
   people. The user creates them; then `.env.local` points at them.
7. **Public repo:** CLAUDE.md and this log describe how production works.
   Going private costs Actions minutes (reminders.yml ≈ 1,700 runs/month
   against 2,000 free) — decide together with the scheduler.
8. **Vercel MCP sign-in:** `/mcp` → `plugin:vercel:vercel` → authenticate.
9. Optional: `public/og.png` and the LINE rich menu image.

### Open, not done

- Requiring a group's first-Manager claim to be confirmed in the app (the
  claim is now announced in the group and audited; this is the next step).
- Hand-off and question DMs carry no X-Line-Retry-Key (single calls, never
  retried). There is no daily digest yet.
- `npm audit` (dev tooling only): drizzle-kit's moderate esbuild advisory
  (only fix is a downgrade), and the shadcn chain (zod high, minimatch,
  deepmerge) — dev-only since shadcn moved to devDependencies.
- The CLAUDE.md copy of Next's "This is NOT the Next.js you know" block is
  no longer maintained by `next dev` (16.4 writes only AGENTS.md).

### Next planned work

A daily LINE digest (personal tasks get no pushes until it exists, and it
is the main answer to the quota). On ภาพรวม: trends over weeks, per-person
history.

## History

### 2026-11-06 — risk and bug fix pass (`cd8c595`…`c652d61`, not deployed)

From an outside review of `5a6651a`. The user said "do what you think is
best" on the four open questions: personal workspaces get a 50-message
share; a group claim is announced and audited (app confirmation later);
cron-job.org is the primary scheduler, GitHub the backup and alarm; Jev
recorded as undecided.

- P0: Next.js 16.3.3 → 16.4.5 (critical advisories; production audit
  22 → 0; shadcn moved to devDependencies). The webhook no longer reads any
  DB error as "duplicate"; unfinished events are taken over under a lease
  and finished by the cron's recovery pass; re-running an event is safe
  (drafts, announcements, hand-offs keyed). An account-wide LINE quota guard
  (`lib/line/quota.ts`) on top of each workspace's share; a "monthly limit"
  429 stops at once. Every push carries X-Line-Retry-Key (stored per message
  on the reminder rows); every LINE call has an 8s limit (`lib/line/fetch.ts`).
- P1: the group claim notice + `manager_claimed` audit; setassignee and
  createTasks refuse people outside the workspace; scheduler heartbeat and
  alarm; AGENTS.md is a pointer; CLAUDE.md's AI section is one current
  story, roles say Manager, the September audit moved to
  `docs/AUDIT-2026-09.md`; security headers (CSP report-only); no personal
  data in logs (`lib/log.ts`), stored errors cleared at 7 days.
- P2: first sign-in is one transaction (it also fixed the web-callback
  path still giving 300); a failed confirm keeps the draft's message;
  evidence links resolve DNS before fetching; `/api/health` says only
  `ready` without the cron secret; expired sessions are purged.

Numbers: 350 tests with the database (was 305), 237 without (was 214);
e2e 75/75; visual check, targets, contrast, palette, urls and the new
dialog check clean; build output 18 KB smaller; lint 433 → 479, all of the
rise the same no-floating-promises the repo's node:test files already show.

### 2026-11-01 — colours become a background accent (`d58a636`, live)

The user: "use the colors i gave you as a background accent, i want the
button color, the logo and everything the same". So sky `#0593c6`, pink
`#d83995` and white `#fcffff` are now **only** a soft wash in
`.app-shell::before` / `.auth-page::before`. Restored from `a6c4a7b`: the
logo PNG, `favicon.svg`, and the LINE confirm card colours
(`lib/line/confirm-message.ts`). Buttons are ink again, state is `#0080ff`,
counts are red. `tools/visual/palette.mjs` was **inverted**: it now fails if
sky or pink appears on anything but the backdrop. The logo PNG has a
`#fefefe` field, so `img[src*='tungan-logo-th']` gets `mix-blend-mode:
multiply` in brand.css. Pushed on the user's "push to production".

### 2026-10-31 — "make it professional" (same commit)

The user committed and pushed `d19989d` themselves: the three colours as
bold accents (sky/pink tiles, bullseye dot after every title, a poster on
the sign-in page, a recoloured logo). Their verdict: "looks weird and funny
… I want it professional". Rebuilt flat: white cards, one hairline, 10px
cards / 8px controls, 26px titles, 12px text floor, white sidebar,
edge-to-edge phone bar. **Deleted** `app/theme-atelier.css`, `app/liquid.css`,
`components/liquid-glass.tsx`, `lib/liquid-glass.ts` and its test, and the
`pageKicker()` index lines ("03 — TASKS"). The share card on ภาพรวม lost
"POV:" and the hashtags; it now reads "สรุปงานจาก LINE".
`app/theme-glass.css` stays: it still holds component layout, with its
glass tokens set flat in `app/brand.css`.

Lesson (also in memory `ui-professional-flat`): when the user gives colours,
use them in the least invasive way and judge the whole site, not one part.

### 2026-10-31 — Vercel tooling installed

CLI 65.9.0 at `~/.local/bin/vercel` (global npm needs root here), logged in
as `mjp2708`. Plugin `vercel@claude-plugins-official`, user scope, Claude
Code only; it brings the MCP endpoint `https://mcp.vercel.com`, so do not
add a second one. The project is **not** linked locally (no `.vercel/`), on
purpose. The plugin's telemetry is on; `VERCEL_PLUGIN_TELEMETRY=off` stops
it. A newer CLI exists: `npm i -g --prefix ~/.local vercel@latest`.

### 2026-10-26 — AI: Jev + Typhoon's hosted API (`2b0aa9a`, `d71a54a`)

Order: rules → Jev (one draft missing a person or a day) → Typhoon (a
paragraph, 2+ people named, or still unread). Tested locally with Typhoon
2.5 4B in Ollama on 40 made-up messages: the pipeline reached 38/40 (95%)
after two fixes; rules alone 75%. The two misses: English "tomorrow 9am",
and Typhoon inventing a deadline for "ส่งของให้ลูกค้าที่บางนา". Jev is not
measured (no key). Nothing has been trained. Animations shipped the same
day (`a6c4a7b`).

### Earlier

Roles (`449f177`, migration 0016) and AI groundwork (`b002b3a`, migration
0017) are applied on production. Before that: see `git log` — every commit
message says what changed and why.

## Working on this machine

- **Pushing:** `gh` auth has expired and HTTPS push fails. Push over SSH:
  `git push git@github.com:MJP2708/tungan.git main`. Only when the user says
  push/deploy.
- **`.env.local` is production** (Neon Singapore + live LINE). Every local
  server used for testing must override every key; see `tools/e2e/README.md`.
- **Test databases are Docker containers that stop on reboot:**
  `docker start tungan-test` (port 55432) and `docker start tungan-e2e`
  (55433). If the DB-backed tests suddenly fail with `ECONNREFUSED`, that is
  why. Stop them afterwards.
- **Visual harness browser:** the Playwright build it expects is missing.
  Point it at the installed one:
  `export CHROME=$(ls ~/.cache/ms-playwright/chromium_headless_shell-1234/*/chrome-headless-shell)`.
- **Killing a server:** use `fuser -k 3107/tcp`; `pkill -f` matches the
  shell running it.
- **Logo changes look stale** until `.next/cache/images` is cleared.
- **Expected numbers:** 237 unit tests, 350 with `TEST_DATABASE_URL`; e2e 75
  checks across phases 1–6 (78 after 17:00 Bangkok); phase 1 can flake once
  right after the server starts. Lint: compare with the starting commit
  (479 at `c652d61`).
- **Migrations on the test databases:** after pulling new ones, run
  `drizzle-kit migrate` against both (55432 and 55433) before testing.
- **Checking a deploy:** poll `https://www.humanmatter.work/login`'s CSS for
  a string from the change, then `GET /api/health` — it answers only
  `{"ready":…}` unless you send `Authorization: Bearer $CRON_SECRET`.

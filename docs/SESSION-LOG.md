# Session log — read this to catch up

For Claude, at the start of a session. CLAUDE.md holds the **rules**; this
file holds **where things stand**: what is live, what is waiting, and the
practical gotchas of working on this machine. Newest first. When a session
ends with something worth knowing, add an entry at the top of "History" and
fix "Right now" — keep it short, and never put secrets here.

## Right now (2026-11-06)

- **Live:** https://www.humanmatter.work = `origin/main` at `d58a636`
  (2026-11-01). Vercel deploys on push to `main`; it went live about a
  minute after the push. `/api/health` reports ready, database ok, 25 tables.
- **Working tree:** clean apart from this file (and the untracked
  `AGENTS.md`, which is always left out of commits).
- **AI is OFF in production.** No `TYPESAFE_API_KEY` / `ML_SERVICE_*` on
  Vercel. The code for Jev + Typhoon is shipped and waits for keys.

### Waiting on the user

1. **Jev or not** — the user is discussing Jev (TypeSafe) with their CEO.
   Until they decide, do not wire keys. If Jev is rejected: remove Jev from
   `lib/ai/route.ts`'s chain, /privacy, the AI page and the bot's join
   message, and bump the consent version.
2. **API keys** for Jev and/or Typhoon, then permission **and a budget**
   before running `tools/ml/eval.ts` against the live services (it sends 40
   made-up messages; the TypeSafe skill requires asking first).
3. **Vercel MCP sign-in:** `/mcp` → `plugin:vercel:vercel` → authenticate.
   Only the user can do it. After that, run `search_vercel_documentation`
   and `list_teams` to confirm.
4. Optional, offered and not asked for: `public/og.png` and the LINE rich
   menu image (`docs/line-rich-menu/`) — both still the original blue,
   which now matches the site again.

### Next planned work (from CLAUDE.md)

The manager view/dashboard. A daily LINE digest (needed before personal
tasks get reminders, and the main answer to the 300-message quota).

## History

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
- **Expected numbers:** 214 unit tests, 305 with `TEST_DATABASE_URL`; e2e 75
  checks across phases 1–6 (78 after 17:00 Bangkok); phase 1 can flake once
  right after the server starts.
- **Checking a deploy:** poll `https://www.humanmatter.work/login`'s CSS for
  a string from the change, then `GET /api/health`.

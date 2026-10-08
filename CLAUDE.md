# TUNGAN (ทันงาน) — working rules

Thai, LINE-first task app. This file loads at the start of every session. The
constraints below are decided, not open questions. Do not relitigate them.

## Shape of the project

**One plain Next.js App Router project.** No Vite, no vinext, no Wrangler, no
Cloudflare Workers, no second service. All backend work lives in `app/api`
route handlers.

If Vite, Wrangler, or a separate API service ever appears in a plan, that is
drift — stop and go back to this file. (It has happened once already.)

- Framework: Next.js 16.3.3, React 19.2.6
- Database: **Neon Postgres**. Decided. Do not propose alternatives.
  - Route handlers use the **pooled** connection string (`-pooler` host).
    Serverless functions open many short-lived connections and exhaust a
    direct connection fast.
  - Migrations use the **direct** connection string.
  - Development was meant to use a **separate Neon branch**. *Overridden by
    the user on 2026-09-21:* `.env.local` holds the PRODUCTION Singapore
    database and the live LINE channels, deliberately, so there is one env to
    keep. Do not silently switch it back — but say so before running anything
    locally that writes rows or sends LINE messages, because it reaches real
    data and real people.
  - All database access goes through **one data layer module**. No route
    handler talks to the database directly.
- Cloudflare is **DNS only**. The domain is registered and its DNS is managed
  there. Do not buy a domain, do not move the registrar. Records for the app
  should be DNS-only (proxy off) unless explicitly decided otherwise.
- The webhook hostname must be **stable HTTPS on the app's own domain** at
  `/api/webhooks/line`. Never a preview URL that rotates per deployment —
  changing it means re-verifying in the LINE console by hand.

## Never do without explicit go-ahead

Deploy, push, create external accounts, or buy anything. The user creates all
LINE channels, the Neon project, and all cloud resources, then hands over IDs.

## Visual constraints — treat any difference as a bug

- Brand blue **#0080ff** is the only blue for anything interactive or stateful:
  buttons, links, focus rings, active nav, selected states, badges' brand uses.
  *Relaxed 2026-09-21:* pastel blues and violets are allowed in **decoration
  only** — backdrop gradients, heat-map / airbrush washes, halftone, soft-focus
  shapes. Never on text, controls or state.
- bg `#f7f7f5`, fg `#090909`, card `#ffffff`, border `#deded9` remain the base
  tokens. Glass surfaces are translucent versions of card over the backdrop.
- Light `color-scheme` only. **No dark mode.**
- **Glass redesign (decided 2026-09-21, shipped 2026-09-23):** frosted/liquid
  glass surfaces, halftone, soft airbrush, soft-focus pastel, heat-map
  gradients — built in **CSS/SVG only**, no image assets. Lives in
  `app/theme-glass.css`, imported **after** `globals.css`; removing that import
  must restore the old look exactly. Every `backdrop-filter` needs a solid
  fallback (`@supports not (backdrop-filter: blur(1px))`) for low-end LINE
  WebViews. Mobile nav: floating frosted capsule, icon over bold label, active
  item on an inner pill, red count badges — the five items stay วันนี้ / LINE /
  งาน / เตือน / เพิ่มเติม.
- **Atelier layer (decided 2026-10-01):** Ethereal · luxury typography · Swiss,
  over liquid and frosted glass. Lives in `app/theme-atelier.css`, imported
  **after** `theme-glass.css`; removing that import restores the glass theme
  exactly. Same rules as the glass layer (blue, fallbacks, no new fonts).
  Display titles are Prompt **300**; each screen title carries a Swiss index
  line from `data-kicker` (`pageKicker()` in `lib/app-preferences.ts`, e.g.
  `03 — TASKS`), drawn only by that stylesheet. Kicker text stays **Latin**:
  it is letter-spaced, and spaced-out Thai falls apart. The top bar and the
  desktop sidebar float (margins + radius); task lists number their rows with
  CSS counters; controls are pills. A glass fill must never land on a dark
  element — scope it (`.status-chip.status-done` stays ink) and run
  `tools/visual/contrast.mjs`, which caught exactly that.
- **Redesign (decided 2026-10-02):** the screens were restructured around
  "what do I do next" — วันนี้ opens with รอคุณ (LINE drafts, work to review,
  hand-offs) and the person's own tasks, each with one next-step button; งาน
  is grouped by deadline (เลยกำหนด / วันนี้ / พรุ่งนี้ / หลังจากนั้น / ไม่มีกำหนด
  / ปิดแล้ว) with one 64px line per task and a ของฉัน chip; the task sheet has
  a four-step bar and one dock at the bottom; LINE drafts show the message as
  a bubble with tappable fields; the phone top bar is one row. Its styles live
  in `app/redesign.css`, imported last. **This goes with new markup in
  app/page.tsx, so the "remove the theme import to restore the old look" rule
  no longer holds for the app as a whole** (theme-glass/atelier still layer
  as before; git keeps every earlier version). Thai labels are never
  letter-spaced or set in mono.
- `app/globals.css` stays untouched: override order, specificity, layers and
  `!important` all matter. It is 5,663 lines with 127 `!important` and **zero
  `@layer`**, so the cascade rests entirely on source order and the three
  `@import`s at the top. Changing how those resolve silently changes the UI.
- **Do not remove `shadcn` or `tw-animate-css`** from dependencies. Nothing in
  TypeScript imports them; `app/globals.css` imports them directly.
- Breakpoints **1080, 1020, 760, 380, 360px**. Do not collapse into Tailwind `md`.
- Logo: `public/tungan-logo-th.png` through the `Brand` component with
  `object-fit: cover`. **Never** replace it with `<h1>ทันงาน</h1>`. Keep
  `favicon.svg` and `og.png`.
- Base UI is the primitive layer. **Themed selects only** — no native
  select/date/time pickers.
- Fonts: Prompt (thai+latin, 300–700) and Geist Mono. If they need freezing,
  base it on `reference/fonts/` and `reference/font-faces.css`. **Never import
  `production.css` wholesale.**

## The version 18 mobile dialog fix — do not regress

`TaskEntryDialog` uses `DialogContent layout="custom"`.

- No centered translate/zoom utilities. Desktop centering lives **only** inside
  the `.task-entry-dialog` class as a shorthand `transform`.
- Mobile is pinned with `--entry-visible-top` / `--entry-visible-height` and
  `transform: none`.
- `requestAnimationFrame` around the `visualViewport` listeners, cleaned up on
  close.
- Static footer, 44px close, 48px actions.
- Calendar `repeat(7, minmax(0, 1fr))` with 40px days, working down to 320px.

The original bug was a **Tailwind individual translate surviving a transform
reset after minification**. Verify on a **production build** — a dev server
proves nothing here.

## LINE rules

- **Reply vs push is a cost decision.** Group confirmations use the REPLY
  endpoint with the webhook's reply token; replies are **not** counted against
  quota. Reminders are PUSH DMs to individuals and are counted **per
  recipient** — one push into a ten-person group costs ten messages.
  **Never send reminders to a group.** Multicast/broadcast/narrowcast are also
  per recipient.
- Scale we design against: one 10-person team, 2 reminders/person/day, 22
  working days = **440 counted messages/month for ONE team**. The Free OA plan
  is **300/month**. So: **daily digest first**, individual push only when
  genuinely urgent and only to the people concerned.
- **No auto-scan.** Group mode default is `@ทันงาน` mention only. The bot never
  reads a user's whole LINE account — only messages addressed to it or posted
  in a group it joined.
- A group can hold **only ONE LINE OA at a time**. If a group already has one,
  ทันงาน cannot join, so the **DM fallback path is required, not optional**.
- The group member IDs endpoint needs a **Verified or Premium** account. Until
  then only members who produced a webhook event are known. The assignee picker
  degrades to "known members only" and must not look broken.
- **Never advertise unlimited LINE reminders**, in the UI or anywhere.
- Webhook: verify `x-line-signature` over the **raw body before parsing**
  (`await req.text()`, HMAC-SHA256, base64, timing-safe compare),
  `export const runtime = 'nodejs'`. Dedup on `webhookEventId` with a unique
  constraint and honour `deliveryContext.isRedelivery`. Ack fast, work after.
- Raw message retention **7 days or less**. On `unsend`, delete or mask it.

## Announcements and ทุกคน (decided 2026-10-08)

- **Announcements:** owners and admins post — in the app (ทีม → ประกาศ,
  server-checked: `requireMembership(id, { roles: ['owner','admin'] })`) or
  in LINE with `@ทันงาน ประกาศ: หัวข้อ` (new line for details; same role
  check; parsed by `lib/line/announce.ts`, and "ประกาศผล…" stays a task).
  Every member **including the author** sees each one **once**, as a popup
  before using the app (re-checked when the app comes back into view),
  closed with X or รับทราบ. Closing is stored server-side (`announcement_read`), so it does
  not return on another phone. **In the app only** — never posted to the LINE
  group, which would cost one counted message per member. Data access in
  `lib/announcements.ts`; history on ทีม → ประกาศ.
- **Read receipts and meeting links (2026-10-09):** the history shows
  "รับทราบแล้ว x/y" (current members who closed it) to everyone; the names of
  who has not are sent **only** to the author, owners and admins — `null`
  for everyone else, decided on the server. An announcement may carry one
  link (`announcement.link`, migration 0014) shown as a "เข้าร่วม Google Meet /
  Zoom / Teams / เปิดใน LINE" button; `lib/meeting-link.ts` validates and
  labels it. In LINE the first link in `ประกาศ:` becomes the button and is
  taken out of the text. ทันงาน does **not** run voice or video calls itself.
- **ทุกคน / @All tasks:** one copy per person, linked by `task.batch_id`, so
  each person ticks off their own and whoever asked sees "ทุกคน · เสร็จ x/y".
  "Everyone" = workspace members + people seen in a bound LINE group, minus
  whoever asked (`everyoneAssignable`). LINE's "@All" marks a draft
  `assign_all`; picking one person with เปลี่ยนคน turns it off. Every way a
  task is made goes through `lib/tasks/create.ts` → `createTasks()` (which
  also plans reminders — the LINE confirm path used to skip that).

## Groups link themselves (decided 2026-10-08)

When the bot joins a LINE group, the group gets its own workspace at once,
named after the group and bound to it (`ensureGroupWorkspace` in
`lib/auth/membership.ts`) — nobody presses "link team". Everyone seen in the
group is let in as a member as they appear (`admitToGroupWorkspace`). The
workspace has no owner until the first person who **tags @ทันงาน** (or opens
the app from the group) claims it; chatting never makes anyone owner. Groups
joined before this get their workspace at their next message. The bot
leaving no longer removes the binding, so coming back reuses the same
workspace; unlinking on purpose is still in ตั้งค่า.

## Manager overview (2026-10-08)

ผลงาน became **ภาพรวม** (`?p=reports`, kicker `05 — OVERVIEW`): what needs
chasing, then each person's load; the share card moved below it. The rules
are in `lib/tasks/overview.ts` (pure, tested), not in render code. Each open
task lands in at most one list, first match wins: เลยกำหนด → ติดปัญหา →
รอตรวจ → ไม่มีคนรับผิดชอบ → ยังไม่กดรับ (after a day, or due within one) →
ไม่ขยับ 3 วัน (from `status_changed_at`). Handed-in work is never late.
"งานเยอะ" needs both 5+ open and twice the team average. Every member can
see it, like the task list itself.

## Data rules

- Identity is the **LINE user ID**. Nicknames are per-workspace display data
  only — two members with the same nickname are different people.
- Session is **our own httpOnly, secure, sameSite cookie**. Never a LINE token
  stored in the browser.
- One `requireSession(req)` helper resolves user + workspace membership
  server-side, used by every route. **No route may accept a workspace ID from
  the client as proof of access.**
- Store timestamps in **UTC**, resolve and display **Asia/Bangkok**.
- **Deadlines are real timestamps, never status words.** `lib/deadline.ts` is
  the single source of truth for resolving and formatting them.
- Do not auto-import prototype `localStorage` data into real accounts, and
  never guess ambiguous legacy dates.
- Every mutating route takes an **idempotency key** and is safe to retry.

## Secrets

Channel secret, channel access token, Neon connection strings and any API key
are **server-only env vars**. Never `NEXT_PUBLIC_`. The only public value is the
**LIFF ID**. Dev and production use separate LINE channels and separate
databases; a preview must never hold production tokens or message real users.

Never commit `node_modules`, `.next`, `.vercel`, real `.env` files, tokens or
database dumps.

## Out of scope

Auto-scan of all messages, native apps, calendar sync, file storage, public
signup, annual plans, per-group add-ons, public leaderboards.

## AI scope — updated 2026-10-02

**Our own model, no third-party AI API.** Decided by the user 2026-10-02. Jev
(TypeSafe) is removed. No other hosted AI API is to be added.

- **Where it runs:** a separate inference service, because a bigger model
  will not fit inside a Vercel function. This is the ONE exception to "no
  second service", and it covers model inference only: every product route,
  rule and permission check stays in `app/api`. Only this app's server calls
  it (`ML_SERVICE_URL` + `ML_SERVICE_TOKEN`, both server-only). Users never
  reach it; they only ever use ทันงาน. `lib/ai/model.ts` → `aiConfigured()` is
  false until both are set, so AI is off everywhere until the service exists.
- **What it does:**
  - Extract task, person and deadline from a tagged LINE message.
  - Help with prioritising: it may *suggest* (with a reason a person can read).
    The default order stays deterministic (deadline, time-in-state, blocked
    status) and is never silently replaced.
  - Summarise work in ทันงาน (a task and its history, a day, a week) for a
    person to read. Not a chat surface.
- **Training data — NOT decided yet.** The product promises today: the bot
  reads only messages that tag @ทันงาน, raw messages are kept 7 days or less,
  and unsend deletes our copy. Proposed (awaiting the user's OK): per-
  workspace opt-in; train on confirmed and corrected drafts (the reading next
  to what people fixed), not on raw chat; /privacy updated; unsend and
  deletion still honoured; PDPA consent. Until this is decided, nothing new
  is collected for training.

OUT of scope, unchanged:
- AI chat, open-ended conversation, or a chat surface of any kind.
- Autonomous multi-step agent loops. One call, one structured response, one
  human confirmation.

Constraints that apply to every model call:
- AI proposes, never acts. Every output is confirmed by a person before anything is created.
- Weighted consumption: text 1, image 2–3, voice per 30 seconds. Rules-parsed messages cost nothing.
- Hard cap per day and per workspace, plus a kill switch (`AI_KILL_SWITCH=1`).
  No negative balances. (`lib/ai/allowance.ts`, kept from the Jev work.)
- Server-enforced limits on image size and audio length.
- A retry under the same idempotency key is never charged twice.
- When the allowance runs out or the service is down, rules, manual
  creation, reminders and all status actions keep working.
- Never the words token or credit in the Thai UI.

Build order for extraction is text, then image, then voice — separately, not at
once. Voice is the most expensive and the least certain, so whether image and
voice are worth their cost is decided from real beta usage, not from a guess
made before any of it shipped.

## Task 0 audit findings — the fix list

Ranked P0 (blocks external users) / P1 (before beta) / P2 (later). Full report:
https://claude.ai/code/artifact/9e52bb8a-29ef-44f7-944b-42ec432e2147

### P0

*Status reviewed 2026-09-27: every item below is annotated with what is true
now. Nothing here is a pending task unless it says so.*

- **SEC-1** Identity hardcoded. `assignmentIsMine` compares against a literal
  list `['pim','pim-nami','me','me-view']` plus `id.startsWith('owner-')`.
  Every permission decision derives from it. **FIXED** — `assignmentIsMine`
  compares against the id the server put in the session.
- **SEC-2** `loggedIn` / `lineConnected` restored from `localStorage`
  unvalidated; the login button just flips booleans. **FIXED** — real LINE
  Login and an httpOnly session cookie; nothing is restored from the browser.
- **SEC-3** Approval had **no permission check at all**, not even the
  client-side one every other mutation performs; the client review screen
  called straight through. **FIXED** — `approveTask` / `requestRevision` now
  require `canEditTask`.
- **BUG-1** Status words were written over the deadline field
  (`due: 'เสร็จเมื่อสักครู่'`, `'อนุมัติเมื่อสักครู่'`), destroying the original
  time. **FIXED** — `Task.dueAt` is an ISO instant; status lives in `status`.
- **BUG-2** "Overdue" was computed by searching for the word `เกินกำหนด` in a
  display string, so a genuinely late task never counted. **FIXED** —
  `isOverdue()` compares instants.

### P1

- **SEC-4** Restored `localStorage` is trusted wholesale: only `tasks` and
  `settings` are normalized; `projects`, `captures`, `reminders` and `account`
  are set raw. Empty/malformed `projects` crashes the app, and there is **no
  error boundary** (`app/error.tsx` does not exist). **FIXED** — the server is
  the only source; prototype `localStorage` is never imported, and
  `app/error.tsx` exists. Device preferences are the only thing stored, under
  their own key, through `normalizeSettings`.
- **BUG-3/BUG-4** Natural-language deadlines never became timestamps;
  `ก่อนบ่าย 12` produced `24:00`; `เช้า` only worked alongside `พรุ่งนี้`.
  **FIXED** in `lib/deadline.ts` with tests.
- **BUG-5** `nextTaskId(tasks)` reads a stale closure while the write uses a
  functional updater — a fast double submit yields duplicate IDs. **FIXED** —
  ids are server-side UUIDs; the function was dead code and is deleted.
- **BUG-6** Capture dedup compares **titles**; editing the title creates a
  duplicate, and two genuinely identical titles get silently swallowed. Real
  fix is an idempotency key. **FIXED** — unique `inbox_line_message_key` on
  the LINE message id, plus an idempotency key on every mutating route, and
  confirming claims the draft row conditionally.
- **BUG-7** `selectedTask` holds a **copy**, not an id; every mutation writes
  the whole stale object back. **FIXED** — `selectedTaskId` with the task
  derived from the current list.
- **STR-1** All nine "pages" were `useState`, not routes — no URL, no deep
  link, no back button. **FIXED** — every screen has an address (`/?p=tasks`;
  วันนี้ stays at `/`), `navigate()` pushes it, `popstate` steps back, and a
  reload stays put. Still one route: the address is a query string, not a file
  per page. `pageFromSearch` / `pageUrl` live in `lib/deep-link.ts` and read
  `liff.state` too, alongside the `?task=<id>` link. `main.app-main[data-page]`
  is the harness's hook (`tools/visual/urls.mjs`). An open task sheet pushes a
  step of its own (`history.state.task`), so Back closes the sheet rather than
  the screen behind it. The `startPage` setting was offered but never applied
  — it is now.
- **STR-2** Business rules (permission, ranking, parsing, dedup) live in
  render code and must move to a data layer. **MOSTLY DONE** — permission
  (`lib/tasks/permissions.ts`, `lib/auth/assignable.ts`), transitions,
  parsing, deadlines, reminders and dedup are all server-side modules. What
  remains in render code is display logic.

### P2

- **BUG-8** Calendar dates were frozen at mount, so a WebView left open
  overnight still called yesterday "today". **FIXED** via a ticking `useNow()`.
  (This reproduced live during testing when the date rolled 31 Aug → 1 Sep.)
- **BUG-9** `snoozeReminder` wraps modulo 24h: 23:55 + 10min → 00:05 the same
  day, never tomorrow. **FIXED** — ten minutes added to an instant, and the
  server caps snoozes at three.
- **BUG-10** Workload bar shows the workspace total for every member in the
  "งานของฉัน" workspace. **FIXED** — counted per person in every view.
- **BUG-11** `useEffect` dep `[selectedTask?.id]` omits `selectedTask`; two
  `useMemo`s keyed on a `projectTasks` array rebuilt every render never cache.
  **FIXED** — `projectTasks` is memoised on its real inputs, and the selected
  task is derived rather than copied.
- **BUG-12** Task dialog reads `taskProject.members[0].id` without a guard.
  **FIXED** — guarded at every call site.
- **SEC-5** Two different URL validators for the same rule (`new URL()` +
  protocol allowlist vs a regex). **FIXED** — one `isSafeHttpUrl` in
  `lib/url.ts`, with `isPrivateHost` beside it for the link checker.
- **SEC-6** Evidence links use `rel="noreferrer"`; add explicit `noopener`
  once URLs come from the server. **FIXED**.
- **SEC-7** `components/ui/chart.tsx` has a `dangerouslySetInnerHTML` CSS sink.
  Currently unreachable — **49 of 60 `components/ui` files are dead code**,
  including `native-select.tsx`, which this project forbids using. **FIXED** —
  all 49 deleted; the 11 that are reachable remain. The `shadcn` and
  `tw-animate-css` dependencies stay: `globals.css` imports them.

## Verification

Baseline commands:

```
npm ci
npm test                                          # unit tests
npx tsc --noEmit --incremental false --pretty false
npm run build                                     # must pass before any visual claim
```

`npm run lint` exits **1** and reports errors that are pre-existing style, not
failures. The count moves as code is added and removed — it was 95 at the
original audit, **267** on 2026-09-27 after deleting 49 dead components, and
**286** on the commit before the URL work (289 after, all three the same
`no-floating-promises` every `node:test` call in the file already reports).
Compare against the count on the commit you started from, not a fixed number.

Database-backed tests (workspace isolation, reminder dispatch, AI allowance)
skip unless `TEST_DATABASE_URL` is set:

```
docker run -d --name tungan-test -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=tungan_test -p 55432:5432 postgres:18
DATABASE_URL_UNPOOLED=postgres://postgres:test@localhost:55432/tungan_test \
  npx drizzle-kit migrate
TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/tungan_test npm test
```

CI runs them on every push with a Postgres service.

The visual harness now lives in `tools/visual/` (Playwright still installed
**outside** the repo so it never enters `package.json`):

```
npm i --prefix ~/.cache/tungan-visual playwright-core@1.63.0
npm run build && npx next start -p 3107
node tools/visual/check.mjs     # every page at 320/360/390/430: overflow,
                                # content clipped by a parent, JS errors,
                                # native dialogs
node tools/visual/targets.mjs   # touch targets under 44px
node tools/visual/shots.mjs     # screenshots of the main screens
node tools/visual/urls.mjs      # each screen's address, Back, reload,
                                # start page
node tools/visual/contrast.mjs  # light text left on a light surface
```

**End-to-end against a real backend** lives in `tools/e2e/` (README there):
the production build, a throwaway local Postgres, two signed-in people, a
webhook signed with a fake channel secret, and every step checked in the
database — 53 checks (56 after 17:00 Bangkok) across create → review → approve, LINE drafts,
reminders, settings, workspaces, cron, logout, announcements and ทุกคน tasks. Every key in `.env.local`
must be overridden when starting that server, because `.env.local` is
production; `tools/e2e/lib.mjs` refuses a non-localhost database.

Every `/api/*` call is answered from `tools/visual/fixtures.mjs`, so no
database, no LINE and no login are involved. When comparing screenshot sets,
rebuild both sides **on the same date** — otherwise BUG-8-style date rollover
shows up as a false regression.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

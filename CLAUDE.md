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
  - Development uses a **separate Neon branch** so dev never touches
    production rows.
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

- Brand blue **#0080ff only**. No other blue or violet.
- bg `#f7f7f5`, fg `#090909`, card `#ffffff`, border `#deded9`.
- Light `color-scheme` only. **No dark mode.**
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

Model-based extraction, AI chat or summarizing, auto-scan of all messages,
native apps, calendar sync, file storage, public signup, annual plans,
per-group add-ons, public leaderboards.

## Task 0 audit findings — the fix list

Ranked P0 (blocks external users) / P1 (before beta) / P2 (later). Full report:
https://claude.ai/code/artifact/9e52bb8a-29ef-44f7-944b-42ec432e2147

### P0

- **SEC-1** Identity hardcoded. `assignmentIsMine` compares against a literal
  list `['pim','pim-nami','me','me-view']` plus `id.startsWith('owner-')`.
  Every permission decision derives from it. *Fix belongs to the LINE Login
  task — patching it client-side first is wasted work.*
- **SEC-2** `loggedIn` / `lineConnected` restored from `localStorage`
  unvalidated; the login button just flips booleans. *Same — fixed by real
  sessions.*
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
  error boundary** (`app/error.tsx` does not exist).
- **BUG-3/BUG-4** Natural-language deadlines never became timestamps;
  `ก่อนบ่าย 12` produced `24:00`; `เช้า` only worked alongside `พรุ่งนี้`.
  **FIXED** in `lib/deadline.ts` with tests.
- **BUG-5** `nextTaskId(tasks)` reads a stale closure while the write uses a
  functional updater — a fast double submit yields duplicate IDs.
- **BUG-6** Capture dedup compares **titles**; editing the title creates a
  duplicate, and two genuinely identical titles get silently swallowed. Real
  fix is an idempotency key.
- **BUG-7** `selectedTask` holds a **copy**, not an id; every mutation writes
  the whole stale object back. Becomes a real lost update once an API exists.
- **STR-1** All nine "pages" are `useState`, not routes — no URL, no deep
  link, no back button. **Blocks LIFF deep links** and made visual testing
  need a localStorage seed to reach 8 of 9 pages.
- **STR-2** Business rules (permission, ranking, parsing, dedup) live in
  render code and must move to a data layer.

### P2

- **BUG-8** Calendar dates were frozen at mount, so a WebView left open
  overnight still called yesterday "today". **FIXED** via a ticking `useNow()`.
  (This reproduced live during testing when the date rolled 31 Aug → 1 Sep.)
- **BUG-9** `snoozeReminder` wraps modulo 24h: 23:55 + 10min → 00:05 the same
  day, never tomorrow.
- **BUG-10** Workload bar shows the workspace total for every member in the
  "งานของฉัน" workspace.
- **BUG-11** `useEffect` dep `[selectedTask?.id]` omits `selectedTask`; two
  `useMemo`s keyed on a `projectTasks` array rebuilt every render never cache.
- **BUG-12** Task dialog reads `taskProject.members[0].id` without a guard.
- **SEC-5** Two different URL validators for the same rule (`new URL()` +
  protocol allowlist vs a regex).
- **SEC-6** Evidence links use `rel="noreferrer"`; add explicit `noopener`
  once URLs come from the server.
- **SEC-7** `components/ui/chart.tsx` has a `dangerouslySetInnerHTML` CSS sink.
  Currently unreachable — **49 of 60 `components/ui` files are dead code**,
  including `native-select.tsx`, which this project forbids using.

## Verification

Baseline commands:

```
npm ci
npm test                                          # unit tests
npx tsc --noEmit --incremental false --pretty false
npm run build                                     # must pass before any visual claim
```

`npm run lint` reports **95 pre-existing oxlint errors** and exits 0. That count
is the baseline — compare against it rather than assuming a clean slate.

A visual regression harness (Playwright, installed **outside** the repo so it
never enters `package.json`) covers 9 pages × 10 viewports + dialog states by
seeding `settings.startPage` into `localStorage`. Gate 1 result: 99.2177% of
pixels identical, 0.7823% differing by ≤5/255 (antialiasing), **0.0000% above
that**. When comparing screenshot sets, rebuild both sides **on the same date**
— otherwise BUG-8-style date rollover shows up as a false regression.

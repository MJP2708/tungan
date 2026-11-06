# TUNGAN (ทันงาน) — working rules

Thai, LINE-first task app. This file loads at the start of every session. The
constraints below are decided, not open questions. Do not relitigate them.

**Catch up first:** @docs/SESSION-LOG.md says what is live, what is waiting
on the user, and how to work on this machine. Update it at the end of a
session that changed any of that.

## Shape of the project

**One plain Next.js App Router project.** No Vite, no vinext, no Wrangler, no
Cloudflare Workers, no second service. All backend work lives in `app/api`
route handlers.

If Vite, Wrangler, or a separate API service ever appears in a plan, that is
drift — stop and go back to this file. (It has happened once already.)

- Framework: Next.js 16.4.5, React 19.2.6 (16.3.3 → 16.4.5 on 2026-11-06 for
  critical advisories; `shadcn` is a devDependency since then — Vercel
  installs devDependencies for the build, and only `globals.css` uses it)
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

- **Colours (decided 2026-10-31, changed by the user 2026-11-01):** the
  three accent colours — sky **#0593c6**, hot pink **#D83995**, white
  **#FCFFFF** — are **background only**: a soft wash behind the white cards
  (`.app-shell::before` / `.auth-page::before` in `app/brand.css`). Buttons,
  the logo and every control keep the original colours: ink `#090909`
  primary buttons, brand blue **#0080ff** for selected, focus, links and in
  progress, red for counts and late work. The logo and favicon are the
  original files. `tools/visual/palette.mjs` fails if sky or pink lands on
  anything but the backdrop.
- bg `#f7f7f5`, fg `#090909`, card `#ffffff`, border `#deded9` remain the base
  tokens.
- Light `color-scheme` only. **No dark mode.**
- **The look (decided 2026-10-31, the user's call: "professional"):** flat
  and quiet. White surfaces, one hairline border, 10px cards, 8px controls,
  no glow, no glass, no halftone, no floating bars; the only gradient is
  the soft accent wash in the page background.
  Titles are 26px weight 600; 12px is the floor for text. The sidebar is
  white and the phone's bottom bar runs edge to edge, with the five items
  วันนี้ / LINE / งาน / เตือน / เพิ่มเติม. It all lives in `app/brand.css`,
  imported **last**. `app/theme-glass.css` stays because it still holds
  component layout; its glass tokens are set flat in brand.css. The atelier
  layer, liquid glass and the numbered index lines were removed. Do not
  bring decoration back without being asked: the bullseye title dots, pink
  blocks and poster sign-in of that morning read as "weird and funny".
- **Redesign (decided 2026-10-02):** the screens were restructured around
  "what do I do next" — วันนี้ opens with รอคุณ (LINE drafts, work to review,
  hand-offs) and the person's own tasks, each with one next-step button; งาน
  is grouped by deadline (เลยกำหนด / วันนี้ / พรุ่งนี้ / หลังจากนั้น / ไม่มีกำหนด
  / ปิดแล้ว) with one 64px line per task and a ของฉัน chip; the task sheet has
  a four-step bar and one dock at the bottom; LINE drafts show the message as
  a bubble with tappable fields; the phone top bar is one row. Its styles live
  in `app/redesign.css`, imported last. **This goes with new markup in
  app/page.tsx, so the "remove the theme import to restore the old look" rule
  no longer holds for the app as a whole** (git keeps every earlier version). Thai labels are never
  letter-spaced or set in mono.
- **Motion (2026-10-09):** `app/motion.css`, imported **last**; removing
  that import removes all of it. Opacity and transform only, 160–420ms;
  screens stagger in (`.content-area` is keyed by page so it replays), list
  rows follow, bars grow, pressed controls give a little. All inside
  `prefers-reduced-motion: no-preference`, and ลดภาพเคลื่อนไหว
  (`data-motion='reduced'`) stops it. `.task-entry-dialog` only ever fades —
  never give it a transform animation (version 18 fix). Fill mode is
  `backwards`, so nothing holds a transform after it finishes.
- **Loading (2026-10-09):** the first load draws the real shell (sidebar,
  top bar with logo, stand-ins the size of the workspace picker and bell)
  with glass placeholders shaped like วันนี้, so nothing moves when the data
  lands; after 8s it says the signal may be slow and offers ลองอีกครั้ง. A
  3px brand-blue `ActivityBar` (`components/activity-bar.tsx`, mounted in
  the layout) shows while the person waits on the server, after 200ms;
  every `request()` is counted in `lib/api/activity.ts` except the app's own
  background checks (`/changes`, `/api/announcements` GET). Movement lives
  in motion.css, so with reduced motion it is a still line.
- `app/globals.css` stays untouched: override order, specificity, layers and
  `!important` all matter. It is 5,663 lines with 127 `!important` and **zero
  `@layer`**, so the cascade rests entirely on source order and the three
  `@import`s at the top. Changing how those resolve silently changes the UI.
- **Do not remove `shadcn` or `tw-animate-css`.** Nothing in TypeScript
  imports them; `app/globals.css` imports them directly. `shadcn` lives in
  devDependencies (it pulls express and an MCP SDK that production must not
  ship); `npm audit --omit=dev` must stay at 0.
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
- **"งานฉัน" from LINE (2026-10-09, changed 2026-10-17):** `งานฉัน` /
  `งานของฉัน` / `มีงานอะไรบ้าง` / `my tasks`, answered on the **free reply
  token**. In a 1:1 chat: the 5 most urgent in งานฉัน's section order and a
  button to the page. In a group (`@ทันงาน งานฉัน`): **only** a short line and
  the button — someone's tasks are never listed in a group. Recognised only
  when the **whole message** is the question (`lib/line/my-work.ts`), so
  "งานของฉันคือส่งรายงาน…" still becomes a draft.

## Roles and permissions (decided 2026-10-17)

- **Two roles, on group membership: MEMBER and MANAGER** (`workspace_member.role`
  = `member` | `manager`). A "group" is a workspace: each LINE group has
  exactly one, and an app-made workspace is a group with no chat. The same
  person can be MANAGER in one group and MEMBER in another. Whoever sets a
  group up (first to tag the bot, or makes it) is its first MANAGER and its
  creator (`workspace.created_by_user_id`); everyone new is MEMBER.
- **Every permission check goes through `can(user, action, group, task?)`**
  in `lib/permissions.ts` — the only file that compares a role. Facts come
  from `lib/auth/roles.ts` (`groupFacts`, `assertCan`); routes use
  `requireCan` (`lib/auth/require-can.ts`). API routes, the app screen and
  LINE postbacks all ask it; a forged postback meets the same check.
  `tests/permissions.test.ts` fails if a role is compared anywhere else.
- Member and Manager: create tasks, view group tasks, progress / submit /
  block their own task, read their own private reason. Manager only:
  approve, request revision, reassign, change deadline, read any private
  ติดปัญหา reason in the group, change roles, group settings, announce.
  Asking for a task no longer gives a Member review rights.
- Rules: nobody changes their own role; a group never reaches zero Managers
  by demotion (count + change in one transaction with a row lock); a
  Manager cannot approve their own task while another Manager exists — as
  the only one they can, logged `self_approved`. A Manager who leaves the
  LINE group becomes a Member; with none left the group shows a banner,
  approvals wait, and the creator (recovery path, not a third role) names one.
  Tagging the bot never hands out Manager once a group has been set up.
- `audit_log` records role changes, approvals, revision requests,
  reassignments and deadline changes (`lib/audit.ts`). Migration 0016 maps
  owner/admin → manager, member → member.
- **Personal tasks** live in the person's own workspace (`workspace.kind =
  'personal'`, "no group"): only their maker sees or touches them — never a
  Manager — and the maker closes them directly, the one exception to
  submitted ≠ closed. A private-chat task for yourself is personal; one
  naming a teammate goes to the team workspace you share (keeps the DM
  fallback). Personal tasks get no automatic push reminders (no daily digest
  exists yet).
- **งานฉัน** (`?p=mine`): my open tasks across every group I belong to plus
  my personal ones, in sections ส่งกลับแก้ไข → เลยกำหนด → วันนี้ → สัปดาห์นี้
  → ภายหลัง → รอตรวจ (`lib/tasks/my-tasks.ts`, Bangkok days, week ends
  Sunday). In LINE: a private chat gets the 5 most urgent; a group gets only
  a short line and a button — never a list.
- **Out of scope:** custom roles, tags. The manager view shipped as ภาพรวม
  (2026-10-08, below). Still missing there: trends over weeks, a per-person
  history, and anything sent to the Manager outside the app (a digest).

## Announcements and ทุกคน (decided 2026-10-08)

- **Announcements:** Managers post — in the app (ทีม → ประกาศ,
  server-checked: `requireCan(id, 'post_announcement')`) or
  in LINE with `@ทันงาน ประกาศ: หัวข้อ` (new line for details; same
  can() check; parsed by `lib/line/announce.ts`, and "ประกาศผล…" stays a task).
  Every member **including the author** sees each one **once**, as a popup
  before using the app (re-checked when the app comes back into view),
  closed with X or รับทราบ. Closing is stored server-side (`announcement_read`), so it does
  not return on another phone. **In the app only** — never posted to the LINE
  group, which would cost one counted message per member. Data access in
  `lib/announcements.ts`; history on ทีม → ประกาศ.
- **Read receipts and meeting links (2026-10-09):** the history shows
  "รับทราบแล้ว x/y" (current members who closed it) to everyone; the names of
  who has not are sent **only** to the author and Managers — `null`
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
workspace has no Manager until the first person who **tags @ทันงาน** (or
opens the app from the group) claims it; chatting never makes anyone Manager.
A claim by tagging is said in the group, in the same free reply as the
bot's answer ("<name> เป็นผู้จัดการของกลุ่มนี้ …"), and written to
`audit_log` as `manager_claimed` (2026-11-06): the first to tag could be a
client. Requiring the claim to be confirmed in the app is the next step if
that is not enough; it is not built. Groups
joined before this get their workspace at their next message. The bot
leaving no longer removes the binding, so coming back reuses the same
workspace; unlinking on purpose is still in ตั้งค่า.

## Manager overview (2026-10-08)

ผลงาน became **ภาพรวม** (`?p=reports`): what needs
chasing, then each person's load; the share card moved below it. The rules
are in `lib/tasks/overview.ts` (pure, tested), not in render code. Each open
task lands in at most one list, first match wins: เลยกำหนด → ติดปัญหา →
รอตรวจ → ไม่มีคนรับผิดชอบ → ยังไม่กดรับ (after a day, or due within one) →
ไม่ขยับ 3 วัน (from `status_changed_at`). Handed-in work is never late.
"งานเยอะ" needs both 5+ open and twice the team average. Every member can
see it, like the task list itself.

## Calendar (2026-10-09)

ปฏิทิน (`?p=calendar`, was กำหนดส่ง) is a month calendar by Bangkok day
(`lib/calendar.ts`): deadlines, **events** and the person's own
**reminders**. A day shows one count (red when a task is late, a blue line
under the date when it has an event); picking it lists กิจกรรม, เตือนฉัน and
งานถึงกำหนด. "+ เพิ่ม" adds an event or a reminder (`components/event-dialog.tsx`;
no native pickers — the day is stepped with ‹ ›, times are themed selects).
Calendar **sync** with Google/Outlook stays out of scope.

- **Events (decided 2026-10-09):** for me, the whole workspace, or picked
  people. "Everyone" = members + people seen in the LINE group, the same as
  ทุกคน tasks (`everyoneAssignable`). Private events are seen by their maker
  only — not even Managers. Edit/delete: the maker, or a Manager for a
  shared one (`can(…, 'edit_shared_event')`). Data in `lib/calendar-events.ts`, rules in
  `lib/calendar-event-rules.ts`, migration 0015.
- **Notifications go by LINE and are counted (decided 2026-10-09):** one
  `reminder` row per person (kind `event`, `event_id`), so the dispatcher,
  quota, quiet hours and one-message-per-person digest all apply; the message
  heading is นัดหมาย with the time and join link. The form says how many
  messages it will use before saving. Quiet hours move an alert earlier,
  never after the event. Delivery is in 15-minute steps (cron-job.org,
  08:00–21:45). Event alerts are not listed in เตือนฉัน.

## Languages (decided 2026-10-09)

Thai is the source; English is the second language. Every string is written
in Thai and shown through `t('ข้อความ')` (`lib/i18n`); `lib/i18n/en.ts` holds
the English, keyed by that Thai. So Thai needs no dictionary, a missing
English entry shows Thai rather than a blank, and fixed Thai the server
sends (errors, blocked reasons, task sources) is translated **where it is
shown** — never translate a value before it is stored or compared.
`{0}` marks values; an English entry may be a function for one/many.
`key@@context` separates one Thai word that needs two English ones
(`กำหนดส่ง` = Deadlines, `กำหนดส่ง@@field` = Deadline). Write counts as one
phrase, `t('{0} งาน', n)`, never `{n} {t('งาน')}`.

- The language is a device setting (ตั้งค่า → ภาษา): `auto` (default)
  follows the phone — Thai on a Thai phone, otherwise English — or Thai, or
  English. The login page follows Accept-Language via `translate(locale, …)`.
- The current language is one module-level value set by `app/page.tsx`
  during render. The **server never changes it**, so LINE messages and
  everything stored stay Thai. Module-level labels must be getters, or they
  freeze in Thai at load.
- `tests/i18n.test.ts` fails when a `t()` key has no English entry.
  `LOCALE=en-US node tools/visual/check.mjs` runs the overflow check on the
  English app.
- Step 2, not done yet: the bot's LINE replies and reading English deadlines
  ("tomorrow 10am"); history text the server writes is still Thai.

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

## Security headers (2026-11-06)

`next.config.ts` sends HSTS (no includeSubDomains), nosniff,
Referrer-Policy, Permissions-Policy and a Content-Security-Policy built from
what the LIFF SDK actually loads. The CSP is **Report-Only** until a deploy
has been used inside LINE on a phone with no `[csp]` lines in the Vercel
log (reports go to `/api/csp-report`); then `CSP_ENFORCE = true` enforces it
and adds X-Frame-Options, which has no report-only form. Any new outside
host (a script, an image, an API the browser calls) must be added there.

## Secrets

Channel secret, channel access token, Neon connection strings and any API key
are **server-only env vars**. Never `NEXT_PUBLIC_`. The only public value is the
**LIFF ID**. Dev and production use separate LINE channels and separate
databases; a preview must never hold production tokens or message real users.

Never commit `node_modules`, `.next`, `.vercel`, real `.env` files, tokens or
database dumps.

## Out of scope

Auto-scan of all messages, native apps, calendar sync, file storage, public
signup, annual plans, per-group add-ons, public leaderboards, custom roles,
tags.

## AI scope — updated 2026-11-06

**Now (in production):** AI is **off**. The code reads with two hosted
providers and waits for their keys; none is set on Vercel. **Whether to use
Jev at all is undecided** — the user is discussing it with the CEO. Do not
wire keys or send test data to either service without the user saying so.

**What the code does when keys are set** (`lib/ai/route.ts`): rules first
(free) → **Jev** (TypeSafe, `TYPESAFE_API_KEY`) for quick typed judgments on
one draft missing a person or a day — is it a task, who, which day; it
cannot write → the **writing model**, Typhoon 2.5 via api.opentyphoon.ai
(`ML_SERVICE_URL`/`ML_SERVICE_TOKEN`/`ML_MODEL`, `ML_RESPONSE_FORMAT=prompt`
because that API does not document `response_format`), for a paragraph, 2+
people named, or a draft still unread. Either provider alone works. Jev
questions and thresholds (0.7/0.3) live only in `lib/ai/jev-questions.ts`;
code does the calendar math. Each provider charges 1 per call (`check:` /
`read:` source ids). With only Jev, the summary and ควรทำอะไรก่อน panels are
hidden (`ai.writes`). /privacy, the AI page and the bot's join message name
both providers; consent version `2026-10-26`. If Jev is turned down: take
it out of the chain, those three texts, and bump the consent version.
Measured with `tools/ml/eval.ts` (40 made-up messages): rules alone 75%
fully right, rules + Typhoon 2.5 4B 95% after the 2026-10-26 fixes; Jev not
measured. The TypeSafe skill is installed (`typesafe@typesafe-ai`) — follow
it for Jev work, including asking before sending test data to the live API.

**The goal, not the current state:** our own open Thai model as a private
inference service, with no third-party AI API. This is the ONE exception to
"no second service", and it covers model inference only: every product
route, rule and permission check stays in `app/api`. Only this app's server
calls it; users never reach it. Hosting is not chosen; `docs/ML-SERVICE.md`
has the plan and `tools/ml/stand-in.mjs` the stand-in the e2e run uses.

History: 2026-10-02 "own model only, Jev removed"; 2026-10-26 "Jev +
Typhoon's hosted API for the beta, until our own server exists";
2026-11-06 Jev pending the CEO, AI off in production.

**What AI does** (both now and with our own model):
- Extract task, person and deadline from a tagged LINE message.
- Help with prioritising: it may *suggest* (with a reason a person can
  read). The default order stays deterministic (deadline, time-in-state,
  blocked status) and is never silently replaced.
- Summarise work in ทันงาน (a task and its history, a day, a week) for a
  person to read. Not a chat surface.

**Training data — decided 2026-10-25 (user approved the proposal).**
Per-workspace opt-in, off by default, turned on only by a Manager next to
the consent wording (`TRAINING_CONSENT_VERSION` in `lib/ai/training.ts`;
the PATCH refuses without it; consent time/by/version stored). Kept per
confirmed draft only: the tagged message, rules reading, model reading,
what was confirmed, `corrected` (`ai_training_example`). Never raw chat.
Unsend deletes the example; opting out deletes all of the team's. This is
the one exception to the 7-day text rule, and /privacy says so. Nothing in
the app trains: export and training are a separate, later step.

**How it is wired** (`docs/ML-SERVICE.md`): reading runs in the webhook
only when `needsModel()` (no deadline and no person, or a paragraph for a
title), never for @All; rules values win, the model fills gaps
(`mergeReadings`); the card and the inbox say "AI ช่วยอ่าน · ตรวจก่อนยืนยัน".
ควรทำอะไรก่อน (งานฉัน), สรุปด้วย AI (task sheet, history filtered by the
reader's audience) and สรุปวันนี้ / สัปดาห์นี้ (ภาพรวม) are one press each
(`components/ai-panels.tsx`). Every call goes through `answerOnce` in
`lib/ai/assist.ts`: spend first, keep the answer on `ai_usage.answer`
(cleared at 7 days), a retry gets it back unasked and uncharged, a failure
is refunded. The model's reading/reason on a draft is cleared with its text
(`DRAFT_CONTENT_CLEARED`). `lib/ai/model.ts`: `aiConfigured()` is false
until a provider's keys are set.

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

## Task 0 audit (September 2026)

Every finding is fixed. The list, and how each was fixed, is in
`docs/AUDIT-2026-09.md`.

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
node tools/visual/palette.mjs   # sky/pink anywhere but the background
node tools/visual/dialog.mjs    # version 18 dialog on the production build
```

**End-to-end against a real backend** lives in `tools/e2e/` (README there):
the production build, a throwaway local Postgres, two signed-in people, a
webhook signed with a fake channel secret, and every step checked in the
database — 75 checks (78 after 17:00 Bangkok) across create → review → approve, LINE drafts,
reminders, settings, workspaces, cron, logout, announcements, ทุกคน tasks, roles and AI (phase 6, against `tools/ml/stand-in.mjs`). Every key in `.env.local`
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

# End-to-end run against a real backend

The visual harness (`tools/visual/`) answers every API call from fixtures.
This one does not: it drives the **production build** in a real browser
against a **real local Postgres**, two signed-in people at once, and checks
each step in the database. LINE is never reached: the channel secret and
token are fakes, so replies and pushes fail harmlessly at LINE's door, and
the webhook is exercised by signing test events with the fake secret.

`lib.mjs` refuses any database URL that is not on localhost.

```
# 1. a throwaway database
docker run -d --name tungan-e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=tungan_e2e \
  -p 55433:5432 postgres:18
DATABASE_URL_UNPOOLED=postgres://postgres:e2e@localhost:55433/tungan_e2e npx drizzle-kit migrate

# 2. the app, with EVERY key from .env.local overridden — .env.local holds
#    production, and anything not overridden would be read from it
npm run build
DATABASE_URL=postgres://postgres:e2e@localhost:55433/tungan_e2e \
DATABASE_URL_UNPOOLED=postgres://postgres:e2e@localhost:55433/tungan_e2e \
APP_BASE_URL=http://localhost:3108 CRON_SECRET=e2e-cron \
LINE_LOGIN_CHANNEL_ID=0000000000 LINE_LOGIN_CHANNEL_SECRET=e2e-login-secret \
LINE_MESSAGING_CHANNEL_ACCESS_TOKEN=e2e-fake-token \
LINE_MESSAGING_CHANNEL_SECRET=e2e-channel-secret NEXT_PUBLIC_LIFF_ID= \
npx next start -p 3108

# 3. each phase from a fresh seed
for ph in phase1 phase2 phase3 phase4; do
  PGPASSWORD=e2e psql -q -h localhost -p 55433 -U postgres -d tungan_e2e -f tools/e2e/seed.sql
  node tools/e2e/$ph.mjs
done
```

| Phase | Covers |
|---|---|
| 1 | create a task for someone → รับงาน → ติดปัญหา → evidence link → ส่งตรวจ → ขอแก้ → resubmit → อนุมัติ, and the history |
| 2 | personal reminders (stored wording, past times refused, snooze, two-tap delete, privacy), LINE webhook (bad signature, three drafts, redelivery, untagged ignored), edit/dismiss/confirm drafts, นำข้อความเข้า, past-deadline guard, end-of-day list, nickname, workspace rename, group setup, workspace switch remembered, new workspace, ทีม, กำหนดส่ง, ภาพรวม (late work listed with its reason), cron, logout |
| 3 | รับงาน straight from วันนี้, ขอข้อมูลเพิ่ม and ตอบ, ส่งต่อ (folded section) and the hand-off in รอคุณ, รับงานที่ส่งต่อมา, แก้ไขงาน, undo from the toast, ลบงานนี้ |
| 4 | announcements: members cannot post, the owner posts from ทีม → ประกาศ and sees it too, a member sees it once and X closes it for good, two in a row with รับทราบ, one typed in LINE pops up in the app; ทุกคน tasks: one copy each and linked, listed once with progress, the sheet lists everyone, @All in the LINE group confirmed in the app; a new group links itself and the first to tag the bot owns it |

Steps that depend on the clock (after 17:00 Bangkok) run only then. Each
failure saves a screenshot in `OUT` (default `/tmp/tungan-e2e`). Set
`CHROME=` as for the visual harness. Playwright stays outside the repo.

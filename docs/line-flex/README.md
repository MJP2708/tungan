# LINE draft card

The card the bot replies with when a tagged message becomes a draft
(`confirmBubble` / `confirmMessage` / `confirmCarousel` in
`lib/line/confirm-message.ts`). It is a Flex Message in the app's look:
pastel gradient, the title large, a frosted panel for who and when (with what
each was read from), an ink confirm button, glass เปลี่ยนเวลา · เปลี่ยนคน
buttons and a quiet ไม่ใช่งาน link. Several drafts from one message arrive as
one carousel you swipe, not a stack.

**LINE never lets a bot delete or edit a message it has sent**, so a card
cannot disappear when its task is confirmed, dismissed or cancelled. A
compact `kilo` version was tried on 2026-10-08 and reverted the same day as
too small to read; the card is `mega`. LINE draws it, so there is no blur
and no custom font; the gradient, the translucent white and the hierarchy
carry the look.

To see it exactly as LINE renders it, paste `draft-card.sample.json` (or
`draft-carousel.sample.json`) into
LINE's Flex Message Simulator (developers.line.biz → Flex Message Simulator →
View as JSON). Regenerate the sample after changing the card.

Before shipping a change, LINE's validate endpoint checks a message without
sending it: `POST https://api.line.me/v2/bot/message/validate/reply` with
`{"messages":[...]}` and the channel token. The card and the carousel
both returned 200.

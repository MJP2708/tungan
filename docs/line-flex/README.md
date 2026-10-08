# LINE draft card

The card the bot replies with when a tagged message becomes a draft
(`confirmBubble` / `confirmMessage` / `confirmCarousel` in
`lib/line/confirm-message.ts`). It is a compact Flex Message in the app's
look: pastel gradient, name, who and when, an ink confirm button and one row
of small glass buttons (เวลา · คน · ไม่ใช่งาน). Several drafts from one message
arrive as one carousel you swipe, not a stack.

**LINE never lets a bot delete or edit a message it has sent**, so a card
cannot disappear when its task is confirmed, dismissed or cancelled. Keeping
it small (size `kilo`, about half the 2026-10-08 first version) is the only
way to take less room in the chat. LINE draws it, so there is no blur
and no custom font; the gradient, the translucent white and the hierarchy
carry the look.

To see it exactly as LINE renders it, paste `draft-card.sample.json` (or
`draft-carousel.sample.json`) into
LINE's Flex Message Simulator (developers.line.biz → Flex Message Simulator →
View as JSON). Regenerate the sample after changing the card.

Before shipping a change, LINE's validate endpoint checks a message without
sending it: `POST https://api.line.me/v2/bot/message/validate/reply` with
`{"messages":[...]}` and the channel token. The compact card and the
carousel both returned 200.

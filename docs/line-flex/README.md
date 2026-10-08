# LINE draft card

The card the bot replies with when a tagged message becomes a draft
(`confirmMessage` in `lib/line/confirm-message.ts`). It is a Flex Message in
the app's look: pastel gradient, a frosted panel for who and when, an ink
primary button and quieter glass ones. LINE draws it, so there is no blur
and no custom font; the gradient, the translucent white and the hierarchy
carry the look.

To see it exactly as LINE renders it, paste `draft-card.sample.json` into
LINE's Flex Message Simulator (developers.line.biz → Flex Message Simulator →
View as JSON). Regenerate the sample after changing the card.

Before shipping a change, LINE's validate endpoint checks a message without
sending it: `POST https://api.line.me/v2/bot/message/validate/reply` with
`{"messages":[...]}` and the channel token. The 2026-10-08 card returned 200.

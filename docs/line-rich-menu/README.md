# LINE rich menu

The button bar under the bot's 1:1 chat (LINE does not show rich menus in
groups). Set as the default for all users through the Messaging API on
2026-09-21; it takes priority over the menu configured in LINE Official
Account Manager, which is still saved there.

Current id: `richmenu-c2741185dd6a25e5d7e13aea60abc653`

| Area (x) | Label | Action |
|---|---|---|
| 0–833 | งานของฉัน | uri `https://liff.line.me/<NEXT_PUBLIC_LIFF_ID>` — opens the app signed in |
| 833–1666 | วิธีใช้ | message `วิธีใช้` — matches `HELP_TRIGGERS`, answered on the reply token (free) |
| 1666–2500 | ความเป็นส่วนตัว | uri `https://www.humanmatter.work/privacy` |

Size 2500×843, JPEG under 1 MB. `rich-menu.html` is the source: render it at
exactly 2500×843 (Prompt font from Google Fonts) and upload the result.

To change it: create a new menu (`POST /v2/bot/richmenu`), upload the image
(`POST https://api-data.line.me/v2/bot/richmenu/{id}/content`), set it as
default (`POST /v2/bot/user/all/richmenu/{id}`), then delete the old one.
To go back to the OA Manager menu: `DELETE /v2/bot/user/all/richmenu`.

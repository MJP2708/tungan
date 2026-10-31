# Visual harness

Checks the real production build in a real browser, with every `/api/*` call
answered from `fixtures.mjs` — no database, no LINE, no login needed (the
session gate only checks that a cookie exists).

Playwright is installed **outside the repo** so it never enters
`package.json` (CLAUDE.md):

```
npm i --prefix ~/.cache/tungan-visual playwright-core@1.63.0
npm run build && npx next start -p 3107      # a dev server proves nothing
node tools/visual/check.mjs                  # overflow, clipped content, JS errors, native dialogs
node tools/visual/shots.mjs                  # viewport screenshots of the main screens
node tools/visual/urls.mjs                   # every screen's address, Back, reload, start page
node tools/visual/contrast.mjs               # light text left on a light surface
AI=1 node tools/visual/ai.mjs                # press every AI panel, check the answer fits
node tools/visual/palette.mjs                # any retired colour left on any screen
```

`AI=1` makes the fixtures say AI is on for the team, so every check above
also covers the AI panels and the training consent.

Set `CHROME=/path/to/chrome` if Playwright's own browser is not installed, and
`OUT=` to change where screenshots go (default `/tmp/tungan-visual`).
`check.mjs`, `urls.mjs` and `contrast.mjs` exit non-zero when anything is wrong.

Each screen has its own address (`/?p=tasks`), so a screenshot no longer needs
the start page seeded into `localStorage` to get there.

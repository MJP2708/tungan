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
```

Set `CHROME=/path/to/chrome` if Playwright's own browser is not installed, and
`OUT=` to change where screenshots go (default `/tmp/tungan-visual`).
`check.mjs` exits non-zero when anything is wrong.

# Agents: read CLAUDE.md

The rules for this repository are in [CLAUDE.md](CLAUDE.md), and where things stand is in [docs/SESSION-LOG.md](docs/SESSION-LOG.md). Read both before changing anything.
This file used to hold a copy of those rules; the copy went stale and described a design that was removed, so it now only points there.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

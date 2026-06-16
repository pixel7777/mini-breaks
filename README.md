# Mini Breaks

A personal, password-protected daily web app on Cloudflare Pages. Three tabs:

- **Breaks** — YouTube playlist tiles in a calm teal grid; Habits checklist;
  one-time tasks that self-delete when checked, organized by colored dividers.
- **News & Shopping** — free-text topics tracked by a nightly agent; fresh
  items get a 1–2 sentence summary + link and accumulate (sticky) until
  dismissed, can be pinned to a top section, and clear via a Dismiss-all
  control; quiet topics sit in a no-news list, stuck topics say exactly what to
  do about them.
- **Journal** — one entry per day with mood, photo, calendar/timeline/search,
  and a daily three-card tarot reading rendered from a BG3-style deck.

## Architecture

- Static shell: `index.html`, `css/app.css`, `js/app.js`, `js/tarot-core.js`.
  No build step, no runtime dependencies.
- `functions/` — Cloudflare Pages Functions: `_middleware.js` (password gate,
  HMAC cookie), `auth/login.js`, `api/data/[key].js` (whitelisted JSON store
  over the `DATA` KV binding; cookie- or bearer-authenticated).
- Storage: `localStorage` for layout + daily checkboxes (local-first);
  Cloudflare KV for journal, topics, digest, `news-state` (pin/dismiss), tarot
  (durable, cross-device).
- Secrets (`APP_PASSWORD`, `API_TOKEN`) are Pages dashboard env vars — never
  in this repo.

## Tests

`npm test` (node:test, no dependencies) — covers the auth gate, login, API
store, and the tarot quick-draw logic.

## Where the design lives

Design intent, vision, runbooks, and cycle records live in the vault at
`Apps/Mini Breaks/` (in [Heidi's main vault](https://github.com/pixel7777/hkamenar-workspace),
not in this repo). This repo is implementation only.

## Editing

- **Content changes** (playlists, habits, tasks, dividers, topics) are done in
  the page itself via edit modes. No code change needed.
- **Structure changes** (new features, layout shifts) require a code edit +
  push to `main` → Cloudflare deploys.

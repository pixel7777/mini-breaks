# Mini Breaks

A personal, single-page web app — embedded YouTube playlist tiles in a calm teal-and-white grid plus a sidebar checklist of daily routines, with an in-page editor so adding a tile or renaming a row doesn't require touching the source.

Hosted on Cloudflare Pages. One self-contained `index.html` — HTML + CSS + JS inline, no build step. State lives in `localStorage` (per browser, per machine); Export/Import config as JSON to carry the setup across machines.

## Where the design lives

Design intent, vision, decisions, and cycle records live in the vault at `Apps/Mini Breaks/` (in [Heidi's main vault](https://github.com/pixel7777/hkamenar-workspace), not in this repo). Read those for context. This repo is implementation only.

## Editing

- **Content changes** (adding playlists, renaming activities, reordering, changing checkbox counts) are done in the page itself via the "Edit" toggle. No code change needed.
- **Structure changes** (new tile types, new features, layout shifts) require an `index.html` edit + push to `main` → Cloudflare deploys.

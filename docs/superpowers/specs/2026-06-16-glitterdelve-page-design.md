# Glitterdelve — Landing/Lore Page + Standalone Game

**Date:** 2026-06-16
**Repo:** `Kautiontape/glitterdelve` (fresh repo; currently only an untracked `demo.html`)
**Deployed at:** `glitterdelve.kautiontape.com` (assumed; matches `regicide.`/`relish.` pattern)

## Goal

Give Glitterdelve a public home: a single lore page that features the playable game
and explains how to play, plus the game as a standalone file you can open fullscreen
(the good mobile experience). Linked from the kautiontape landing page right after
Regicide. No build step — it's static HTML/CSS/JS deployed via the ktn self-hosted
runner with a plain `git pull`.

## What exists

- `demo.html` — a self-contained `<canvas>` match-3 / light-management game. No
  dependencies, no build. Verified working on desktop and at a 390px mobile viewport
  (board scales, toolbar pinned at bottom, actively ticks and scores). Only console
  error is a missing `favicon.ico`.

## Architecture

Two static files, one game implementation (no duplication):

```
index.html   lore (humanized) → embedded game (iframe → demo.html) + "open fullscreen"
             → collapsed "How to play" + "Rules"
demo.html    the game itself — standalone, openable fullscreen, the mobile play target
```

`index.html` embeds `demo.html` via `<iframe>` on wider screens. On narrow/touch
screens the iframe is replaced by a prominent "Tap to play" card linking to
`demo.html`, because the game's canvas uses `touch-action:none` + pointer capture and
would otherwise trap page scrolling on a phone.

## Components

### 1. `demo.html` — game fixes (small, surgical)
- **Left-click is the Cut/swap, right-click does nothing weird.** Currently pointer
  handlers aren't button-gated and there's no context-menu suppression, so right-click
  also selects a gem and pops the browser context menu. Fix: gate the pointer-down/
  move/up handlers to the primary (left) button and `preventDefault` on `contextmenu`.
  (Left-click already performs select→swap; there is no map-panning code to conflict
  with — panning "isn't a feature yet.")
- **Add a favicon** (small gem SVG, inline data URI or a `favicon.svg`) to clear the
  404 and give the standalone page an identity.
- Otherwise leave the game logic untouched — it works.

### 2. `index.html` — the lore/landing page (new)
- **Lore section:** the Deepunder / Glitterdelve story, written then run through
  `/humanizer` so it doesn't read robotic. Deep-purple gem palette borrowed from the
  game (`--bg:#0e0b16`, accent gold/light) so the page feels like the same world;
  structural/type cues (mono headings, dark cards) echo the kautiontape landing.
- **Play section:** `<iframe src="demo.html">` in a framed, aspect-fit container with
  an "Open fullscreen ↗" link (`demo.html`, new tab). Narrow screens: swap iframe for
  a "Tap to play" card → `demo.html`.
- **How to play (collapsed `<details>`):** the core loop — gems fall under gravity;
  the center **heart-shaft** is the one light that never goes out and harvests gems at
  its floor; match 3+ of a color (drag/tap with **Cut**) to cut gems; a lit match
  pushes light one warren outward. Gems that fall past a column's light **fade and are
  lost to the dark** — matching races gravity.
- **Rules / tools (collapsed `<details>`):** the five tools and what they do —
  **Cut** (swap adjacent gems to make a match), **Wall** (block falling on a seam),
  **Sorter** (auto-swaps a seam when it makes a match), **Fork** (diverts every other
  falling gem sideways), **Lens** (blocks fall *and* relays the light deeper; must sit
  within a column's lit reach). Plus the readouts: warrens lit, lost to the dark.

### 3. Deploy boilerplate
- `.github/workflows/deploy.yml` — landing model:
  ```yaml
  name: Deploy to ktn
  on: { push: { branches: [main] } }
  jobs:
    deploy:
      runs-on: [self-hosted, ktn]
      steps:
        - name: Deploy
          run: |
            cd /opt/services/glitterdelve
            git pull origin main
  ```
  No Node, no build. (Host nginx serves the directory and terminates TLS, same as
  `landing`/`regicide` — that server-side vhost config lives on ktn, out of repo scope.)
- `README.md` — one-screen: what it is, that it's a static single-page game with no
  build, deploy path `/opt/services/glitterdelve`, and that `demo.html` is the
  standalone game embedded by `index.html`.

### 4. Landing card (separate repo: `Kautiontape/landing`)
- Add an `<a class="card">` immediately after the Regicide card in the
  *games & projects* section → `https://glitterdelve.kautiontape.com`, 💎 icon,
  short description. Matches existing card markup exactly.

## Out of scope
- No changes to game mechanics/balance.
- No build tooling, framework, or bundler.
- Server-side nginx vhost / DNS for the subdomain (managed on ktn by the user).

## Open questions / confirmations
- Subdomain `glitterdelve.kautiontape.com` — assumed.
- Spec/doc committed into this repo, or kept local? (This file's fate.)
- Landing change shipped as a direct commit to `main` or a PR?

# Glitterdelve

A small browser game about gnomes cutting gems to hold back the dark. Live at
[glitterdelve.kautiontape.com](https://glitterdelve.kautiontape.com).

## What's here

- **`index.html`** — the public page: the story, the embedded game, and a "How to
  play" / "The tools" guide. Embeds the game in an `<iframe>` on wider screens; on a
  phone it shows a "play fullscreen" card instead, because the game canvas captures
  touch and would otherwise trap the page scroll.
- **`demo.html`** — the game itself, fully self-contained (one file: HTML + canvas +
  JS, no dependencies). This is what `index.html` embeds, and it's directly playable
  on its own / fullscreen.
- **`favicon.svg`** — the gem mark, used by both pages.
- **`sim/`** — the simulation harness and the prototypes built on it: a headless,
  deterministic engine with a CLI, an optimizer, and web viewers. Demo 1 mirrors
  `demo.html`; **the Climb** (demo 2) is the inverted builder game. See
  [`sim/README.md`](sim/README.md).
- **`concept/`** — self-contained concept pages exploring directions we haven't
  committed to. Not linked from the public site.
- **`docs/`** — design specs and implementation plans, dated and kept as a record of
  what each prototype was trying to prove.

## Running it

There is no build. Open `index.html` (or `demo.html`) in a browser, or serve the
folder over HTTP for local testing:

```sh
python3 -m http.server 8777
# then visit http://localhost:8777/
```

## Trying out a concept

Concepts get their own git worktree so several can be open at once without
stashing, and so `main` stays deployable. Worktrees live in a sibling directory,
never inside the repo — the deploy is a plain `git pull` into a directory nginx
serves, so nothing extra belongs in the tree.

```sh
git worktree add -b concept/<name> ../glitterdelve-worktrees/<name> main
cd ../glitterdelve-worktrees/<name>
python3 -m http.server 8777      # each worktree is standalone: no deps, no build
```

When you're done, `git worktree remove ../glitterdelve-worktrees/<name>` (add
`--force` if you want to discard uncommitted work), then delete the branch if the
concept didn't pan out. `git worktree list` shows what's currently checked out.

## Deploying

Push to `main`. A self-hosted GitHub Actions runner on **ktn** (`runs-on:
[self-hosted, ktn]`) pulls the latest into `/opt/services/glitterdelve` — that's the
whole deploy (`.github/workflows/deploy.yml`). No Node, no bundler. The host nginx
serves the directory and handles TLS, the same way the landing page does.

## Controls

Left-click / tap is the only game input. With the **Cut** tool, click a gem and then
an adjacent gem to swap them (or drag one onto its neighbor); the swap holds only if it
makes a match of three or more. The other tools — Wall, Sorter, Fork, Lens — are placed
by selecting them and dragging on the board. Right-click does nothing.

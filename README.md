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

## Running it

There is no build. Open `index.html` (or `demo.html`) in a browser, or serve the
folder over HTTP for local testing:

```sh
python3 -m http.server 8777
# then visit http://localhost:8777/
```

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

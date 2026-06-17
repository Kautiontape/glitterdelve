# Glitterdelve II — "The Climb" (design)

**Date:** 2026-06-17
**Repo:** `Kautiontape/glitterdelve`
**Status:** design approved; spec for review before writing the implementation plan.

## Goal

A second demo that takes the first one (`demo.html` / `sim/`) and literally flips it on
its head. Demo 1: light pours from the top, the center heart-shaft harvests at the
bottom, and you push light *outward* across a fixed 9×14 board, cutting matches by hand.
Demo 2 ("The Climb"): **Glitterdelve sits at the bottom**, light reaches **up** a limited
distance, gems rain **down** toward you, and you push your lit frontier **up** a tall
scrolling shaft — not by cutting gems yourself, but by **deploying structures** that route
the falling gems into matches before they decay. The climb ends when the frontier reaches
the Source at the top and you finally see what has been raining gems on you.

This is a focused *feel prototype* in the spirit of `demo.html`, not a fully balanced game.
All numbers below are first-guess defaults and explicitly tunable.

## Design decisions (locked)

These four pivotal choices were made up front and shape everything:

1. **Progression = push the light up.** Harvesting matches in the light raises a single
   rising **frontier**. There is no clock and no fail state — it is a calm builder-puzzle.
   You climb by succeeding. (Inverse of demo 1's calm outward spread.)
2. **Pure builder, no manual Cut.** The player never swaps gems by hand. You only deploy
   structures (Bomb, Wall, Slope, Splitter, Swapper, Lens). The board runs itself. This
   matches the "Wall Organizer" role and is the cleanest inversion of demo 1's hands-on
   cutting. Consequence: **Swappers are the only thing that actively *makes* a match** —
   they are the automated "cut".
3. **Extend `sim/`.** Reuse the ruleset-driven engine rather than starting fresh. Demo 1
   (`engine.js` / `demo.html`) stays untouched for fidelity; the climb is a sibling module
   (see "Build approach").
4. **Per-fall-step decay.** Each gem has a randomized life; **every cell it falls burns one
   life**; at 0 it breaks and is lost. This single mechanism produces the "richer the more
   up you go" gradient and the "close to Glitterdelve, most gems aren't making it" problem.

## The fiction

You're the new Wall Organizer at Glitterdelve, at the bottom of a vast vertical shaft. Gems
rain down from far above. The old hands harvest whatever lands in the light, but this deep,
almost nothing survives the fall — the harvest is sporadic. Your job is to build the wall up
the shaft so the gems make it, climbing toward the Source until you see what's been raining
gems on you.

## Board & camera

- A **tall, finite shaft**: `WORLD_ROWS ≈ 80` (the "predefined number"), `COLS = 9`.
  Glitterdelve is the bottom row (`y = WORLD_ROWS-1`); the **Source** is row 0.
- Gravity is **down toward Glitterdelve** — the same direction the engine already uses
  (`y` increases downward), so the gravity core is reused, not rewritten.
- The view is a scrolling **window** of `VIEW_ROWS ≈ 14` rows that follows the light
  frontier upward. Play starts at the bottom looking at sparse, dying gems. The camera is a
  pure front-end concern (a row offset into the world grid); the engine has no camera.

## The light (bottom-anchored rising frontier)

- Light fills a **full-width band from the floor up to `frontierRow`**. A cell `(x,y)` is
  lit iff `y >= frontierRow`. This replaces demo 1's per-column, top-down `litCols` /
  `lightReach` model with a single rising frontier — simpler, and it matches "we *are* the
  light at the bottom."
- **Only matches whose cells are in the light harvest energy.** Matches above the frontier
  (in the dark) do nothing. Dark gems are still **rendered (dimmed)** so the player can plan
  routes through them.
- `frontierRow` starts near the bottom (`WORLD_ROWS-1 - baseReach`, `baseReach ≈ 4`) and
  **decreases (rises) by 1 row per lit match**. Reaching `frontierRow == 0` reveals the
  Source → win.
- **Lenses** extend the lit band a few rows *above* the current frontier in their own
  column (`lensReach ≈ 4`), letting you reach an early pocket of richer gems. They are
  **fragile** (see Tools).

## Core loop

```
Source (row 0) emits a curtain of gems each tick across the width
        │  gems fall; each fall-step burns 1 life (life randomized at spawn)
        ▼  most die mid-fall → near the floor only sporadic survivors remain
Your structures route survivors into 3+ alignments inside the light
        │  Walls/Slopes/Splitters shape the stream; Swappers snap alignments into matches
        ▼
Lit match → energy (3 gems→3, 4→6, 5→12) → frontier rises one row
        │  higher frontier meets the denser, less-decayed stream → richer options
        ▼  snowball upward …
frontierRow == 0 → Source revealed → win
```

The difficulty gradient is **emergent from decay alone**: a low frontier means a long fall,
heavy attrition, and sporadic matches; climbing is the relief and is self-reinforcing. The
arc is: hard, starved opening → build routing → catch the denser supply higher → snowball to
the reveal.

## Tools

Built on the existing generic tool registry (`rules.js → TOOLS`); the engine dispatches by
capability, and the front-end toolbar is generated from the list, so new tools "just appear".

| Tool | Cost | Behavior | Engine hook |
|---|---|---|---|
| **Bomb** | free | destroy one gem (oopsies / break a jam) | `kind:'action'`, payload targets a cell |
| **Wall** | 3 | gems pile on top; hold a platform in the light | `blocksFall` (existing `dam`) |
| **Slope** | 3 | push **every** gem one direction (steer streams, shield lenses) | `divert` + new `always:true` |
| **Splitter** | 6 | push **every other** gem aside (split/balance a stream) | `divert` (existing `split`/Fork) |
| **Swapper** | 6 | swap two gems across a seam **iff the swap makes a match** | `tick` swap-on-match (existing `swap`/Sorter) |
| **Lens** | 9 | relay light upward `lensReach` rows; **breaks when a gem hits it**; does **not** block fall | `extendsLight` + new `fragile:true` |

Notes:
- **Swappers are the primary match-maker.** With no manual Cut, Slopes/Splitters/Walls
  *align* the stream and Swappers *fire* the match. This is the heart of the puzzle.
- **Slope vs Splitter:** Slope diverts *every* gem (no alternation); Splitter (Fork)
  alternates straight/aside. Slope is modeled as a divert piece with `always:true` so the
  gravity diverter path is reused without toggling `flip`.
- **Lens fragility is intentional friction.** A lens relays light but the next gem to fall
  through its seam destroys it (the gem continues falling; the lens is removed and the light
  map is invalidated). To keep a lens alive you must route gems around it (Walls/Slopes
  above it) — that layered protection is the intended depth. Flagged as possibly *too*
  fragile; revisit in tuning.

## Economy & scoring

- **One currency: energy.** Harvested energy is both the **score** and the **build budget**;
  placing a structure spends it (Bombs are free). The HUD shows **total harvested** (the
  headline score) and the **spendable balance** (harvested − spent).
- Spending-to-build is the real tension (it makes demo 1's "efficiency" objective into a
  live decision).
- **Scoring is super-linear:** 3 gems = 3, 4 gems = 6, 5 gems = 12. Bigger matches pay off,
  rewarding setups over trickles.
- **Starting grant ≈ 9 energy** so the player can place a first structure or two and
  bootstrap the harvest.

## Decay

- Each spawned gem gets a randomized **life** (≈ `6–14` fall-steps) drawn from the seeded
  RNG (deterministic).
- **Every fall-step decrements life.** When life would hit 0, the gem breaks: the cell
  clears and a "lost to the dark" counter increments (reuse demo 1's accounting).
- Stored as a **parallel `life` grid** alongside the color `grid`. Life moves with the gem
  on every fall/divert and is cleared when the cell empties (match, bomb, break, harvest).
- A near-dead gem reuses demo 1's existing **fade telegraph** (translucent + dim overlay) so
  imminent loss is readable.

## Build approach (how it extends `sim/`)

Recommended: **a sibling climb module**, keeping demo 1 untouched.

- `engine.js` and `demo.html` are **not modified** — fidelity of the first game is preserved.
- A new `sim/climb-engine.js` **imports the shared pure helpers** from `engine.js`
  (`matchesAt`, `allMatches`, `spawnColor`, `inBounds`, `canRest`, geometry) and implements
  only what differs: the **frontier light model**, **decay gravity** (with the `life` grid,
  `slope`/`always` diverts, and `fragile` lens breakage), the **curtain spawn**, and
  **harvest → raise frontier + award energy**. It exposes a `tick(state)` and the same kind
  of `createState` / `snapshot` surface as `engine.js`.
- New tools (`bomb`, `slope`) and a **`climb` ruleset** (with `WORLD_ROWS`, `baseReach`,
  `lensReach`, decay range, costs, scoring) are added to `rules.js` without disturbing
  `DEFAULT_RULES`.
- `rng.js` is reused as-is. `render.js` gains a climb-aware draw path (camera row offset,
  frontier band, dimmed dark gems, Bomb/Slope glyphs, lens fragility cue) reusing the
  existing gem/piece drawing.

Rejected alternative: branching `engine.js` on `rules.mode === 'climb'`. One file, but it
turns the clean demo-1 engine into conditionals and risks its fidelity.

## Proposed files

- `sim/climb-engine.js` — new: climb tick pipeline (frontier light, decay gravity, curtain
  spawn, harvest→raise), reusing shared helpers from `engine.js`.
- `sim/climb.js` + `sim/climb.html` — new front-end, mirroring `play.js` / `play.html`:
  scrolling camera, economy HUD (total + balance + lost), toolbar from the registry, the
  Source reveal on win.
- `sim/rules.js` — small additions: `bomb` and `slope` tool entries; a `climb` ruleset /
  `makeClimbRules` builder with the new scalars (does not change `DEFAULT_RULES`).
- `sim/render.js` — small additions: climb draw path (camera offset, frontier band, dim dark
  gems, new glyphs, fragile-lens cue).

## Defaults (all tunable)

`WORLD_ROWS ≈ 80`, `COLS = 9`, `VIEW_ROWS ≈ 14`, `baseReach ≈ 4`, `lensReach ≈ 4`,
frontier rises **1 row per lit match**, gem life **6–14** fall-steps, costs Bomb 0 / Wall 3 /
Slope 3 / Splitter 6 / Swapper 6 / Lens 9, scoring 3→3 / 4→6 / 5→12, starting grant ≈ 9.

## Scope

**In this pass:** inverted frontier light, per-fall decay, the six tools, single-currency
energy economy, harvest-raises-frontier climb, scrolling camera, finite shaft with a Source
reveal on reaching the top.

**Deliberately deferred:** CLI / optimizer (`runner.js`, `optimize*`) integration for the
climb mode; sound; fine balance tuning; elaborate Source art (a simple reveal for now).

## Open points to confirm during review

- Single-energy-currency (score == budget) vs a separate vanity score.
- Lens fragility breaking on *any* gem contact — intended friction, but possibly too harsh.
- Whether the Source reveal needs more than a placeholder for this demo.

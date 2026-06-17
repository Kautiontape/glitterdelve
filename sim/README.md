# Glitterdelve — Simulation Harness

A headless, **deterministic**, ruleset-driven reimplementation of the Glitterdelve
game logic, plus two front-ends that share it:

- a **Node CLI** for running hundreds/thousands of games across strategies and seeds, and
- a **zero-build web viewer** to launch runs, see a gallery of every game's final board, and
  step-replay any game's decisions.

It lives in its own folder. The live game (`../demo.html`, `../index.html`) is **not**
touched — this is a separate "version" for experimentation, as requested. The engine is
structured so the real game *could* later be migrated onto it, but that's not done here.

No build, no dependencies. Plain ES modules that run directly in Node and the browser.

## Layout

| file | env | what |
|------|-----|------|
| `rng.js` | pure | seedable PRNG (reproducible games) |
| `rules.js` | pure | **default ruleset + tool registry** (the source of truth) |
| `engine.js` | pure | game state + deterministic tick pipeline (faithful to `demo.html`) |
| `strategies.js` | pure | agent API + built-in strategy registry |
| `runner.js` | pure | `runGame` / `runBatch` / aggregation / objective / replay |
| `cli.js` | node | the CLI |
| `selftest.js` | node | engine invariant tests |
| `render.js` | browser | canvas drawing (ported from `demo.html`) |
| `ui.js` + `index.html` | browser | the web viewer |

`rng/rules/engine/strategies/runner` are DOM-free and shared by both front-ends, so a
rule or tool change updates the CLI and the viewer at once.

## Run the CLI

```sh
node cli.js                                   # 3 strategies, 50 games each
node cli.js -s greedyCut,noop -g 200 -t 2000  # strategies, games, ticks
node cli.js -s autoSorters,greedyCut --seeds 1-500
node cli.js -o survival                        # objective preset
node cli.js -w collected=1,lostToDark=-0.5     # custom objective weights
node cli.js --rules myrules.json --json out.json
node cli.js --list                             # list strategies + presets
node cli.js --help
```

`node selftest.js` runs the invariant checks (also `npm test`).

## Run the web viewer

There is no build. Serve the repo root and open the `sim/` page:

```sh
cd ..              # repo root (so ../favicon.svg resolves)
python3 -m http.server 8777
# open http://localhost:8777/sim/
```

Pick strategies, batch size, objective weights, and a few rule knobs, then **Run**. You get
a ranked table, a gallery of every game's final board (click one to replay it tick-by-tick
with the agent's decisions overlaid), and a "note" button to pin games (stored in
`localStorage`). Big sweeps run chunked/async so the tab stays responsive; for very large
sweeps (thousands), use the CLI.

## Concepts

**Determinism.** Every game is driven by a seeded RNG, so `(rules, strategy, seed)` always
produces the same result. That makes strategy comparison meaningful and lets a replay be
stored as a tiny **recipe** `{rulesOverride, strategyId, config, seed, maxTicks}` and
re-run on demand instead of storing per-frame data.

**Metrics** (tracked for every game): `collected` (gems cut), `lostToDark`, `litFinal` /
`litPeak` (columns lit), `piecesTotal` (and per-tool), `ticks`.

**Objective** ("all metrics, configurable"). The rank score is a weighted sum of metrics.
Costs use negative weights. Presets in `runner.js → OBJECTIVE_PRESETS`:
`score` `{collected:1}`, `survival` `{columnsLit:10,lostToDark:-1}`,
`efficiency` `{collected:1,pieces:-5}`, `clean` `{collected:1,lostToDark:-0.5}`.

## Extending

### Add or change a tool
Add an entry to `TOOLS` in `rules.js`. Declare which simulation phase it hooks via
capability flags/methods — the engine dispatches generically, and the web toolbar/gallery
pick it up automatically:

- `blocksFall: true` — gems can't fall through the seam above its cell (Wall, Lens)
- `extendsLight: {reach:N}` or `{rule:'ampReach'}` — relays light downward (Lens)
- `tick(state, ownPieceMap, H)` — runs each tick in the `machines` phase (Sorter)
- `divert: true` + `seam:'cell'` — diverts every other falling gem; payload `{dir,flip}` (Fork)
- `kind:'action'` — not placed; the agent invokes it (Cut → `{type:'swap',a,b}`)
- `validate(state, pos, H)` — placement legality; `H` is the engine helper bundle

### Change the rules
Pass scalar overrides anywhere a ruleset is built (`cols, rows, ncol, baseReach, anchor,
ampReach, tickOrder`): CLI `--rules file.json`, the web "Rules" panel, or
`makeRules({...})`. Overrides are plain JSON so they serialize into recipes.

### Add a strategy
Add an entry to `STRATEGIES` in `strategies.js`: `factory(config)` returns `{ act(state, api) }`
returning an array of actions. `api` gives a separate seeded `rng`, the `rules`, and read
helpers (`findMatchingSwaps`, `isLit`, `lightReach`). It then appears in the CLI
(`--strategies`) and the web viewer automatically. The shipped ones (`noop`, `greedyCut`,
`autoSorters`, `staticBuild`, `randomCut`) are intentionally simple baselines to beat.

## Optimizing builds

Beyond hand-written strategies, the harness can *search* for the best static
whole-board layout (no cutting) that maximizes mean points over X seeds of T
ticks. A "build" is just a `staticBuild` plan, so any winner replays in the viewer.

```sh
node optimize-cli.js                    # all methods, defaults
node optimize-cli.js -m pattern -t 1000 -n 24   # dense full-board tiling
node optimize-cli.js --quick            # fast
node optimize-cli.js -m all --json best.json
```

Or use the **Optimize a build** panel in the web viewer (runs in a Web Worker
with a live best-score sparkline; the winner gets a thumbnail + replay button).

**Evaluator (`evaluateBuild`)** scores a layout with **common random numbers** —
every candidate is run on the *same* seed set, so "build A > build B" is a
low-variance comparison rather than RNG luck. This matters more than the choice
of optimizer.

**Methods** (`optimize.js`):
- `ga` / `sa` — a genetic algorithm and simulated annealing over the **complete
  space** (every tool, every cell, the anchor included). These are the *drivers*:
  they can reach — and beat — any structure. Run alone they start **cold** (random
  init), which is the honest test of what emerges from scratch.
- `pattern` — generates a dense full-board layout from a few parameters (fork
  density + direction, sorter density, lens row-spacing) and tunes them. It's a
  **fast hypothesis / seed**, not the answer: it lights 9/9 cheaply, but seeded GA
  beats it (see below). Tiny genome.
- `greedy` — constructive beam search with racing. Good for *sparse / efficient*
  builds; boxed to a region (colSpan), so a sparse hypothesis, not a 9/9 build.
- `all` — the recommended driver: runs `pattern` and `greedy` as cheap
  hypotheses, then a **full-board GA seeded with both** (free to mutate away),
  then SA polishes the leader. The winner comes from search over the complete
  space, not from a prescribed template.

### Proving builds, not prescribing them

A real risk with a generative `pattern`: it only searches *within* a hand-designed
template, so it can confirm its own assumptions and miss the true optimum. Guard
against it by keeping the **search space complete** and putting bias only in
*seeding* — then verify with general search:

- **Does the structure emerge?** Run `node optimize-cli.js -m ga -t 600 -n 8`
  (cold, full board, anchor available). In testing, cold GA independently learned
  to keep the anchor column clear (~2 pieces in it vs a prescribed ~11) and
  favored dense sorters/lenses — corroborating those choices *through the process*.
- **Is the seed beatable?** `-m all` seeds GA with the pattern; it climbed ~30%
  past it (1100 vs 842 on one 600-tick/8-seed run). So the pattern is a good seed,
  not a ceiling.
- **Honest caveat:** cold search did *not* match a good seed from scratch within a
  modest budget — the fitness landscape is deceptive (one piece rarely helps; you
  need ~90 in concert). That's a search-difficulty fact, not a representation
  limit, and it's exactly why seeding the complete-space search is the right move.

**Two mechanical facts the search surfaced** (worth knowing for game design):
- The **anchor column must stay a clear chute** — a lens dams it and a fork
  diverts it, which kills the heartbeat harvest (score → ~0). The `pattern`
  generator keeps the anchor clear of lenses/forks for this reason.
- **Lenses are load-bearing for spreading**: gems forked into a shallow
  non-anchor column fall past the light and are lost, so you must deepen the
  light (lenses) before/while routing gems outward. Sorters + lenses (almost no
  walls) is the meta — matching what dense human builds look like.

The build is the interpretable strategy; the future "expand over time" phase
maps onto the same evaluator (the genome grows from a set of placements to a
sequence of trigger→place rules).

## Fidelity note

The engine is a faithful port of `demo.html`'s rules (same tick order
`machines → resolve → gravity → spawn → resolve`, same light/match/score/ignite logic). Two
deliberate differences, both for headless reproducibility: randomness comes from the seeded
RNG (not `Math.random`), and the fading-then-lost state is a flag rather than a wall-clock
timestamp. One incidental correctness fix: the anchor heartbeat's spawn-color call uses the
correct `(col,row)` cell (`demo.html` passed swapped args, affecting only which color the
anchor emits, never the mechanics).

## The Climb (demo 2)

A second, inverted demo built on the same engine primitives. Glitterdelve sits at
the **bottom**; gems rain down and **decay** (each fall-step burns one life), so few
survive the long drop — the harvest is sporadic. You're the Wall Organizer: a **pure
builder** (no manual Cut) who deploys structures to route gems into matches inside a
light band that **rises** as you harvest, climbing a tall shaft to the Source.

- **Play:** serve the repo root and open `sim/climb.html` (`python3 -m http.server 8777`
  from the repo root, then `http://localhost:8777/sim/climb.html`). Ruleset lives in the
  URL (`?rows=60&seed=3&...`). Live state is on `window.__climb` for console tinkering.
- **Tools:** Bomb (free, destroy a gem), Wall (3, blocks fall), Slope (3, diverts every
  gem), Splitter (6, diverts every other), Swapper (6, swap-on-match — your matcher),
  Lens (9, relays light upward but breaks when a gem hits it).
- **Economy:** one currency — harvested energy is both score and build budget. Scoring is
  super-linear: 3 gems = 3, 4 = 6, 5 = 12. The floor drains unmatched gems for nothing.
- **Code:** `climb-engine.js` (headless, deterministic, reuses `engine.js` helpers),
  `climb.js` + `climb.html` (front-end), climb ruleset/tools in `rules.js`, `drawClimb`
  in `render.js`. Tests: `node climb-selftest.js` (or `npm run climbtest`). Demo 1
  (`engine.js`/`demo.html`) is untouched.

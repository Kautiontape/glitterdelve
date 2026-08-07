# Glitterdelve — The Climb (demo 2) redesign

**Date:** 2026-06-17
**Goal:** Resolve the glitches and rebuild the loop so a player thinks *"this is
legitimately fun, not frustrating, and I want to keep doing it."* Scope is the
climb layer only (`climb-engine.js`, `climb.js`, `climb.html`, the climb parts of
`rules.js` / `render.js`, `climb-selftest.js`). Demo 1 (`engine.js`/`demo.html`) is
untouched.

## What was wrong (observed by playing it)

- 0 harvested / **806 gems lost** in 177 idle ticks: the dark eats everything and
  the economy can't recover.
- One Lens lights the **whole width** (`lightCeiling` is a single world row).
- **Slopes stall**: a slope lives in a cell and only diverts a gem the tick after
  it lands in the cell, and only if the diagonal is free — never in a crowd.
- Decay is invisible (one 220ms tick before death) → "what just happened?"
- Too fast (220ms), too crowded (9×20 at 0.4 init + 0.5 spawn), economy upside
  down (Swapper 6 vs a lit triple paying 3), drag-to-place, no build affordance,
  misclick burns energy with no refund.

## Core design (decided with the user)

**Routing IS the matcher.** No swapper, no clicking matches. The player builds a
machine (ramps, color sorters, conveyors, walls) that herds like-colored gems into
a lit column until they pile 3+ and pop on their own. "Cost to spread" = more
machine to build.

**Three-tier light, per column.** Each column has its own light height.
- **Dark** (top): gems fall and decay here, **invisible** — the "where's it coming
  from" mystery. Gems appear *out of* the dark.
- **Dim** (a few rows above bright): visible; **you can build here**; resting gems
  decay (with a settle beat + crack animation).
- **Bright** (bottom band + each column's fed lenses): gems are **safe (never
  decay)** and **matches score here**. Bright gems glow as "prime."

The jagged bright/dim line across columns is the build-zone + climb readout.

**Decay = the settle beat (the user's model: "sit for a moment, then break").**
- Falling gems **never** decay — a gem raining straight down reaches the safe base
  band and piles. (No more "floating down forever" deaths.)
- A gem that comes to **rest** in a non-bright cell sits for `settle` ticks, then
  visibly **cracks** over `crack` ticks, then shatters (lost++). Bright = safe,
  resets the timer. So the low board is reliable income; the high climb is where
  gems die unless you light your machine.

**Floor drain (added during balance testing — the key "not frustrating" fix).**
Without it, every column fills its short bright band and then overflows into the
dim and dies wholesale — the original "void wins" frustration in a new outfit
(measured: ~80% of gems lost). Fix: Glitterdelve **absorbs** the bottom gem of any
column whose contiguous pile pokes above its bright ceiling. Columns cap at the
brim of the light and the base is calm and self-clearing; **loss only happens for
gems parked unlit on a raised structure** (your machine), which is fair and
fixable. `floorHarvest` (default 0) optionally trickles energy per absorbed gem.
Verified in `climb-balance.js`: no-build now loses 0 to the dark while harvesting
passively, so you build to *climb*, not to *survive*.

**Light & lenses, per column.** Base bright band = bottom `baseReach` rows (all
columns). A Lens on column x's seam, when *fed* (its lower cell is bright), raises
**that column's** bright ceiling by `lensReach` and chains. A lens is a **sturdy
relay** — gems fall straight through it — and it only works at the column's current
bright edge (the one "fed" seam), so that's the single legal spot: you climb a
column rung by rung. (Earlier the lens was *fragile* + the column above it was dark
and unbuildable, so the rain broke every lens and the climb was impossible — caught
in playtesting and changed to sturdy.)

**Win:** light the **whole shaft** — every column's bright ceiling reaches the
Source (`litColumns(state) === cols`). One column is trivial (~4 clicks); lighting
all nine is a ~2.5-minute snowball goal (more light → more of the board pops → more
income → more climbing) and a real climax (the dark void recedes, the Source is
revealed).

## Tools (six)

| id | name | shape | cost | effect |
|----|------|-------|------|--------|
| `bomb` | Bomb | action | 0 | destroy one gem (jams, mistakes) |
| `dam` | Wall | horizontal seam | 2 | blocks fall; gems pile on top |
| `ramp` | Ramp | cell wedge (dir) | 2 | a gem entering from above is deflected to (x±1) beside it as it falls; never stalls, chains into staircases |
| `sorter` | Color Sorter | cell filter (target color + reject dir) | 5 | the target colour drops **straight through** into the lane below; every other colour is kicked aside to (x+dir) — one sorter over a column makes a pure-colour lane |
| `conveyor` | Conveyor | cell tag (dir) | 3 | a *resting* gem on it slides one cell/tick toward its arrow, feeding a collection column |
| `amp` | Lens | horizontal seam | 8 | sturdy relay; raises its column's bright ceiling by `lensReach`, only at the fed edge (climb rung by rung) |

The **ramp** is a solid wedge (gems can't rest inside; it deflects on entry — the
fix for "slopes don't work"). The **sorter** is a non-solid colour filter (gems flow
through it). Conveyor is a floor tag: a gem rests on it (needs support below) and is
carried sideways in the machines phase.

**Design note (from playtesting):** "routing is the *sole* matcher" did not pay off —
on a wide, abundant board the random base auto-matches efficiently, so concentrating
colours actually *lowered* total score. The fun loop landed as: a **lively, calm base**
that sprees passively (income, zero flood-frustration thanks to the floor drain) **plus
the climb** as the active, snowballing goal. Sorters/ramps/conveyors are optional
shaping tools (build a pure-colour lane for big combos, divert a flow), not a required
survival mechanic.

## Interaction (no dragging)

- Select a tool → ghost preview follows the cursor → **single left-click to place**.
- Directional pieces place with a default arrow; **left-click an existing piece to
  cycle it** (ramp/conveyor flip direction; sorter cycles target color).
- **Right-click any piece to remove it — full refund** (kills the misclick tax).
  Energy is only lost when gameplay destroys a piece (a Lens breaking).
- **Placement dots** light up valid cells/seams when a tool is selected, and only
  in buildable (dim+bright) cells — so the dots double as the "where can I build"
  signal.
- Seam tools snap to the nearest horizontal grid line of the hovered cell.

## Economy & feel

- Start with enough to build a starter machine (`startGrant` ~30).
- Cheap structures, Lens as the premium climb sink (see table).
- Super-linear payout (`3→3, 4→8, 5→20`, then `+8`/extra) **plus a combo
  multiplier**: each consecutive tick that pops a lit run raises the multiplier
  (×1→×2→… capped), reset by a quiet tick. This is the "spree, watch the numbers
  climb" the user liked, made into a system. Only **bright** runs score.
- Pace: tick ~480ms. Start the shaft **empty** and let it rain in (so you grasp
  the source); calmer spawn density (~0.22).
- Numbers are tuned against a headless balance sim before shipping (base harvest
  must be net-positive; a lens ladder must be affordable).

## Files

- `rules.js` — `CLIMB_TOOLS` (6 above), `CLIMB_RULES` (final tuned: cols 9, rows 16,
  view 16, ncol 5, baseReach 5, dimBand 3, lensReach 3, settle 3, crack 4,
  floorHarvest 0, comboCap 4, spawnDensity 0.12, startGrant 30, tickMs 480,
  scoring 3→4 / 4→10 / 5→24 then +8/extra, costs bomb 0 / wall 2 / ramp 2 /
  sorter 5 / conveyor 3 / lens 8).
- `climb-engine.js` — per-column `brightCeiling`/`dimCeiling`/`zoneAt`,
  `stepConveyors`, `resolveClimb` (combo mult, bright-only score), wedge gravity
  with ramp/sorter divert, `decayClimb` (rest-based settle→crack), `placeClimb`/
  `removeClimb` (refund) / `adjustClimb` (cycle) / `bombClimb`, win check.
- `render.js` `drawClimb` — three-tier per-column backgrounds, dark gems hidden,
  prime glow, crack overlay, new glyphs, dots+ghost overlay.
- `climb.js` — no-drag input, ghost/dots, HUD with combo, no camera scroll.
- `climb-selftest.js` — rewritten invariants; `climb-balance.js` quick sim.

## Out of scope

- Demo 1, the CLI/optimizer harness, mobile-specific input polish (right-click
  remove is desktop-first for now), networked/persisted progress.

# Glitterdelve II — "The Climb" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a second Glitterdelve demo — a calm vertical builder-puzzle where Glitterdelve sits at the bottom, gems rain down and decay, and you deploy structures to harvest matches in a light band that rises up a tall shaft toward the Source.

**Architecture:** Extend the `sim/` engine without touching demo 1. A new pure module `climb-engine.js` reuses the shared helpers from `engine.js` (`matchesAt`, `allMatches`, `spawnColor`, `inBounds`, `canRest`, `EMPTY`) and implements the climb-specific pipeline: a rising **frontier** light band, per-fall-step gem **decay** (a parallel `life` grid), a top **curtain** spawn, a floor **drain**, **harvest** scoring that raises the frontier, and an **energy** economy. New tools (`bomb`, `slope`) and a `climb` ruleset live in `rules.js`. A `drawClimb` path in `render.js` and a `climb.html`/`climb.js` front-end (mirroring `play.html`/`play.js`) add the scrolling camera, economy HUD, and Source reveal.

**Tech Stack:** Plain ES modules, no build, no deps. Node for the headless self-test; `<canvas>` for the browser front-end. Determinism via the seeded `mulberry32` RNG.

**Spec:** `docs/superpowers/specs/2026-06-17-glitterdelve-climb-design.md`

---

## File Structure

- **Create `sim/climb-engine.js`** — climb tick pipeline + state. Reuses `engine.js` helpers. One responsibility: climb simulation rules.
- **Create `sim/climb-selftest.js`** — headless invariant tests for the climb engine (mirrors `selftest.js`). Grown task-by-task.
- **Modify `sim/rules.js`** — add `CLIMB_TOOLS`, `CLIMB_RULES`, `makeClimbRules`. Does **not** touch `DEFAULT_RULES`/`TOOLS`.
- **Modify `sim/render.js`** — add `drawClimb` (+ helpers) and climb-engine imports. Existing `drawState` untouched.
- **Create `sim/climb.html`** — front-end scaffold (mirror of `play.html`).
- **Create `sim/climb.js`** — front-end controller (mirror of `play.js`) with camera, economy, win overlay.
- **Modify `sim/package.json`** — add a `climbtest` script.
- **Modify `sim/README.md`** — document the climb mode.

**Untouched (fidelity):** `engine.js`, `demo.html`, `play.js`, `play.html`, `ui.js`, `index.html`, `runner.js`, `strategies.js`, `optimize*.js`, `cli.js`.

---

## Conventions used throughout

- **Grid:** `grid[y][x]` is a color int `0..ncol-1` or `EMPTY` (`-1`). `y=0` is the top (the Source); `y=rows-1` is the bottom (Glitterdelve floor). Gravity increases `y`.
- **Life:** `life[y][x]` is the gem's remaining fall-steps (≥1 where a gem is, `0` where empty).
- **Frontier:** `state.frontier` is the topmost lit world row. A cell `(x,y)` is lit iff `y >= litCeiling(x)`, where `litCeiling` starts at `frontier` and is pushed *up* (smaller y) by lenses. Win when `frontier` reaches `0`.
- **Seam keys:** a horizontal-seam piece at key `"x,y"` sits on the seam between cell `(x,y-1)` and `(x,y)` (same as demo 1's Wall/Lens). A vertical-seam piece at `"x,y"` sits between `(x-1,y)` and `(x,y)`. A cell piece (Slope/Splitter) is keyed by its own cell `"x,y"`.

---

## Task 1: Climb ruleset and new tools

**Files:**
- Modify: `sim/rules.js` (append after the existing exports)
- Modify: `sim/package.json` (add a script)
- Create: `sim/climb-selftest.js`

- [ ] **Step 1: Append the climb ruleset and tools to `sim/rules.js`**

Add at the end of `sim/rules.js` (after `makeRules`):

```js
/* =====================================================================
   CLIMB MODE ("The Climb") — demo 2 ruleset + tool registry.
   Bottom-anchored rising light, per-fall decay, energy economy. Consumed
   by climb-engine.js / climb.js. DEFAULT_RULES/TOOLS above are untouched.
   ===================================================================== */
export const CLIMB_TOOLS = [
  { id: 'bomb', name: 'Bomb', icon: '✸', kind: 'action' }, // destroys one gem; free
  {
    id: 'dam', name: 'Wall', icon: '▬', seam: 'horizontal', blocksFall: true,
    validate: (s, p) => p.x >= 0 && p.x < s.rules.cols && p.y >= 1 && p.y < s.rules.rows,
  },
  {
    id: 'slope', name: 'Slope', icon: '◣', seam: 'cell', divert: true, always: true,
    validate: (s, p, H) => H.inBounds(s, p.x, p.y),
  },
  {
    id: 'split', name: 'Splitter', icon: '⋔', seam: 'cell', divert: true,
    validate: (s, p, H) => H.inBounds(s, p.x, p.y),
  },
  {
    id: 'swap', name: 'Swapper', icon: '⇄', seam: 'vertical', swapOnMatch: true,
    validate: (s, p) => p.x >= 1 && p.x < s.rules.cols && p.y >= 0 && p.y < s.rules.rows,
  },
  {
    id: 'amp', name: 'Lens', icon: '≣', seam: 'horizontal', extendsLight: { rule: 'lensReach' }, fragile: true,
    validate: (s, p) => p.x >= 0 && p.x < s.rules.cols && p.y >= 1 && p.y < s.rules.rows,
  },
];

export const CLIMB_RULES = {
  cols: 9,
  rows: 80,          // WORLD_ROWS — the predefined shaft height
  ncol: 6,
  baseReach: 4,      // lit rows above the floor at the start
  lensReach: 4,      // rows a Lens relays light upward
  lifeMin: 6,        // randomized gem life (fall-steps), inclusive range
  lifeMax: 14,
  initDensity: 0.45, // chance a cell is pre-filled at start
  spawnDensity: 0.55,// chance the Source emits into an empty top cell each tick
  startGrant: 9,     // starting energy
  view: 14,          // rows visible in the camera window
  costs: { bomb: 0, dam: 3, slope: 3, split: 6, swap: 6, amp: 9 },
  scoring: { 3: 3, 4: 6, 5: 12 }, // energy per lit run of N gems
  tickOrder: ['machines', 'resolve', 'gravity', 'spawn', 'resolve'], // informational
  tools: CLIMB_TOOLS,
};

/* Build a climb ruleset from scalar overrides (cols, rows, baseReach, lensReach,
   lifeMin, lifeMax, initDensity, spawnDensity, startGrant, view). tools/costs/
   scoring/tickOrder fall back to the climb defaults. */
export function makeClimbRules(overrides = {}) {
  const r = Object.assign({}, CLIMB_RULES, overrides);
  r.tools = overrides.tools || CLIMB_RULES.tools;
  r.costs = overrides.costs || CLIMB_RULES.costs;
  r.scoring = overrides.scoring || CLIMB_RULES.scoring;
  r.tickOrder = overrides.tickOrder || CLIMB_RULES.tickOrder.slice();
  return r;
}
```

- [ ] **Step 2: Add a `climbtest` script to `sim/package.json`**

Change the `"scripts"` block to:

```json
  "scripts": {
    "test": "node selftest.js",
    "climbtest": "node climb-selftest.js",
    "sim": "node cli.js"
  },
```

- [ ] **Step 3: Create `sim/climb-selftest.js` with the ruleset test (failing import)**

```js
/* Climb-engine invariant checks. Run: node climb-selftest.js
   Exits non-zero on any failure. Mirrors selftest.js for the climb mode. */
import { makeClimbRules, CLIMB_TOOLS } from './rules.js';
import {
  createClimbState, tickClimb, stepGravityClimb, resolveClimb, stepSwappersClimb,
  stepSpawnClimb, placeClimb, removeClimb, bombClimb, costOf, isLit, litCeiling, EMPTY,
} from './climb-engine.js';
import { allMatches } from './engine.js';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
function approx(name, a, b) { ok(`${name} (${a} === ${b})`, a === b); }

console.log('Glitterdelve CLIMB self-test\n');

/* 1. ruleset shape */
{
  const R = makeClimbRules();
  approx('climb has 6 tools', R.tools.length, 6);
  ok('bomb is a free action', R.tools[0].id === 'bomb' && R.tools[0].kind === 'action' && R.costs.bomb === 0);
  ok('lens (amp) does not block fall and is fragile', !R.tools.find((t) => t.id === 'amp').blocksFall && R.tools.find((t) => t.id === 'amp').fragile === true);
  ok('slope diverts every gem (always)', R.tools.find((t) => t.id === 'slope').always === true);
  ok('overrides apply (rows)', makeClimbRules({ rows: 40 }).rows === 40);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 4: Run the test to verify it fails (climb-engine missing)**

Run: `cd sim && node climb-selftest.js`
Expected: FAIL — `Cannot find module './climb-engine.js'` (the import throws).

- [ ] **Step 5: Create a minimal `sim/climb-engine.js` stub so the import resolves**

```js
/* =====================================================================
   GLITTERDELVE CLIMB ENGINE (demo 2) — headless, deterministic.
   Bottom-anchored rising light, per-fall-step decay, energy economy.
   Reuses the pure helpers from engine.js; engine.js/demo.html untouched.
   ===================================================================== */
import { mulberry32 } from './rng.js';
import { matchesAt, allMatches, spawnColor, inBounds, canRest, EMPTY } from './engine.js';

export { EMPTY, inBounds };

// Filled in by later tasks:
export function createClimbState() { throw new Error('not implemented'); }
export function tickClimb() { throw new Error('not implemented'); }
export function stepGravityClimb() { throw new Error('not implemented'); }
export function resolveClimb() { throw new Error('not implemented'); }
export function stepSwappersClimb() { throw new Error('not implemented'); }
export function stepSpawnClimb() { throw new Error('not implemented'); }
export function placeClimb() { throw new Error('not implemented'); }
export function removeClimb() { throw new Error('not implemented'); }
export function bombClimb() { throw new Error('not implemented'); }
export function costOf() { throw new Error('not implemented'); }
export function isLit() { throw new Error('not implemented'); }
export function litCeiling() { throw new Error('not implemented'); }
```

- [ ] **Step 6: Run the test to verify Task 1 passes**

Run: `cd sim && node climb-selftest.js`
Expected: PASS — the 5 ruleset checks under "1. ruleset shape" print `✓`. (Later tasks add more checks; they don't exist yet.)

- [ ] **Step 7: Commit**

```bash
cd sim && git add rules.js package.json climb-selftest.js climb-engine.js
git commit -m "climb: ruleset, tools, and engine scaffold"
```

---

## Task 2: Climb state + pre-fill (no free matches)

**Files:**
- Modify: `sim/climb-engine.js`
- Modify: `sim/climb-selftest.js`

- [ ] **Step 1: Add the state/pre-fill test to `sim/climb-selftest.js`**

Insert this block immediately before the final `console.log(...)`/`process.exit(...)` lines:

```js
/* 2. createClimbState: deterministic shape, no free matches, frontier + grant set */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 7);
  ok('grid is rows x cols', s.grid.length === R.rows && s.grid[0].length === R.cols);
  ok('life grid mirrors the gem grid', s.life.length === R.rows && s.life[5].length === R.cols);
  ok('starting energy is the grant', s.energy === R.startGrant);
  ok('total harvested starts at 0', s.harvested === 0);
  approx('frontier starts baseReach above the floor', s.frontier, R.rows - 1 - (R.baseReach - 1));
  ok('pre-fill leaves no free matches', allMatches(s).size === 0);
  let gems = 0; for (let y = 0; y < R.rows; y++) for (let x = 0; x < R.cols; x++) if (s.grid[y][x] !== EMPTY) gems++;
  ok('pre-fill placed some gems', gems > 0);
  ok('every gem has positive life', (() => { for (let y = 0; y < R.rows; y++) for (let x = 0; x < R.cols; x++) { if (s.grid[y][x] !== EMPTY && s.life[y][x] < 1) return false; } return true; })());
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sim && node climb-selftest.js`
Expected: FAIL — `createClimbState` throws `not implemented`.

- [ ] **Step 3: Implement state + pre-fill in `sim/climb-engine.js`**

Replace the `createClimbState` stub with the real implementation, and add the private helpers above it (place these after the imports/`export { EMPTY, inBounds };` line):

```js
/* ---- gem cell helpers (keep grid + life in lockstep) ---- */
function clearGem(state, x, y) { state.grid[y][x] = EMPTY; state.life[y][x] = 0; }
function moveGem(state, fx, fy, tx, ty, newLife) {
  state.grid[ty][tx] = state.grid[fy][fx];
  state.life[ty][tx] = newLife;
  state.grid[fy][fx] = EMPTY; state.life[fy][fx] = 0;
}
function randLife(state) {
  const R = state.rules;
  return R.lifeMin + Math.floor(state.rng() * (R.lifeMax - R.lifeMin + 1));
}
/* Pre-fill the shaft bottom-up so spawnColor's downward look-ahead prevents any
   standing matches at t=0. Each placed gem gets a randomized life. */
function prefill(state) {
  const R = state.rules;
  for (let y = R.rows - 1; y >= 0; y--)
    for (let x = 0; x < R.cols; x++) {
      if (state.rng() < (R.initDensity || 0)) {
        state.grid[y][x] = spawnColor(state, x, y);
        state.life[y][x] = randLife(state);
      }
    }
}
```

Replace the `createClimbState` stub with:

```js
export function createClimbState(rules, seed, opts = {}) {
  const R = rules;
  const grid = [], life = [];
  for (let y = 0; y < R.rows; y++) { grid.push(new Array(R.cols).fill(EMPTY)); life.push(new Array(R.cols).fill(0)); }
  const pieces = new Map();
  for (const t of R.tools) if (t.kind !== 'action') pieces.set(t.id, new Map());
  const state = {
    rules: R, grid, life, pieces,
    frontier: Math.max(0, R.rows - 1 - (R.baseReach - 1)), // topmost lit row at start
    energy: R.startGrant != null ? R.startGrant : 9,
    harvested: 0, spent: 0, lost: 0, won: false, ticks: 0,
    rng: mulberry32((seed | 0) >>> 0),
    events: opts.record ? { popping: [], broke: [] } : null,
  };
  prefill(state);
  return state;
}
```

- [ ] **Step 4: Run the test to verify Task 2 passes**

Run: `cd sim && node climb-selftest.js`
Expected: PASS — all of "1." and "2." print `✓`.

- [ ] **Step 5: Commit**

```bash
cd sim && git add climb-engine.js climb-selftest.js
git commit -m "climb: state + bottom-up pre-fill with no free matches"
```

---

## Task 3: Frontier light (litCeiling / isLit / lens extension)

**Files:**
- Modify: `sim/climb-engine.js`
- Modify: `sim/climb-selftest.js`

- [ ] **Step 1: Add the light test to `sim/climb-selftest.js`**

Insert before the final `console.log`/`process.exit`:

```js
/* 3. frontier light: bottom band + a lens pushes the lit ceiling upward */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 1);
  const x = 3, f = s.frontier;
  ok('cell at the frontier is lit', isLit(s, x, f));
  ok('cell one row above the frontier is dark', !isLit(s, x, f - 1));
  approx('litCeiling equals the frontier with no lenses', litCeiling(s, x), f);
  // place a lens on the seam whose lower cell (x,f) is lit -> relays light up lensReach rows
  placeClimb(s, 'amp', { x, y: f });
  approx('lens raises the lit ceiling by lensReach', litCeiling(s, x), Math.max(0, f - R.lensReach));
  ok('a cell within the lens relay is now lit', isLit(s, x, f - 1));
  ok('a neighbouring column is unaffected', litCeiling(s, x + 1) === f);
}
```

(This relies on `placeClimb` from Task 7; to keep tasks runnable in order, this step also sets the lens directly if `placeClimb` is not yet implemented — but since we run tasks in order, implement light now and the lens via the pieces map. Replace the `placeClimb(...)` line above with the direct form so this task is self-contained:)

```js
  s.pieces.get('amp').set(x + ',' + f, true); // direct placement (placeClimb arrives in Task 7)
```

So the final block is:

```js
/* 3. frontier light: bottom band + a lens pushes the lit ceiling upward */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 1);
  const x = 3, f = s.frontier;
  ok('cell at the frontier is lit', isLit(s, x, f));
  ok('cell one row above the frontier is dark', !isLit(s, x, f - 1));
  approx('litCeiling equals the frontier with no lenses', litCeiling(s, x), f);
  s.pieces.get('amp').set(x + ',' + f, true); // direct placement (placeClimb arrives in Task 7)
  approx('lens raises the lit ceiling by lensReach', litCeiling(s, x), Math.max(0, f - R.lensReach));
  ok('a cell within the lens relay is now lit', isLit(s, x, f - 1));
  ok('a neighbouring column is unaffected', litCeiling(s, x + 1) === f);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sim && node climb-selftest.js`
Expected: FAIL — `litCeiling` throws `not implemented`.

- [ ] **Step 3: Implement the light model in `sim/climb-engine.js`**

Replace the `isLit` and `litCeiling` stubs with:

```js
/* The topmost lit world row in column x. Starts at the frontier (rows >= frontier
   are lit) and is pushed UP by any fed Lens (extendsLight) in the column. A lens
   at seam s is "fed" when its lower cell (x,s) is already lit (s >= current ceil);
   it then lights up to row s - reach. Iterates so lenses can chain. */
export function litCeiling(state, x) {
  const R = state.rules;
  let ceil = state.frontier;
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of state.rules.tools) {
      const ext = t.extendsLight;
      if (!ext) continue;
      const m = state.pieces.get(t.id);
      if (!m) continue;
      const reach = ext.rule ? (R[ext.rule] || 0) : (ext.reach || 0);
      for (const key of m.keys()) {
        const ci = key.indexOf(',');
        const lx = +key.slice(0, ci), ls = +key.slice(ci + 1);
        if (lx !== x) continue;
        if (ls >= ceil) {
          const nc = Math.max(0, ls - reach);
          if (nc < ceil) { ceil = nc; changed = true; }
        }
      }
    }
  }
  return ceil;
}
export function isLit(state, x, y) {
  if (!inBounds(state, x, y)) return false;
  return y >= litCeiling(state, x);
}
```

- [ ] **Step 4: Run the test to verify Task 3 passes**

Run: `cd sim && node climb-selftest.js`
Expected: PASS — "1."–"3." all `✓`.

- [ ] **Step 5: Commit**

```bash
cd sim && git add climb-engine.js climb-selftest.js
git commit -m "climb: bottom-anchored frontier light with chainable lenses"
```

---

## Task 4: Decay gravity + floor drain

**Files:**
- Modify: `sim/climb-engine.js`
- Modify: `sim/climb-selftest.js`

- [ ] **Step 1: Add the gravity/decay/drain test to `sim/climb-selftest.js`**

Insert before the final `console.log`/`process.exit`:

```js
/* 4. gravity: gems fall one row, burn one life per step, break at 0; walls hold;
      the Glitterdelve floor drains rested gems for 0 energy */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 1);
  // clear a column to test in isolation
  for (let y = 0; y < R.rows; y++) { s.grid[y][2] = EMPTY; s.life[y][2] = 0; }
  s.grid[10][2] = 0; s.life[10][2] = 3;
  stepGravityClimb(s);
  ok('gem fell one row', s.grid[11][2] === 0 && s.grid[10][2] === EMPTY);
  approx('one life burned by the fall', s.life[11][2], 2);

  // a gem with life 1 breaks on its next fall-step (lost to the dark)
  const s2 = createClimbState(R, 1);
  for (let y = 0; y < R.rows; y++) { s2.grid[y][2] = EMPTY; s2.life[y][2] = 0; }
  s2.grid[10][2] = 0; s2.life[10][2] = 1;
  const lostBefore = s2.lost;
  stepGravityClimb(s2);
  ok('a 1-life gem breaks when it falls', s2.grid[10][2] === EMPTY && s2.grid[11][2] === EMPTY);
  approx('break increments lost', s2.lost, lostBefore + 1);

  // a Wall holds a gem in place (no fall, no life loss)
  const s3 = createClimbState(R, 1);
  for (let y = 0; y < R.rows; y++) { s3.grid[y][2] = EMPTY; s3.life[y][2] = 0; }
  s3.grid[10][2] = 0; s3.life[10][2] = 3;
  s3.pieces.get('dam').set('2,11', true); // wall on the seam below (2,10)
  stepGravityClimb(s3);
  ok('wall holds the gem', s3.grid[10][2] === 0);
  approx('held gem loses no life', s3.life[10][2], 3);

  // floor drain: a gem resting on the bottom row is consumed for 0 energy
  const s4 = createClimbState(R, 1);
  const fy = R.rows - 1;
  s4.grid[fy][2] = 0; s4.life[fy][2] = 5;
  const harvestBefore = s4.harvested;
  stepGravityClimb(s4);
  ok('floor drains the bottom-row gem', s4.grid[fy][2] === EMPTY);
  approx('floor drain yields no energy', s4.harvested, harvestBefore);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sim && node climb-selftest.js`
Expected: FAIL — `stepGravityClimb` throws `not implemented`.

- [ ] **Step 3: Implement gravity + helpers in `sim/climb-engine.js`**

Add these private helpers (place them after the `randLife`/`prefill` helpers from Task 2):

```js
/* a blocksFall tool occupying the seam BELOW cell (x,y) holds the gem up */
function blockedBelow(state, x, y) {
  const key = x + ',' + (y + 1);
  for (const t of state.rules.tools) {
    if (!t.blocksFall) continue;
    const m = state.pieces.get(t.id);
    if (m && m.has(key)) return true;
  }
  return false;
}
/* a fragile (extendsLight) piece on the seam above cell (x,y), key "x,y" */
function fragileAtSeam(state, x, y) {
  for (const t of state.rules.tools) {
    if (!t.fragile) continue;
    const m = state.pieces.get(t.id);
    if (m && m.has(x + ',' + y)) return t.id;
  }
  return null;
}
/* a diverter (Slope/Splitter) sitting in cell (x,y) */
function divertAt(state, x, y) {
  for (const t of state.rules.tools) {
    if (!t.divert) continue;
    const m = state.pieces.get(t.id);
    const p = m && m.get(x + ',' + y);
    if (p) return { tool: t, piece: p };
  }
  return null;
}
/* Move a gem one row down (straight or diagonal), burning one life. A fragile
   Lens on the destination seam breaks (and is removed); the gem still passes.
   If life runs out, the gem breaks and is lost to the dark. */
function fallInto(state, fx, fy, tx, ty) {
  const lensId = fragileAtSeam(state, tx, ty);
  if (lensId) {
    state.pieces.get(lensId).delete(tx + ',' + ty);
    if (state.events) state.events.broke.push({ x: tx, y: ty, lens: true });
  }
  const nl = state.life[fy][fx] - 1;
  if (nl <= 0) {
    clearGem(state, fx, fy); state.lost++;
    if (state.events) state.events.broke.push({ x: fx, y: fy });
    return;
  }
  moveGem(state, fx, fy, tx, ty, nl);
}
```

Replace the `stepGravityClimb` stub with:

```js
export function stepGravityClimb(state) {
  const R = state.rules;
  // drain whatever rested on the Glitterdelve floor last tick (anti-clog, 0 energy)
  for (let x = 0; x < R.cols; x++) if (state.grid[R.rows - 1][x] !== EMPTY) clearGem(state, x, R.rows - 1);

  for (let y = R.rows - 2; y >= 0; y--) {
    for (let x = 0; x < R.cols; x++) {
      const c = state.grid[y][x];
      if (c === EMPTY) continue;
      if (blockedBelow(state, x, y)) continue; // a Wall holds it (a Lens does not)
      const below = y + 1;
      const d = divertAt(state, x, y);
      const wantDir = d ? (d.tool.always ? d.piece.dir : (d.piece.flip ? d.piece.dir : 0)) : 0;

      if (wantDir !== 0) {
        const tx = x + wantDir;
        if (inBounds(state, tx, below) && canRest(state, tx, below)) {
          fallInto(state, x, y, tx, below);
          if (!d.tool.always) d.piece.flip = !d.piece.flip;
          continue;
        }
      }
      if (canRest(state, x, below)) {
        fallInto(state, x, y, x, below);
        if (d && !d.tool.always) d.piece.flip = !d.piece.flip;
      }
      // else: resting on a gem/floor — stays put, loses no life
    }
  }
}
```

- [ ] **Step 4: Run the test to verify Task 4 passes**

Run: `cd sim && node climb-selftest.js`
Expected: PASS — "1."–"4." all `✓`.

- [ ] **Step 5: Commit**

```bash
cd sim && git add climb-engine.js climb-selftest.js
git commit -m "climb: decay gravity, wall holds, floor drain"
```

---

## Task 5: Diverts (Slope every gem, Splitter alternates) + Lens fragility

**Files:**
- Modify: `sim/climb-selftest.js` (gravity helpers already cover diverts/fragility from Task 4)

- [ ] **Step 1: Add the divert + fragility tests to `sim/climb-selftest.js`**

Insert before the final `console.log`/`process.exit`:

```js
/* 5. Slope diverts EVERY gem; Splitter alternates; a falling gem breaks a Lens */
{
  const R = makeClimbRules();
  // Slope: two gems dropped through the same cell both go sideways
  const s = createClimbState(R, 1);
  for (let y = 0; y < R.rows; y++) for (const x of [2, 3]) { s.grid[y][x] = EMPTY; s.life[y][x] = 0; }
  s.pieces.get('slope').set('2,10', { dir: 1, flip: false });
  s.grid[9][2] = 0; s.life[9][2] = 9;
  stepGravityClimb(s); // gem at (2,9) -> falls to slope cell (2,10)
  stepGravityClimb(s); // at the slope -> diverts to col 3
  let onCol3 = false; for (let y = 0; y < R.rows; y++) if (s.grid[y][3] === 0) onCol3 = true;
  ok('slope diverts the gem sideways', onCol3);
  // a second gem through the same slope ALSO diverts (always)
  s.grid[9][2] = 1; s.life[9][2] = 9;
  stepGravityClimb(s); stepGravityClimb(s);
  let secondOnCol3 = false; for (let y = 0; y < R.rows; y++) if (s.grid[y][3] === 1) secondOnCol3 = true;
  ok('slope diverts the next gem too (every gem)', secondOnCol3);

  // Splitter: one straight, the next sideways
  const s2 = createClimbState(R, 1);
  for (let y = 0; y < R.rows; y++) for (const x of [5, 6]) { s2.grid[y][x] = EMPTY; s2.life[y][x] = 0; }
  s2.pieces.get('split').set('5,10', { dir: 1, flip: false });
  s2.grid[10][5] = 0; s2.life[10][5] = 9;
  stepGravityClimb(s2); // flip false -> straight to (5,11)
  const straight = s2.grid[11][5] === 0;
  s2.grid[10][5] = 1; s2.life[10][5] = 9;
  stepGravityClimb(s2); // flip now true -> divert to col 6
  let diverted = false; for (let y = 0; y < R.rows; y++) if (s2.grid[y][6] === 1) diverted = true;
  ok('splitter passes one straight then diverts the next', straight && diverted);

  // Lens fragility: a gem falling onto a lens seam removes the lens
  const s3 = createClimbState(R, 1);
  for (let y = 0; y < R.rows; y++) { s3.grid[y][4] = EMPTY; s3.life[y][4] = 0; }
  s3.pieces.get('amp').set('4,11', true); // lens seam below cell (4,10)
  s3.grid[10][4] = 0; s3.life[10][4] = 9;
  stepGravityClimb(s3);
  ok('falling gem breaks the lens', !s3.pieces.get('amp').has('4,11'));
  ok('gem passed through the broken lens', s3.grid[11][4] === 0);
}
```

- [ ] **Step 2: Run the test to verify it passes (gravity already implements this)**

Run: `cd sim && node climb-selftest.js`
Expected: PASS — "1."–"5." all `✓`. (Task 4's gravity already handles `always`, `flip`, and `fragile`; this task locks the behavior with tests.)

- [ ] **Step 3: Commit**

```bash
cd sim && git add climb-selftest.js
git commit -m "climb: lock divert (slope/splitter) and lens-fragility behavior with tests"
```

---

## Task 6: Harvest — resolve scoring, frontier rise, win

**Files:**
- Modify: `sim/climb-engine.js`
- Modify: `sim/climb-selftest.js`

- [ ] **Step 1: Add the harvest test to `sim/climb-selftest.js`**

Insert before the final `console.log`/`process.exit`:

```js
/* 6. resolve: a lit run scores per the table, awards energy, raises the frontier;
      a dark run clears but scores nothing; reaching the top wins */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 1);
  const y = R.rows - 2; // inside the lit band (>= frontier)
  for (let x = 0; x < R.cols; x++) { s.grid[y][x] = EMPTY; s.life[y][x] = 0; }
  s.grid[y][2] = 0; s.grid[y][3] = 0; s.grid[y][4] = 0; // a lit horizontal triple
  for (const x of [2, 3, 4]) s.life[y][x] = 9;
  const f0 = s.frontier, e0 = s.energy, h0 = s.harvested;
  const changed = resolveClimb(s);
  ok('resolve reports a change', changed === true);
  ok('lit triple cleared', s.grid[y][2] === EMPTY && s.grid[y][4] === EMPTY);
  approx('triple awards 3 energy', s.harvested, h0 + 3);
  approx('energy balance grows by the award', s.energy, e0 + 3);
  approx('frontier rose by one row', s.frontier, f0 - 1);

  // a quad scores 6, a quint scores 12
  const sq = createClimbState(R, 1);
  const yy = R.rows - 2;
  for (let x = 0; x < R.cols; x++) { sq.grid[yy][x] = EMPTY; sq.life[yy][x] = 0; }
  for (const x of [1, 2, 3, 4]) { sq.grid[yy][x] = 1; sq.life[yy][x] = 9; }
  const hq = sq.harvested; resolveClimb(sq);
  approx('quad awards 6 energy', sq.harvested, hq + 6);
  const s5 = createClimbState(R, 1);
  for (let x = 0; x < R.cols; x++) { s5.grid[yy][x] = EMPTY; s5.life[yy][x] = 0; }
  for (const x of [1, 2, 3, 4, 5]) { s5.grid[yy][x] = 2; s5.life[yy][x] = 9; }
  const h5 = s5.harvested; resolveClimb(s5);
  approx('quint awards 12 energy', s5.harvested, h5 + 12);

  // a dark run (above the lit ceiling) clears but scores nothing
  const sd = createClimbState(R, 1);
  const dy = 2; // near the top, well above the frontier => dark
  for (let x = 0; x < R.cols; x++) { sd.grid[dy][x] = EMPTY; sd.life[dy][x] = 0; }
  for (const x of [2, 3, 4]) { sd.grid[dy][x] = 3; sd.life[dy][x] = 9; }
  const hd = sd.harvested, fd = sd.frontier;
  resolveClimb(sd);
  ok('dark run clears', sd.grid[dy][2] === EMPTY);
  approx('dark run scores no energy', sd.harvested, hd);
  approx('dark run does not raise the frontier', sd.frontier, fd);

  // reaching the top wins
  const sw = createClimbState(R, 1);
  sw.frontier = 1;
  const wy = R.rows - 2;
  for (let x = 0; x < R.cols; x++) { sw.grid[wy][x] = EMPTY; sw.life[wy][x] = 0; }
  for (const x of [2, 3, 4]) { sw.grid[wy][x] = 4; sw.life[wy][x] = 9; }
  resolveClimb(sw);
  ok('frontier hit 0 sets won', sw.frontier === 0 && sw.won === true);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sim && node climb-selftest.js`
Expected: FAIL — `resolveClimb` throws `not implemented`.

- [ ] **Step 3: Implement resolve/harvest in `sim/climb-engine.js`**

Add this private helper (place it with the other private helpers):

```js
/* energy for a lit run of n gems, from rules.scoring; runs beyond the table
   extrapolate from the top entry (+5 per extra gem). */
function payout(state, n) {
  const sc = state.rules.scoring || { 3: 3, 4: 6, 5: 12 };
  if (n < 3) return 0;
  if (sc[n] != null) return sc[n];
  return 12 + (n - 5) * 5;
}
```

Replace the `resolveClimb` stub with:

```js
/* Clear every maximal horizontal/vertical run of length >= 3. A run with >= 3
   LIT cells harvests energy (payout by lit length) and raises the frontier one
   row; dark runs clear for hygiene but score nothing. Cells shared by an H and a
   V run clear once but score in both (a cross bonus). */
export function resolveClimb(state) {
  const R = state.rules, g = state.grid;
  const clear = new Set();
  let energy = 0, litRuns = 0;

  for (let y = 0; y < R.rows; y++) {
    let x = 0;
    while (x < R.cols) {
      const c = g[y][x];
      if (c === EMPTY) { x++; continue; }
      let xe = x; while (xe + 1 < R.cols && g[y][xe + 1] === c) xe++;
      if (xe - x + 1 >= 3) {
        let litLen = 0;
        for (let i = x; i <= xe; i++) { clear.add(i + ',' + y); if (isLit(state, i, y)) litLen++; }
        if (litLen >= 3) { energy += payout(state, litLen); litRuns++; }
      }
      x = xe + 1;
    }
  }
  for (let x = 0; x < R.cols; x++) {
    let y = 0;
    while (y < R.rows) {
      const c = g[y][x];
      if (c === EMPTY) { y++; continue; }
      let ye = y; while (ye + 1 < R.rows && g[ye + 1][x] === c) ye++;
      if (ye - y + 1 >= 3) {
        let litLen = 0;
        for (let j = y; j <= ye; j++) { clear.add(x + ',' + j); if (isLit(state, x, j)) litLen++; }
        if (litLen >= 3) { energy += payout(state, litLen); litRuns++; }
      }
      y = ye + 1;
    }
  }

  if (clear.size === 0) return false;
  for (const k of clear) {
    const ci = k.indexOf(',');
    const x = +k.slice(0, ci), y = +k.slice(ci + 1);
    if (state.events) state.events.popping.push({ x, y, lit: isLit(state, x, y) });
    clearGem(state, x, y);
  }
  if (energy > 0) {
    state.harvested += energy;
    state.energy += energy;
    state.frontier = Math.max(0, state.frontier - litRuns);
    if (state.frontier === 0) state.won = true;
  }
  return true;
}
```

- [ ] **Step 4: Run the test to verify Task 6 passes**

Run: `cd sim && node climb-selftest.js`
Expected: PASS — "1."–"6." all `✓`.

- [ ] **Step 5: Commit**

```bash
cd sim && git add climb-engine.js climb-selftest.js
git commit -m "climb: harvest scoring, frontier rise, and win condition"
```

---

## Task 7: Swapper machine + spawn curtain + economy + full tick

**Files:**
- Modify: `sim/climb-engine.js`
- Modify: `sim/climb-selftest.js`

- [ ] **Step 1: Add swapper / spawn / economy / tick / determinism tests to `sim/climb-selftest.js`**

Insert before the final `console.log`/`process.exit`:

```js
/* 7. swapper makes a match-creating swap (and carries life); spawn curtain;
      economy place/remove/bomb with cost gating; full tick is deterministic */
{
  const R = makeClimbRules();
  // Swapper: set up so swapping across the seam completes a horizontal run
  const s = createClimbState(R, 1);
  const y = R.rows - 2;
  for (let x = 0; x < R.cols; x++) { s.grid[y][x] = EMPTY; s.life[y][x] = 0; }
  s.grid[y][2] = 0; s.grid[y][3] = 1; s.grid[y][4] = 0; s.grid[y][5] = 0; // swap (3,4)->0 makes 3,4,5? no: makes 4? set up cleanly:
  // seam between (2,y) and (3,y): left=0, right=1, with 0s at 4,5 -> swapping makes 3,4,5 = 0
  for (const x of [2, 3, 4, 5]) s.life[y][x] = 9;
  s.pieces.get('swap').set('3,' + y, true);
  stepSwappersClimb(s);
  ok('swapper performed the match-making swap', s.grid[y][3] === 0);
  approx('swapper carried life across the seam', s.life[y][3], 9);

  // spawn curtain: emits into empty top cells (seeded)
  const ss = createClimbState(R, 2);
  for (let x = 0; x < R.cols; x++) { ss.grid[0][x] = EMPTY; ss.life[0][x] = 0; }
  stepSpawnClimb(ss);
  let emitted = 0; for (let x = 0; x < R.cols; x++) if (ss.grid[0][x] !== EMPTY) emitted++;
  ok('spawn curtain emits some gems at the top', emitted > 0);
  ok('emitted gems have life', (() => { for (let x = 0; x < R.cols; x++) if (ss.grid[0][x] !== EMPTY && ss.life[0][x] < 1) return false; return true; })());

  // economy: cost gating
  const se = createClimbState(R, 3);
  se.energy = 5;
  ok('cannot afford a Lens (cost 9)', placeClimb(se, 'amp', { x: 4, y: se.frontier }) === false);
  ok('can afford a Wall (cost 3)', placeClimb(se, 'dam', { x: 4, y: 10 }) === true);
  approx('wall deducted 3 energy', se.energy, 2);
  approx('spent tracked', se.spent, 3);
  ok('remove deletes the piece', removeClimb(se, 'dam', { x: 4, y: 10 }) === true);
  // bomb: free, destroys a gem
  se.grid[12][4] = 0; se.life[12][4] = 5;
  const eb = se.energy;
  ok('bomb destroys a gem', bombClimb(se, 4, 12) === true && se.grid[12][4] === EMPTY);
  approx('bomb is free', se.energy, eb);
  ok('costOf reads the table', costOf(se, 'swap') === 6 && costOf(se, 'bomb') === 0);

  // full tick determinism
  const a = createClimbState(R, 99), b = createClimbState(R, 99);
  for (let i = 0; i < 120; i++) { tickClimb(a); tickClimb(b); }
  ok('tick is deterministic (harvested)', a.harvested === b.harvested);
  ok('tick is deterministic (lost)', a.lost === b.lost);
  ok('tick is deterministic (frontier)', a.frontier === b.frontier);
  ok('a no-build game still loses gems to decay', a.lost > 0);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sim && node climb-selftest.js`
Expected: FAIL — `stepSwappersClimb` throws `not implemented`.

- [ ] **Step 3: Implement swapper, spawn, economy, and `tickClimb` in `sim/climb-engine.js`**

Add this private helper (with the other private helpers):

```js
function findTool(R, id) { for (const t of R.tools) if (t.id === id) return t; return null; }
```

Replace the `stepSwappersClimb` stub with:

```js
/* Each tick, for every Swapper seam, swap the two gems across it (grid AND life)
   only if the swap creates a match; otherwise revert. The pure-builder's only
   active match-maker. */
export function stepSwappersClimb(state) {
  const R = state.rules, g = state.grid, lf = state.life;
  for (const t of R.tools) {
    if (!t.swapOnMatch) continue;
    const m = state.pieces.get(t.id);
    if (!m) continue;
    for (const key of m.keys()) {
      const ci = key.indexOf(',');
      const x = +key.slice(0, ci), y = +key.slice(ci + 1); // seam between (x-1,y) and (x,y)
      const ax = x - 1, bx = x;
      if (!inBounds(state, ax, y) || !inBounds(state, bx, y)) continue;
      const a = g[y][ax], b = g[y][bx];
      if (a === EMPTY || b === EMPTY || a === b) continue;
      g[y][ax] = b; g[y][bx] = a;
      const la = lf[y][ax], lb = lf[y][bx]; lf[y][ax] = lb; lf[y][bx] = la;
      if (matchesAt(state, ax, y).size > 0 || matchesAt(state, bx, y).size > 0) {
        // keep — resolveClimb will clear it
      } else { g[y][ax] = a; g[y][bx] = b; lf[y][ax] = la; lf[y][bx] = lb; } // revert
    }
  }
}
```

Replace the `stepSpawnClimb` stub with:

```js
/* The Source rains gems into empty top-row cells (seeded). No free matches:
   spawnColor avoids completing a run with what's already below/beside. */
export function stepSpawnClimb(state) {
  if (state.won) return;
  const R = state.rules;
  for (let x = 0; x < R.cols; x++) {
    if (state.grid[0][x] === EMPTY && state.rng() < (R.spawnDensity || 0)) {
      state.grid[0][x] = spawnColor(state, x, 0);
      state.life[0][x] = randLife(state);
    }
  }
}
```

Replace the `placeClimb`, `removeClimb`, `bombClimb`, `costOf` stubs with:

```js
export function costOf(state, toolId) {
  const c = state.rules.costs;
  return (c && c[toolId] != null) ? c[toolId] : 0;
}
const CLH = { inBounds, canRest, isLit, litCeiling, EMPTY };
/* Place a structure if affordable and legal; deduct its cost. Diverters carry a
   {dir,flip} payload; everything else carries `true`. */
export function placeClimb(state, toolId, pos) {
  const t = findTool(state.rules, toolId);
  if (!t || t.kind === 'action') return false;
  if (t.validate && !t.validate(state, pos, CLH)) return false;
  const m = state.pieces.get(toolId);
  if (!m) return false;
  const key = pos.x + ',' + pos.y;
  if (m.has(key)) return false; // already occupied
  const cost = costOf(state, toolId);
  if (state.energy < cost) return false;
  const payload = t.divert ? { dir: pos.dir === -1 ? -1 : 1, flip: false } : true;
  m.set(key, payload);
  state.energy -= cost; state.spent += cost;
  return true;
}
/* Remove a structure (no refund — building is a commitment). */
export function removeClimb(state, toolId, pos) {
  const m = state.pieces.get(toolId);
  if (!m) return false;
  return m.delete(pos.x + ',' + pos.y);
}
/* Bomb: destroy one gem in a cell. Free. */
export function bombClimb(state, x, y) {
  if (!inBounds(state, x, y) || state.grid[y][x] === EMPTY) return false;
  clearGem(state, x, y);
  return true;
}
```

Replace the `tickClimb` stub with:

```js
/* One climb tick: machines -> resolve -> gravity -> spawn -> resolve. */
export function tickClimb(state) {
  if (state.won) return;
  if (state.events) { state.events.popping.length = 0; state.events.broke.length = 0; }
  stepSwappersClimb(state);
  resolveClimb(state);
  stepGravityClimb(state);
  stepSpawnClimb(state);
  resolveClimb(state);
  state.ticks++;
}
```

- [ ] **Step 4: Run the test to verify Task 7 passes**

Run: `cd sim && node climb-selftest.js`
Expected: PASS — all of "1."–"7." print `✓`, ending `N passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
cd sim && git add climb-engine.js climb-selftest.js
git commit -m "climb: swapper machine, spawn curtain, economy, and full tick"
```

---

## Task 8: Render — `drawClimb`

**Files:**
- Modify: `sim/render.js`

This is browser canvas code; it's verified by opening the front-end in Task 9. Here we add the draw path and confirm the module still imports cleanly in Node.

- [ ] **Step 1: Add climb imports + palette to `sim/render.js`**

At the top of `sim/render.js`, change the import line:

```js
import { lightReach } from './engine.js';
```

to:

```js
import { lightReach } from './engine.js';
import { isLit as climbIsLit, litCeiling as climbLitCeiling } from './climb-engine.js';
```

And add a Slope colour next to the existing palette constants (after the `DAMC`/`SWAPC`/... line):

```js
const SLOPEC = '#7fd49a';
```

- [ ] **Step 2: Append `drawClimb` and its piece-drawer to `sim/render.js`**

Add at the end of the file, before the final `export { COLORS };` line:

```js
/* =====================================================================
   CLIMB RENDER (demo 2). Draws a VIEW-row window of the tall shaft at world
   offset camTop: the rising light band, decaying gems (dim in the dark, faint
   when dying), the Glitterdelve floor, the Source, and the climb pieces.
   ===================================================================== */
export function drawClimb(ctx, state, rules, layout, camTop) {
  const { cell, ox, oy } = layout;
  const view = rules.view;
  const cxp = (x) => ox + x * cell;
  const ryp = (y) => oy + (y - camTop) * cell; // world row -> screen y
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // frame
  ctx.fillStyle = '#00000035';
  ctx.fillRect(ox - 4, oy - 4, cell * rules.cols + 8, cell * view + 8);

  // light band (per column, including lens-extended ceiling)
  for (let x = 0; x < rules.cols; x++) {
    const ceil = climbLitCeiling(state, x);
    for (let sy = 0; sy < view; sy++) {
      const y = camTop + sy;
      if (y < 0 || y >= rules.rows) continue;
      if (y >= ceil) {
        ctx.fillStyle = hexA(LIGHTC, y >= state.frontier ? 0.16 : 0.10); // base band brighter than relayed
        ctx.fillRect(cxp(x), ryp(y), cell, cell);
      }
    }
  }

  // faint grid
  ctx.strokeStyle = '#ffffff0c'; ctx.lineWidth = 1;
  for (let x = 0; x <= rules.cols; x++) { ctx.beginPath(); ctx.moveTo(cxp(x), oy); ctx.lineTo(cxp(x), oy + cell * view); ctx.stroke(); }
  for (let sy = 0; sy <= view; sy++) { ctx.beginPath(); ctx.moveTo(ox, oy + sy * cell); ctx.lineTo(ox + cell * rules.cols, oy + sy * cell); ctx.stroke(); }

  // Glitterdelve floor (if the bottom is in view)
  if (rules.rows - 1 >= camTop && rules.rows - 1 < camTop + view) {
    const fy = ryp(rules.rows - 1);
    ctx.fillStyle = '#e8c14a'; ctx.fillRect(ox - 4, fy + cell - 3, cell * rules.cols + 8, 6);
  }
  // The Source (if the top is in view) — glows pink when revealed (won)
  if (camTop <= 0) {
    ctx.fillStyle = state.won ? '#ff6b9d' : '#3a2a52';
    ctx.fillRect(ox - 4, ryp(0) - 12, cell * rules.cols + 8, 10);
  }

  // gems: full alpha when lit, dimmed when dark, faint when about to break
  for (let sy = 0; sy < view; sy++) {
    const y = camTop + sy;
    if (y < 0 || y >= rules.rows) continue;
    for (let x = 0; x < rules.cols; x++) {
      const c = state.grid[y][x];
      if (c === EMPTY) continue;
      const lit = climbIsLit(state, x, y);
      const dying = state.life[y][x] <= 1;
      ctx.globalAlpha = dying ? 0.3 : (lit ? 1 : 0.5);
      drawGem(ctx, cxp(x), ryp(y), cell, c, cell >= 18);
      ctx.globalAlpha = 1;
    }
  }

  drawClimbPieces(ctx, state, rules, layout, camTop);
}

function drawClimbPieces(ctx, state, rules, layout, camTop) {
  const { cell, ox } = layout;
  const cxp = (x) => ox + x * cell;
  const ryp = (y) => layout.oy + (y - camTop) * cell;
  const get = (id) => state.pieces.get(id) || new Map();
  const inView = (y) => y >= camTop && y < camTop + rules.view + 1;

  // Walls (horizontal seam)
  for (const key of get('dam').keys()) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    if (!inView(y)) continue;
    ctx.strokeStyle = DAMC; ctx.lineWidth = Math.max(2, cell * 0.09); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cxp(x) + 3, ryp(y)); ctx.lineTo(cxp(x) + cell - 3, ryp(y)); ctx.stroke();
  }
  // Lenses (double bar; drawn dashed-ish to read as fragile)
  for (const key of get('amp').keys()) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    if (!inView(y)) continue;
    ctx.strokeStyle = AMPC; ctx.lineWidth = Math.max(1.5, cell * 0.06); ctx.lineCap = 'butt';
    ctx.setLineDash([Math.max(3, cell * 0.14), Math.max(2, cell * 0.08)]);
    ctx.beginPath(); ctx.moveTo(cxp(x) + 3, ryp(y) - 2); ctx.lineTo(cxp(x) + cell - 3, ryp(y) - 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cxp(x) + 3, ryp(y) + 2); ctx.lineTo(cxp(x) + cell - 3, ryp(y) + 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  // Swappers (vertical seam)
  for (const key of get('swap').keys()) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    if (!inView(y)) continue;
    ctx.strokeStyle = SWAPC; ctx.lineWidth = Math.max(2, cell * 0.09); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cxp(x), ryp(y) + 3); ctx.lineTo(cxp(x), ryp(y) + cell - 3); ctx.stroke();
  }
  // Splitters (downward fork chevron in a cell)
  for (const [key, p] of get('split')) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    if (!inView(y)) continue;
    const m = cell / 2, dir = p && p.dir ? p.dir : 1;
    ctx.strokeStyle = SPLITC; ctx.lineWidth = Math.max(2, cell * 0.07); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cxp(x) + m, ryp(y) + cell * 0.18);
    ctx.lineTo(cxp(x) + m, ryp(y) + cell * 0.55);
    ctx.lineTo(cxp(x) + m + dir * cell * 0.28, ryp(y) + cell * 0.82);
    ctx.moveTo(cxp(x) + m, ryp(y) + cell * 0.55);
    ctx.lineTo(cxp(x) + m, ryp(y) + cell * 0.82);
    ctx.stroke();
  }
  // Slopes (a solid ramp triangle pointing the push direction)
  for (const [key, p] of get('slope')) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    if (!inView(y)) continue;
    const dir = p && p.dir ? p.dir : 1;
    const x0 = cxp(x) + cell * 0.15, x1 = cxp(x) + cell * 0.85, yb = ryp(y) + cell * 0.8, yt = ryp(y) + cell * 0.25;
    ctx.fillStyle = hexA(SLOPEC, 0.85);
    ctx.beginPath();
    if (dir > 0) { ctx.moveTo(x0, yb); ctx.lineTo(x1, yb); ctx.lineTo(x1, yt); }
    else { ctx.moveTo(x1, yb); ctx.lineTo(x0, yb); ctx.lineTo(x0, yt); }
    ctx.closePath(); ctx.fill();
  }
}
```

- [ ] **Step 3: Verify the module still parses in Node (no front-end yet)**

Run: `cd sim && node -e "import('./render.js').then(m => console.log('render ok:', typeof m.drawClimb, typeof m.drawState))"`
Expected: prints `render ok: function function` (both draw paths export).

- [ ] **Step 4: Commit**

```bash
cd sim && git add render.js
git commit -m "climb: drawClimb render path (camera window, band, pieces)"
```

---

## Task 9: Front-end — `climb.html` + `climb.js`

**Files:**
- Create: `sim/climb.html`
- Create: `sim/climb.js`

Browser code, verified manually by serving and playing (Step 5).

- [ ] **Step 1: Create `sim/climb.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>Glitterdelve — The Climb (demo 2)</title>
<link rel="icon" type="image/svg+xml" href="../favicon.svg">
<style>
  :root{
    --bg:#0e0b16; --panel:#181226; --panel2:#1f1733; --ink:#e8e3f5; --muted:#8a82a8;
    --line:#2a2140; --accent:#c9a227;
  }
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
  html,body{margin:0;height:100%;overflow:hidden;background:var(--bg);color:var(--ink);
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    user-select:none;-webkit-user-select:none;touch-action:none;}
  #stage{position:absolute;left:0;right:0;top:0;bottom:92px;
    background:radial-gradient(1100px 700px at 50% 120%,#1c1430 0%,transparent 60%),var(--bg);}
  canvas{display:block;width:100%;height:100%;}
  .topbar{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:10px;align-items:flex-start;pointer-events:none;z-index:2;}
  .card{background:color-mix(in srgb,var(--panel) 88%,transparent);border:1px solid var(--line);
    border-radius:14px;padding:10px 14px;backdrop-filter:blur(8px);}
  .total{font-size:22px;font-weight:700;letter-spacing:-.02em;}
  .label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;}
  .stat{margin-left:auto;text-align:right;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;}
  .stat b{color:var(--ink);font-weight:600;}
  .links{position:absolute;top:12px;right:12px;display:flex;gap:8px;z-index:3;}
  .links a,.gear{font-size:12px;color:var(--muted);text-decoration:none;border:1px solid var(--line);
    background:color-mix(in srgb,var(--panel) 80%,transparent);border-radius:9px;padding:5px 9px;cursor:pointer;}
  .links a:hover,.gear:hover{color:var(--ink);}
  .toolbar{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);display:flex;gap:8px;
    background:color-mix(in srgb,var(--panel) 92%,transparent);border:1px solid var(--line);
    border-radius:16px;padding:8px;backdrop-filter:blur(8px);z-index:2;max-width:96vw;overflow-x:auto;}
  .tool{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:62px;
    padding:7px 9px;border-radius:11px;border:1px solid transparent;cursor:pointer;
    color:var(--muted);font-size:11px;transition:.15s;}
  .tool:hover{color:var(--ink);background:#ffffff0d;}
  .tool.active{color:var(--ink);border-color:currentColor;background:#ffffff14;}
  .tool .ic{font-size:18px;line-height:1;}
  .tool .cost{font-size:10px;color:var(--accent);}
  .hint{position:absolute;bottom:86px;left:50%;transform:translateX(-50%);font-size:12px;color:var(--muted);
    text-align:center;pointer-events:none;background:color-mix(in srgb,var(--panel) 80%,transparent);
    border:1px solid var(--line);border-radius:10px;padding:7px 13px;transition:opacity .5s;max-width:90vw;z-index:2;}
  .panel{position:absolute;top:52px;right:12px;width:230px;z-index:4;display:none;
    background:color-mix(in srgb,var(--panel) 95%,transparent);border:1px solid var(--line);
    border-radius:14px;padding:14px;backdrop-filter:blur(8px);}
  .panel.open{display:block;}
  .panel h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);}
  .panel .row{display:flex;gap:8px;margin-bottom:8px;}
  .panel .row>div{flex:1;}
  .panel label{font-size:11px;color:var(--muted);display:block;margin-bottom:3px;}
  .panel input{width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--ink);
    border-radius:7px;padding:6px 8px;font-size:13px;font-family:inherit;}
  .panel button{width:100%;background:var(--accent);color:#1a1206;border:none;border-radius:9px;
    padding:9px;font-weight:700;cursor:pointer;margin-top:4px;}
  .panel .note{font-size:11px;color:var(--muted);margin-top:8px;line-height:1.4;}
  .win{position:absolute;inset:0;display:none;align-items:center;justify-content:center;z-index:5;
    background:radial-gradient(600px 400px at 50% 30%,rgba(255,107,157,.25),transparent 70%),rgba(8,6,16,.7);}
  .win.show{display:flex;}
  .win .box{text-align:center;background:color-mix(in srgb,var(--panel) 94%,transparent);
    border:1px solid var(--line);border-radius:16px;padding:26px 32px;backdrop-filter:blur(8px);}
  .win h2{margin:0 0 8px;font-size:22px;} .win p{margin:0;color:var(--muted);font-size:13px;}
</style>
</head>
<body>
<div id="stage"><canvas id="cv"></canvas></div>

<div class="topbar">
  <div class="card">
    <div class="total" id="total">0</div>
    <div class="label">energy harvested</div>
  </div>
  <div class="card stat" id="stats"></div>
</div>

<div class="links">
  <span class="gear" id="gear">⚙ rules</span>
  <a href="./index.html">lab →</a>
</div>

<div class="panel" id="panel">
  <h3>Climb ruleset (restart to apply)</h3>
  <div class="row">
    <div><label>cols</label><input type="number" id="r_cols"></div>
    <div><label>rows</label><input type="number" id="r_rows"></div>
  </div>
  <div class="row">
    <div><label>baseReach</label><input type="number" id="r_baseReach"></div>
    <div><label>lensReach</label><input type="number" id="r_lensReach"></div>
  </div>
  <div class="row">
    <div><label>lifeMin</label><input type="number" id="r_lifeMin"></div>
    <div><label>lifeMax</label><input type="number" id="r_lifeMax"></div>
  </div>
  <div class="row">
    <div><label>seed</label><input type="number" id="r_seed"></div>
    <div><label>tick ms</label><input type="number" id="r_tick"></div>
  </div>
  <button id="restart">Restart</button>
  <button id="pause" style="background:transparent;color:var(--ink);border:1px solid var(--line);">Pause</button>
  <div class="note">Glitterdelve is at the bottom. Build the wall up the shaft to harvest matches in the light; reach the Source at the top. State lives in the URL.</div>
</div>

<div class="hint" id="hint"></div>
<div class="toolbar" id="toolbar"></div>

<div class="win" id="win"><div class="box"><h2>You reached the Source.</h2><p id="winsub"></p></div></div>

<script type="module" src="./climb.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `sim/climb.js`**

```js
/* =====================================================================
   GLITTERDELVE — THE CLIMB (demo 2), browser front-end on climb-engine.
   Pure builder: deploy structures to route falling, decaying gems into the
   rising light. Camera follows the frontier up a tall shaft to the Source.
   Ruleset is read from the URL so a tweaked game is shareable/bookmarkable.
   ===================================================================== */
import { CLIMB_RULES, makeClimbRules } from './rules.js';
import {
  createClimbState, tickClimb, placeClimb, removeClimb, bombClimb, costOf, inBounds, EMPTY,
} from './climb-engine.js';
import { drawClimb, computeLayout } from './render.js';

const cv = document.getElementById('cv'), ctx = cv.getContext('2d'), stage = document.getElementById('stage');

const RULE_KEYS = ['cols', 'rows', 'baseReach', 'lensReach', 'lifeMin', 'lifeMax'];
function readOverridesFromURL() {
  const q = new URLSearchParams(location.search), o = {};
  for (const k of RULE_KEYS) if (q.has(k)) o[k] = parseInt(q.get(k), 10);
  return o;
}
let overrides = readOverridesFromURL();
let seed = parseInt(new URLSearchParams(location.search).get('seed') || '1', 10) || 1;
let TICK = parseInt(new URLSearchParams(location.search).get('tick') || '220', 10) || 220;

let rules, state, layout = { cell: 40, ox: 0, oy: 0 }, camTop = 0, paused = false;

function newGame() {
  rules = makeClimbRules(overrides);
  state = createClimbState(rules, seed, { record: true });
  camTop = camTopFor();
  resize();
  buildToolbar();
  document.getElementById('win').classList.remove('show');
  updateStats();
}

/* camera: keep the frontier ~4 rows below the top of the window, clamped to the shaft */
function camTopFor() {
  const top = state.frontier - 4;
  return Math.max(0, Math.min(rules.rows - rules.view, top));
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = stage.clientWidth, h = stage.clientHeight;
  cv.width = w * dpr | 0; cv.height = h * dpr | 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // size cells to the VIEW window height, not the whole shaft
  layout = computeLayout(w, h, { cols: rules.cols, rows: rules.view }, { pad: 16, top: 64 });
}
addEventListener('resize', resize);

const cornerX = (px) => Math.round((px - layout.ox) / layout.cell);
const cornerY = (py) => camTop + Math.round((py - layout.oy) / layout.cell);
const cellAtX = (px) => Math.floor((px - layout.ox) / layout.cell);
const cellAtY = (py) => camTop + Math.floor((py - layout.oy) / layout.cell);

/* toolbar built from the registry; shows costs */
let tool = 'bomb';
function buildToolbar() {
  const bar = document.getElementById('toolbar');
  bar.innerHTML = '';
  for (const t of rules.tools) {
    const el = document.createElement('div');
    el.className = 'tool' + (t.id === tool ? ' active' : '');
    el.dataset.tool = t.id;
    const cost = costOf(state, t.id);
    el.innerHTML = `<span class="ic">${t.icon || '?'}</span>${t.name}<span class="cost">${cost ? cost + '⚡' : 'free'}</span>`;
    el.onclick = () => {
      tool = t.id;
      [...bar.children].forEach((c) => c.classList.toggle('active', c.dataset.tool === tool));
      showHint();
    };
    bar.appendChild(el);
  }
}

/* place/remove with toggle + cost feedback */
function tryPlace(toolId, pos) {
  const m = state.pieces.get(toolId);
  const tdef = rules.tools.find((t) => t.id === toolId);
  const key = pos.x + ',' + pos.y;
  if (tdef.seam === 'cell' && tdef.divert) {
    const ex = m.get(key);
    if (ex && ex.dir === (pos.dir || 1)) { removeClimb(state, toolId, pos); }
    else { if (ex) removeClimb(state, toolId, pos); if (!placeClimb(state, toolId, pos)) flashHint('Not enough energy'); }
  } else if (m.has(key)) {
    removeClimb(state, toolId, pos);
  } else if (!placeClimb(state, toolId, pos)) {
    flashHint('Not enough energy');
  }
  updateStats();
}
function placeFromCorners(a, b) {
  const tdef = rules.tools.find((t) => t.id === tool);
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return;
  if (tdef.seam === 'horizontal' && Math.abs(dx) === 1) {
    const x = Math.min(a.cx, b.cx), y = a.cy;
    if (x >= 0 && x < rules.cols && y >= 1 && y < rules.rows) tryPlace(tool, { x, y });
  } else if (tdef.seam === 'vertical' && Math.abs(dy) === 1) {
    const x = a.cx, y = Math.min(a.cy, b.cy);
    if (x >= 1 && x < rules.cols && y >= 0 && y < rules.rows) tryPlace(tool, { x, y });
  }
}

/* input */
let drag = null;
stage.addEventListener('contextmenu', (e) => e.preventDefault());
stage.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  stage.setPointerCapture(e.pointerId);
  const tdef = rules.tools.find((t) => t.id === tool);
  if (tdef.kind === 'action') { // Bomb: instant on the clicked cell
    const x = cellAtX(e.clientX), y = cellAtY(e.clientY);
    if (inBounds(state, x, y)) { bombClimb(state, x, y); updateStats(); }
  } else if (tdef.seam === 'cell') { // Slope/Splitter: click + drag for direction
    drag = { mode: 'cell', x: cellAtX(e.clientX), y: cellAtY(e.clientY), sx: e.clientX, px: e.clientX, py: e.clientY };
  } else { // seam tools: corner -> corner drag
    drag = { mode: 'seam', a: { cx: cornerX(e.clientX), cy: cornerY(e.clientY) }, px: e.clientX, py: e.clientY };
  }
});
stage.addEventListener('pointermove', (e) => { if (drag) { drag.px = e.clientX; drag.py = e.clientY; } });
stage.addEventListener('pointerup', (e) => {
  if (drag && drag.mode === 'seam') {
    placeFromCorners(drag.a, { cx: cornerX(e.clientX), cy: cornerY(e.clientY) });
  } else if (drag && drag.mode === 'cell') {
    if (inBounds(state, drag.x, drag.y)) {
      const dir = (e.clientX - drag.sx) < 0 ? -1 : 1;
      tryPlace(tool, { x: drag.x, y: drag.y, dir });
    }
  }
  drag = null;
});

/* render */
function draw() {
  camTop = camTopFor();
  drawClimb(ctx, state, rules, layout, camTop);
}

/* HUD */
function updateStats() {
  document.getElementById('total').textContent = state.harvested.toLocaleString();
  const counts = rules.tools.filter((t) => t.kind !== 'action')
    .map((t) => `${t.name.toLowerCase()} <b>${(state.pieces.get(t.id) || new Map()).size}</b>`).join(' · ');
  document.getElementById('stats').innerHTML =
    `energy <b>${state.energy}</b> · lost <b>${state.lost}</b> · to source <b>${state.frontier}</b><br>${counts}`;
  if (state.won) {
    const w = document.getElementById('win');
    document.getElementById('winsub').textContent = `${state.harvested} energy harvested, ${state.lost} lost to the dark.`;
    w.classList.add('show');
  }
}

/* hint */
let hintTimer;
function showHint() {
  const msgs = {
    bomb: 'Bomb: click a gem to destroy it. Free — for clearing jams and mistakes.',
    dam: 'Wall: drag along a horizontal grid line. Gems pile on top — hold them in the light to match.',
    slope: 'Slope: click a cell, drag left/right to aim. Pushes EVERY gem that way.',
    split: 'Splitter: click a cell, drag left/right. Pushes every OTHER gem aside.',
    swap: 'Swapper: drag along a vertical grid line. Swaps two gems when it makes a match — your matcher.',
    amp: 'Lens: drag along a horizontal grid line. Relays light upward, but a gem hitting it breaks it.',
  };
  flashHint(msgs[tool] || tool);
}
function flashHint(text) {
  const h = document.getElementById('hint');
  h.textContent = text; h.style.opacity = '1';
  clearTimeout(hintTimer); hintTimer = setTimeout(() => { h.style.opacity = '0'; }, 3200);
}

/* rules panel */
const panel = document.getElementById('panel');
document.getElementById('gear').onclick = () => { syncPanel(); panel.classList.toggle('open'); };
function syncPanel() {
  for (const k of RULE_KEYS) document.getElementById('r_' + k).value = (overrides[k] != null ? overrides[k] : CLIMB_RULES[k]);
  document.getElementById('r_seed').value = seed;
  document.getElementById('r_tick').value = TICK;
}
document.getElementById('restart').onclick = () => {
  overrides = {};
  for (const k of RULE_KEYS) { const v = parseInt(document.getElementById('r_' + k).value, 10); if (Number.isFinite(v)) overrides[k] = v; }
  seed = parseInt(document.getElementById('r_seed').value, 10) || 1;
  TICK = Math.max(20, parseInt(document.getElementById('r_tick').value, 10) || 220);
  const q = new URLSearchParams();
  for (const k of RULE_KEYS) if (overrides[k] !== undefined && overrides[k] !== CLIMB_RULES[k]) q.set(k, overrides[k]);
  if (seed !== 1) q.set('seed', seed);
  if (TICK !== 220) q.set('tick', TICK);
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
  panel.classList.remove('open');
  newGame();
};
const pauseBtn = document.getElementById('pause');
pauseBtn.onclick = () => { paused = !paused; pauseBtn.textContent = paused ? 'Resume' : 'Pause'; };

/* main loop */
let acc = 0, last = performance.now();
function frame(now) {
  acc += now - last; last = now;
  let ticked = false;
  if (!paused && !state.won) { while (acc >= TICK) { tickClimb(state); acc -= TICK; ticked = true; } }
  else acc = 0;
  draw();
  if (ticked) updateStats();
  requestAnimationFrame(frame);
}
newGame();
showHint();
requestAnimationFrame((n) => { last = n; requestAnimationFrame(frame); });
```

- [ ] **Step 3: Re-run the headless self-test (engine still green)**

Run: `cd sim && node climb-selftest.js`
Expected: PASS — `N passed, 0 failed`.

- [ ] **Step 4: Serve and open the game**

Run: `cd .. && python3 -m http.server 8777` (from the repo root, so `../favicon.svg` resolves), then open `http://localhost:8777/sim/climb.html`.

- [ ] **Step 5: Manual verification checklist** (confirm each, then stop the server)

- The view starts near the bottom: a gold Glitterdelve floor, a faint light band above it, sparse gems raining and some fading/vanishing (decay).
- The toolbar shows Bomb (free) + Wall/Slope/Splitter/Swapper/Lens with `⚡` costs; `energy harvested` and `energy/lost/to source` update live.
- Placing a Wall (drag a horizontal grid line) deducts 3 energy; gems pile on it. Selecting Bomb and clicking a gem removes it for free.
- Building Swappers/Slopes to align 3+ in the light pops them, adds energy, and the camera scrolls up a row (frontier falls toward 0).
- A Lens (drag horizontal line just above the band) brightens cells above the frontier; a gem falling onto it makes it disappear (fragile).
- Reaching `to source 0` shows the win overlay with the Source bar glowing pink.

- [ ] **Step 6: Commit**

```bash
cd sim && git add climb.html climb.js
git commit -m "climb: scrolling builder front-end with economy and Source reveal"
```

---

## Task 10: Docs

**Files:**
- Modify: `sim/README.md`

- [ ] **Step 1: Add a Climb section to `sim/README.md`**

Append at the end of `sim/README.md`:

```markdown
## The Climb (demo 2)

A second, inverted demo built on the same engine primitives. Glitterdelve sits at
the **bottom**; gems rain down and **decay** (each fall-step burns one life), so few
survive the long drop — the harvest is sporadic. You're the Wall Organizer: a **pure
builder** (no manual Cut) who deploys structures to route gems into matches inside a
light band that **rises** as you harvest, climbing a tall shaft to the Source.

- **Play:** serve the repo root and open `sim/climb.html` (`python3 -m http.server 8777`
  from the repo root, then `http://localhost:8777/sim/climb.html`). Ruleset lives in the
  URL (`?rows=60&seed=3&...`).
- **Tools:** Bomb (free, destroy a gem), Wall (3, blocks fall), Slope (3, diverts every
  gem), Splitter (6, diverts every other), Swapper (6, swap-on-match — your matcher),
  Lens (9, relays light upward but breaks when a gem hits it).
- **Economy:** one currency — harvested energy is both score and build budget. Scoring is
  super-linear: 3 gems = 3, 4 = 6, 5 = 12. Floor drains unmatched gems for nothing.
- **Code:** `climb-engine.js` (headless, deterministic, reuses `engine.js` helpers),
  `climb.js` + `climb.html` (front-end), climb ruleset/tools in `rules.js`, `drawClimb`
  in `render.js`. Tests: `node climb-selftest.js` (or `npm run climbtest`). Demo 1
  (`engine.js`/`demo.html`) is untouched.
```

- [ ] **Step 2: Final verification — both self-tests green**

Run: `cd sim && node selftest.js && node climb-selftest.js`
Expected: both print `N passed, 0 failed` (demo 1 unaffected, climb all green).

- [ ] **Step 3: Commit**

```bash
cd sim && git add README.md
git commit -m "climb: document demo 2 in the sim README"
```

---

## Self-Review

**Spec coverage** (every spec section maps to a task):
- Inverted bottom-anchored frontier light → Task 3 (`litCeiling`/`isLit`), Task 8 render band.
- Push-light-up progression → Task 6 (`resolveClimb` raises `frontier`), win at 0.
- Pure builder, no manual Cut → no Cut tool in `CLIMB_TOOLS` (Task 1); front-end has no swap input (Task 9).
- Per-fall-step decay + parallel `life` grid + fade telegraph → Task 2 (`life`), Task 4 (`fallInto` decrement/break), Task 8 (dying alpha).
- Six tools with the exact costs → Task 1 (`CLIMB_TOOLS`, `costs`), Task 7 (cost gating), Task 9 (toolbar + input per tool).
- Slope (every gem) vs Splitter (every other) → Task 4/5 (`always` vs `flip`).
- Fragile Lens (breaks on contact, no blocksFall) → Task 1 flags, Task 4 `fallInto`, Task 5 test.
- Single energy currency (score == budget) → Task 7 (`harvested`/`energy`/`spent`), Task 9 HUD.
- Super-linear scoring 3/6/12 → Task 1 `scoring`, Task 6 `payout` + tests.
- Curtain spawn from the Source; richer-higher emerges from decay → Task 7 `stepSpawnClimb`; gradient is emergent (no separate code).
- Floor drain (anti-clog, 0 energy) → Task 4.
- Tall finite shaft + scrolling camera + Source reveal/win → Task 1 (`rows`/`view`), Task 9 (`camTopFor`, win overlay), Task 8 (floor/Source draw).
- Extend `sim/`, demo 1 untouched → sibling module + climb ruleset; engine.js/demo.html never edited.
- Determinism → Task 7 determinism test.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; tests have real assertions. The Task 3 test note explicitly resolves to the self-contained direct-placement form so it runs before `placeClimb` exists.

**Type/name consistency:** Function names are stable across tasks — `createClimbState`, `tickClimb`, `stepGravityClimb`, `resolveClimb`, `stepSwappersClimb`, `stepSpawnClimb`, `placeClimb`, `removeClimb`, `bombClimb`, `costOf`, `isLit`, `litCeiling`. Private helpers (`clearGem`, `moveGem`, `randLife`, `prefill`, `blockedBelow`, `fragileAtSeam`, `divertAt`, `fallInto`, `payout`, `findTool`) are each defined once (Tasks 2/4/6/7) and used after definition. Render imports `isLit as climbIsLit`, `litCeiling as climbLitCeiling`. Tool ids (`bomb`/`dam`/`slope`/`split`/`swap`/`amp`) match between `rules.js`, render, and front-end.

**Note on stub ordering:** Task 1 ships a fully-stubbed `climb-engine.js` so every later import resolves immediately; each task replaces one stub with its real implementation and is independently runnable/committable.
```

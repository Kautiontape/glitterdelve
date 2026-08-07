/* =====================================================================
   GLITTERDELVE CLIMB ENGINE (demo 2) — headless, deterministic.

   The Climb is a PURE-BUILDER routing game. There is no manual matcher:
   you place ramps, colour sorters, conveyors, walls and lenses, and matches
   emerge when the machine herds like colours into a LIT column until they pile
   3+ and pop. Energy from pops funds more machine; lenses raise the safe light
   one column at a time toward the Source.

   Light is THREE TIERS, PER COLUMN:
     bright — gems are safe (never decay) and matches SCORE here
     dim    — visible, buildable, resting gems decay (settle then crack)
     dark   — invisible; gems fall/rest and decay here unseen (the mystery)

   Decay is the "settle beat": a FALLING gem never decays (it rains down to the
   safe base and piles); a gem that comes to REST in a non-bright cell sits
   `settle` ticks, then cracks over `crack` ticks, then shatters.

   Reuses pure helpers from engine.js; engine.js/demo.html are untouched.
   ===================================================================== */
import { mulberry32 } from './rng.js';
import { spawnColor, inBounds, EMPTY } from './engine.js';

export { EMPTY, inBounds };

/* ---- gem cell helpers (grid colour + rest-timer stay in lockstep) ---- */
function clearGem(state, x, y) { state.grid[y][x] = EMPTY; state.rest[y][x] = 0; }
/* Move a gem; the destination starts a fresh rest timer (it just moved). */
function moveGem(state, fx, fy, tx, ty) {
  state.grid[ty][tx] = state.grid[fy][fx];
  state.rest[ty][tx] = 0;
  state.grid[fy][fx] = EMPTY; state.rest[fy][fx] = 0;
}
function putGem(state, x, y, color) { state.grid[y][x] = color; state.rest[y][x] = 0; }

/* Pre-fill the shaft bottom-up; spawnColor's look-ahead prevents standing
   matches. With initDensity 0 (the default) this leaves the shaft empty. */
function prefill(state) {
  const R = state.rules;
  for (let y = R.rows - 1; y >= 0; y--)
    for (let x = 0; x < R.cols; x++)
      if (state.rng() < (R.initDensity || 0)) putGem(state, x, y, spawnColor(state, x, y));
}

/* ---- tool-capability lookups over the climb registry ---- */
function findTool(R, id) { for (const t of R.tools) if (t.id === id) return t; return null; }
/* a solid wedge (ramp/sorter) occupying cell (x,y) — gems can't rest in it */
function wedgeAt(state, x, y) {
  for (const t of state.rules.tools) {
    if (!t.wedge) continue;
    const m = state.pieces.get(t.id);
    const p = m && m.get(x + ',' + y);
    if (p) return { tool: t, piece: p };
  }
  return null;
}
/* a colour-filter sorter in cell (x,y) — NOT solid; gems flow through it */
function sorterAt(state, x, y) {
  for (const t of state.rules.tools) {
    if (!t.sorter) continue;
    const m = state.pieces.get(t.id);
    const p = m && m.get(x + ',' + y);
    if (p) return p;
  }
  return null;
}
/* a conveyor tag in cell (x,y) */
function conveyorAt(state, x, y) {
  for (const t of state.rules.tools) {
    if (!t.conveyor) continue;
    const m = state.pieces.get(t.id);
    const p = m && m.get(x + ',' + y);
    if (p) return { tool: t, piece: p };
  }
  return null;
}
/* a blocksFall tool (Wall) on the seam BELOW cell (x,y) holds the gem up */
function blockedBelow(state, x, y) {
  const key = x + ',' + (y + 1);
  for (const t of state.rules.tools) {
    if (!t.blocksFall) continue;
    const m = state.pieces.get(t.id);
    if (m && m.has(key)) return true;
  }
  return false;
}
/* A gem can rest in cell (x,y) only if it's in-bounds, empty, and not a solid
   wedge. (Conveyor cells are not solid — a gem rides on them.) */
function freeRest(state, x, y) {
  return inBounds(state, x, y) && state.grid[y][x] === EMPTY && !wedgeAt(state, x, y);
}
/* Is the gem at (x,y) supported (resting), i.e. it cannot fall further? */
function supported(state, x, y) {
  const R = state.rules;
  if (y >= R.rows - 1) return true;                 // floor
  if (blockedBelow(state, x, y)) return true;       // wall on the seam below
  if (state.grid[y + 1][x] !== EMPTY) return true;  // a gem below
  if (wedgeAt(state, x, y + 1)) return true;        // resting on a wedge
  return false;
}
/* Move a gem one step down (straight or diagonal). Lenses are sturdy — gems fall
   straight through them. Rest is NOT spent here — only resting decays. */
function fallInto(state, fx, fy, tx, ty) {
  moveGem(state, fx, fy, tx, ty);
}

export function createClimbState(rules, seed, opts = {}) {
  const R = rules;
  const grid = [], rest = [];
  for (let y = 0; y < R.rows; y++) { grid.push(new Array(R.cols).fill(EMPTY)); rest.push(new Array(R.cols).fill(0)); }
  const pieces = new Map();
  for (const t of R.tools) if (t.kind !== 'action') pieces.set(t.id, new Map());
  const state = {
    rules: R, grid, rest, pieces,
    energy: R.startGrant != null ? R.startGrant : 30,
    harvested: 0, spent: 0, lost: 0, drained: 0, won: false, ticks: 0,
    combo: 0,                 // consecutive ticks that scored a bright run
    rng: mulberry32((seed | 0) >>> 0),
    lightGen: 0, _bc: null, _bcGen: -1, // per-column bright-ceiling memo
    events: opts.record ? { popping: [], broke: [], drained: [] } : null,
  };
  prefill(state);
  return state;
}

/* One climb tick: machines -> resolve -> gravity -> decay -> spawn -> resolve.
   Win when any column's bright light has reached the Source (row 0). */
export function tickClimb(state) {
  if (state.won) return;
  if (state.events) { state.events.popping.length = 0; state.events.broke.length = 0; }
  const mult = comboMult(state);          // multiplier for THIS tick's pops
  stepConveyors(state);
  const r1 = resolveClimb(state, mult);
  stepGravityClimb(state);
  decayClimb(state);
  stepSpawnClimb(state);
  const r2 = resolveClimb(state, mult);
  stepFloorDrain(state);
  const popped = r1.popped || r2.popped;
  state.combo = popped ? Math.min(state.rules.comboCap || 0, state.combo + 1) : 0;
  if (litColumns(state) >= state.rules.cols) state.won = true; // whole shaft lit to the Source
  state.ticks++;
}

/* Glitterdelve absorbs overflow: when a column's contiguous pile pokes above its
   bright ceiling (into the dim), the delve eats the bottom gem. Columns cap at
   the brim of the light instead of piling into the dark and dying — so the base
   is calm and self-clearing, and losses only come from gems you park unlit on a
   raised structure (your machine). A small `floorHarvest` trickle is optional. */
export function stepFloorDrain(state) {
  const R = state.rules, fy = R.rows - 1, bc = brightCeils(state);
  const gain = R.floorHarvest || 0;
  for (let x = 0; x < R.cols; x++) {
    if (state.grid[fy][x] === EMPTY) continue;
    let top = fy;
    while (top - 1 >= 0 && state.grid[top - 1][x] !== EMPTY) top--; // contiguous from the floor
    if (top >= bc[x]) continue;                 // pile fits inside the light — leave it
    clearGem(state, x, fy); state.drained++;
    if (gain) { state.harvested += gain; state.energy += gain; }
    if (state.events) state.events.drained.push({ x, y: fy });
  }
}
export function comboMult(state) { return 1 + Math.min(state.rules.comboCap || 0, state.combo); }

/* Conveyors carry a RESTING gem one cell toward their arrow each tick (machines
   phase). Reads the pre-move grid so each gem advances at most one cell. */
export function stepConveyors(state) {
  const moves = [];
  for (const t of state.rules.tools) {
    if (!t.conveyor) continue;
    const m = state.pieces.get(t.id);
    if (!m) continue;
    for (const [key, p] of m) {
      const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
      if (state.grid[y][x] === EMPTY) continue;
      if (!supported(state, x, y)) continue;          // a gem in mid-air isn't carried
      const tx = x + (p.dir || 1);
      if (freeRest(state, tx, y)) moves.push({ fx: x, fy: y, tx, ty: y });
    }
  }
  for (const mv of moves) {
    if (state.grid[mv.fy][mv.fx] === EMPTY) continue;
    if (!freeRest(state, mv.tx, mv.ty)) continue;     // taken by an earlier move
    moveGem(state, mv.fx, mv.fy, mv.tx, mv.ty);
  }
}

/* Gravity: gems fall one row. A solid wedge below deflects the gem to the side
   as it enters (ramp: always its dir; sorter: target colour one way, the rest
   the other). Falling never spends life. */
export function stepGravityClimb(state) {
  const R = state.rules;
  for (let y = R.rows - 2; y >= 0; y--) {
    for (let x = 0; x < R.cols; x++) {
      const c = state.grid[y][x];
      if (c === EMPTY) continue;
      const below = y + 1;
      const srt = sorterAt(state, x, below);          // colour filter (not solid)
      if (srt) {
        if (c === (srt.tc | 0)) {                      // the lane colour: straight through
          if (freeRest(state, x, below)) fallInto(state, x, y, x, below);
        } else {                                       // anything else: kicked aside
          const tx = x + (srt.dir || 1);
          if (freeRest(state, tx, below)) fallInto(state, x, y, tx, below);
          else if (freeRest(state, x, below)) fallInto(state, x, y, x, below);
        }
        continue;
      }
      const w = wedgeAt(state, x, below);             // a solid ramp deflects on entry
      if (w) {
        const tx = x + (w.piece.dir || 1);
        if (freeRest(state, tx, below)) fallInto(state, x, y, tx, below);
        // else: rests on the wedge
        continue;
      }
      if (blockedBelow(state, x, y)) continue;        // wall holds (lens does not)
      if (freeRest(state, x, below)) fallInto(state, x, y, x, below);
      // else: rests on a gem/floor
    }
  }
}

/* Decay = the settle beat. Falling gems never decay; bright gems are safe; a gem
   resting in dim/dark sits `settle` ticks, cracks over `crack`, then shatters.
   Dim deaths are visible (emit a break event); dark deaths are unseen. */
export function decayClimb(state) {
  const R = state.rules;
  const limit = (R.settle || 0) + (R.crack || 0);
  const bc = brightCeils(state);
  for (let y = 0; y < R.rows; y++) {
    for (let x = 0; x < R.cols; x++) {
      if (state.grid[y][x] === EMPTY) continue;
      if (y >= bc[x]) { state.rest[y][x] = 0; continue; }   // bright: safe
      if (!supported(state, x, y)) { state.rest[y][x] = 0; continue; } // still falling
      const r = state.rest[y][x] + 1;
      if (r > limit) {
        const dim = y >= dimCeilFrom(R, bc[x]);
        clearGem(state, x, y); state.lost++;
        if (dim && state.events) state.events.broke.push({ x, y });
      } else state.rest[y][x] = r;
    }
  }
}

/* The Source rains gems into empty top-row cells. spawnColor avoids gifting a
   free run with what's already below/beside. */
export function stepSpawnClimb(state) {
  if (state.won) return;
  const R = state.rules;
  for (let x = 0; x < R.cols; x++)
    if (state.grid[0][x] === EMPTY && state.rng() < (R.spawnDensity || 0))
      putGem(state, x, 0, spawnColor(state, x, 0));
}

/* energy for a BRIGHT run of n; beyond the table, +8 per extra gem */
function payout(state, n) {
  const sc = state.rules.scoring || { 3: 3, 4: 8, 5: 20 };
  if (n < 3) return 0;
  if (sc[n] != null) return sc[n];
  const top = Math.max(...Object.keys(sc).map(Number));
  return sc[top] + (n - top) * 8;
}

/* Clear every maximal H/V run of length >= 3. A run with >= 3 BRIGHT cells
   harvests energy (payout by bright length × the spree multiplier); dark/dim
   runs clear for hygiene but score nothing. Harvesting funds building — it does
   NOT move the light. */
export function resolveClimb(state, mult = 1) {
  const R = state.rules, g = state.grid;
  const clear = new Set();
  let energy = 0, popped = false;

  const scan = (cells) => {
    let brightLen = 0;
    for (const [x, y] of cells) { clear.add(x + ',' + y); if (isBright(state, x, y)) brightLen++; }
    if (brightLen >= 3) { energy += payout(state, brightLen) * mult; popped = true; }
  };
  for (let y = 0; y < R.rows; y++) {
    let x = 0;
    while (x < R.cols) {
      const c = g[y][x];
      if (c === EMPTY) { x++; continue; }
      let xe = x; while (xe + 1 < R.cols && g[y][xe + 1] === c) xe++;
      if (xe - x + 1 >= 3) { const run = []; for (let i = x; i <= xe; i++) run.push([i, y]); scan(run); }
      x = xe + 1;
    }
  }
  for (let x = 0; x < R.cols; x++) {
    let y = 0;
    while (y < R.rows) {
      const c = g[y][x];
      if (c === EMPTY) { y++; continue; }
      let ye = y; while (ye + 1 < R.rows && g[ye + 1][x] === c) ye++;
      if (ye - y + 1 >= 3) { const run = []; for (let j = y; j <= ye; j++) run.push([x, j]); scan(run); }
      y = ye + 1;
    }
  }

  if (clear.size === 0) return { changed: false, popped: false, energy: 0 };
  for (const k of clear) {
    const ci = k.indexOf(','); const x = +k.slice(0, ci), y = +k.slice(ci + 1);
    if (state.events) state.events.popping.push({ x, y, lit: isBright(state, x, y) });
    clearGem(state, x, y);
  }
  if (energy > 0) { state.harvested += energy; state.energy += energy; }
  return { changed: true, popped, energy };
}

/* ---- light (PER COLUMN) ---- */
function computeBrightCeil(state, x) {
  const R = state.rules;
  let ceil = R.rows - R.baseReach;
  const m = state.pieces.get('amp');
  if (!m || m.size === 0) return ceil;
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of m.keys()) {
      const ci = key.indexOf(','); const ax = +key.slice(0, ci);
      if (ax !== x) continue;
      const s = +key.slice(ci + 1);               // seam row
      if (s >= ceil) {                            // fed: its lower cell is bright
        const nc = Math.max(0, s - R.lensReach);
        if (nc < ceil) { ceil = nc; changed = true; }
      }
    }
  }
  return ceil;
}
function brightCeils(state) {
  if (state._bc && state._bcGen === state.lightGen) return state._bc;
  const R = state.rules, arr = new Array(R.cols);
  for (let x = 0; x < R.cols; x++) arr[x] = computeBrightCeil(state, x);
  state._bc = arr; state._bcGen = state.lightGen;
  return arr;
}
function dimCeilFrom(R, brightCeil) { return Math.max(0, brightCeil - (R.dimBand || 0)); }

export function brightCeiling(state, x) { return brightCeils(state)[x]; }
export function dimCeiling(state, x) { return dimCeilFrom(state.rules, brightCeils(state)[x]); }
export function frontier(state) { const a = brightCeils(state); let m = a[0]; for (const v of a) if (v < m) m = v; return m; }
/* columns whose bright light has reached the Source (row 0). Light the whole
   shaft (every column) to win — that's the satisfying climax, not one column. */
export function litColumns(state) { const a = brightCeils(state); let n = 0; for (const v of a) if (v <= 0) n++; return n; }
export function zoneAt(state, x, y) {
  if (!inBounds(state, x, y)) return 'dark';
  const bc = brightCeils(state)[x];
  if (y >= bc) return 'bright';
  if (y >= dimCeilFrom(state.rules, bc)) return 'dim';
  return 'dark';
}
export function isBright(state, x, y) { return inBounds(state, x, y) && y >= brightCeils(state)[x]; }
export function isBuildable(state, x, y) { return inBounds(state, x, y) && y >= dimCeilFrom(state.rules, brightCeils(state)[x]); }
export function isVisible(state, x, y) { return isBuildable(state, x, y); }
/* Crack progress 0..1 for a resting, decaying gem (0 = settling/intact). */
export function crackStage(state, x, y) {
  const R = state.rules;
  const r = state.rest[y][x];
  if (r <= (R.settle || 0)) return 0;
  return Math.min(1, (r - (R.settle || 0)) / (R.crack || 1));
}

/* ---- placement / actions ---- */
export function costOf(state, toolId) {
  const c = state.rules.costs;
  return (c && c[toolId] != null) ? c[toolId] : 0;
}
const CLH = { EMPTY, inBounds, isBuildable, brightCeiling };
/* The single seam where a lens in column x is "fed" and actually climbs: the
   column's current bright ceiling. Placing anywhere else would do nothing, so the
   UI offers only this spot. Returns -1 if the column already reaches the Source. */
export function lensSpot(state, x) {
  const bc = brightCeiling(state, x);
  return bc >= 1 ? bc : -1;
}
/* Place a structure if affordable and legal; deduct its cost. Directional pieces
   carry {dir} (+ sorter {tc}); seam pieces carry true. */
export function placeClimb(state, toolId, pos) {
  const t = findTool(state.rules, toolId);
  if (!t || t.kind === 'action') return false;
  if (t.validate && !t.validate(state, pos, CLH)) return false;
  const m = state.pieces.get(toolId);
  if (!m) return false;
  const key = pos.x + ',' + pos.y;
  if (m.has(key)) return false;
  const cost = costOf(state, toolId);
  if (state.energy < cost) return false;
  let payload = true;
  if (t.sorter) payload = { tc: pos.tc != null ? pos.tc : 0, dir: pos.dir === -1 ? -1 : 1 };
  else if (t.dirPiece) payload = { dir: pos.dir === -1 ? -1 : 1 };
  m.set(key, payload);
  state.energy -= cost; state.spent += cost;
  if (t.extendsLight) state.lightGen++;
  return true;
}
/* Remove a structure — full refund (only gameplay destruction costs you). */
export function removeClimb(state, toolId, pos) {
  const m = state.pieces.get(toolId);
  if (!m) return false;
  const key = pos.x + ',' + pos.y;
  if (!m.has(key)) return false;
  m.delete(key);
  const t = findTool(state.rules, toolId);
  const cost = costOf(state, toolId);
  state.energy += cost; state.spent -= cost;
  if (t && t.extendsLight) state.lightGen++;
  return true;
}
/* Cycle a placed directional piece in place (ramp/conveyor flip; sorter cycles
   target colour). Free — it's a tweak, not a new build. */
export function adjustClimb(state, toolId, pos) {
  const t = findTool(state.rules, toolId);
  const m = state.pieces.get(toolId);
  if (!t || !m) return false;
  const p = m.get(pos.x + ',' + pos.y);
  if (!p) return false;
  if (t.sorter) p.tc = ((p.tc | 0) + 1) % state.rules.ncol;
  else if (t.dirPiece) p.dir = -(p.dir || 1);
  else return false;
  return true;
}
/* Bomb: destroy one gem in a cell. Free. */
export function bombClimb(state, x, y) {
  if (!inBounds(state, x, y) || state.grid[y][x] === EMPTY) return false;
  clearGem(state, x, y);
  return true;
}

/* =====================================================================
   GLITTERDELVE CLIMB ENGINE (demo 2) — headless, deterministic.
   Bottom-anchored rising light, per-fall-step decay, energy economy.
   Reuses the pure helpers from engine.js; engine.js/demo.html untouched.
   ===================================================================== */
import { mulberry32 } from './rng.js';
import { matchesAt, allMatches, spawnColor, inBounds, canRest, EMPTY } from './engine.js';

export { EMPTY, inBounds };

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

/* ---- tool-capability lookups over the climb registry ---- */
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

function findTool(R, id) { for (const t of R.tools) if (t.id === id) return t; return null; }

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
/* energy for a lit run of n gems, from rules.scoring; runs beyond the table
   extrapolate from the top entry (+5 per extra gem). */
function payout(state, n) {
  const sc = state.rules.scoring || { 3: 3, 4: 6, 5: 12 };
  if (n < 3) return 0;
  if (sc[n] != null) return sc[n];
  return 12 + (n - 5) * 5;
}

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

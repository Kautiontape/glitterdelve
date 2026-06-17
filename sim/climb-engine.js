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
export function tickClimb() { throw new Error('not implemented'); }
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
export function resolveClimb() { throw new Error('not implemented'); }
export function stepSwappersClimb() { throw new Error('not implemented'); }
export function stepSpawnClimb() { throw new Error('not implemented'); }
export function placeClimb() { throw new Error('not implemented'); }
export function removeClimb() { throw new Error('not implemented'); }
export function bombClimb() { throw new Error('not implemented'); }
export function costOf() { throw new Error('not implemented'); }
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

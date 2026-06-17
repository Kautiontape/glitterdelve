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

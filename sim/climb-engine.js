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
/* Move a gem one row down (straight or diagonal), carrying its life. A fragile
   Lens on the destination seam breaks (and is removed); the gem still passes.
   Life is NOT spent here — gems only lose luster in the dark (see decayDark). */
function fallInto(state, fx, fy, tx, ty) {
  const lensId = fragileAtSeam(state, tx, ty);
  if (lensId) {
    state.pieces.get(lensId).delete(tx + ',' + ty);
    if (state.events) state.events.broke.push({ x: tx, y: ty, lens: true });
  }
  moveGem(state, fx, fy, tx, ty, state.life[fy][fx]);
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
    // light is bottom-anchored (base band) and raised only by lenses — see lightCeiling
    energy: R.startGrant != null ? R.startGrant : 9,
    harvested: 0, spent: 0, lost: 0, won: false, ticks: 0,
    rng: mulberry32((seed | 0) >>> 0),
    events: opts.record ? { popping: [], broke: [] } : null,
  };
  prefill(state);
  return state;
}
/* One climb tick: machines -> resolve -> gravity -> decay-dark -> spawn -> resolve.
   Win when lenses have pushed the light all the way to the Source (row 0). */
export function tickClimb(state) {
  if (state.won) return;
  if (state.events) { state.events.popping.length = 0; state.events.broke.length = 0; }
  stepSwappersClimb(state);
  resolveClimb(state);
  stepGravityClimb(state);
  decayDark(state);
  stepSpawnClimb(state);
  resolveClimb(state);
  if (lightCeiling(state) <= 0) state.won = true;
  state.ticks++;
}
/* Gems lose one life per tick spent in a DARK cell (falling or resting); lit gems
   are safe. This is why you extend the light upward — it keeps gems alive and lets
   them pile up. Resting gems above the light line erode, so piles self-limit. */
export function decayDark(state) {
  const R = state.rules;
  const ceil = lightCeiling(state); // rows 0..ceil-1 are dark
  for (let y = 0; y < ceil; y++) {
    for (let x = 0; x < R.cols; x++) {
      if (state.grid[y][x] === EMPTY) continue;
      const nl = state.life[y][x] - 1;
      if (nl <= 0) { clearGem(state, x, y); state.lost++; if (state.events) state.events.broke.push({ x, y }); }
      else state.life[y][x] = nl;
    }
  }
}
export function stepGravityClimb(state) {
  const R = state.rules;
  // gems pile up: anything resting on the floor stays (no drain). Match it or bomb it.
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
   LIT cells harvests energy (payout by lit length); dark runs clear for hygiene
   but score nothing. Cells shared by an H and a V run clear once but score in
   both (a cross bonus). Harvesting funds building — it does NOT move the light. */
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
const CLH = { inBounds, canRest, isLit, lightCeiling, EMPTY };
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
/* The topmost lit world row (full width). The base band lights rows
   [rows-baseReach .. rows-1]; any fed Lens (extendsLight) pushes the ceiling
   UP across the whole delve. A lens at seam s is "fed" when s >= the current
   ceiling (its lower side is lit); it then lights up to row s - reach. Iterates
   so lenses chain. Reaching row 0 means the light has touched the Source. */
export function lightCeiling(state) {
  const R = state.rules;
  let ceil = R.rows - R.baseReach;
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of R.tools) {
      const ext = t.extendsLight;
      if (!ext) continue;
      const m = state.pieces.get(t.id);
      if (!m) continue;
      const reach = ext.rule ? (R[ext.rule] || 0) : (ext.reach || 0);
      for (const key of m.keys()) {
        const s = +key.slice(key.indexOf(',') + 1); // seam row
        if (s >= ceil) {
          const nc = Math.max(0, s - reach);
          if (nc < ceil) { ceil = nc; changed = true; }
        }
      }
    }
  }
  return ceil;
}
export function isLit(state, x, y) {
  if (!inBounds(state, x, y)) return false;
  return y >= lightCeiling(state);
}

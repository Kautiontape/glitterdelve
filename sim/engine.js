/* =====================================================================
   GLITTERDELVE ENGINE  (headless, deterministic, ruleset-driven)

   A faithful port of demo.html's rules, with two changes so simulations
   are reproducible and runnable without a DOM:
     - all randomness comes from a seeded RNG (state.rng), not Math.random
     - the "fading" timestamp (was performance.now) is just a Set; nothing
       in the logic depends on wall-clock time.

   The engine has NO hardcoded tool list. It reads tool definitions from
   state.rules.tools and dispatches generically by capability:
     - blocksFall      -> consulted by blockedBelow (Wall, Lens)
     - extendsLight    -> consulted by light reach (Lens)
     - tick(s,map,H)   -> machine phase (Sorter's swap-on-match)
     - divert + {dir,flip} payload -> diverter in gravity (Fork)
     - kind:'action'   -> invoked by the agent, not placed (Cut)
   See rules.js for the default registry that reproduces demo.html exactly.
   ===================================================================== */
import { mulberry32 } from './rng.js';

export const EMPTY = -1;
const EMPTY_MAP = new Map();

/* ---- small geometry helpers ---- */
export function inBounds(state, x, y) {
  const R = state.rules;
  return x >= 0 && x < R.cols && y >= 0 && y < R.rows;
}
export function canRest(state, x, y) {
  return inBounds(state, x, y) && state.grid[y][x] === EMPTY;
}
function findTool(rules, id) {
  for (const t of rules.tools) if (t.id === id) return t;
  return null;
}

/* ---- lattice queries (generic over the tool registry) ---- */
/* A barrier sits on the horizontal seam ABOVE cell (x,y): key "x,y" means the
   seam between (x,y-1) and (x,y). A gem at (x,y) is blocked from falling if any
   blocksFall tool occupies the seam below it, i.e. key "x,(y+1)". */
function blockedBelow(state, x, y) {
  const key = x + ',' + (y + 1);
  for (const tool of state.rules.tools) {
    if (!tool.blocksFall) continue;
    const m = state.pieces.get(tool.id);
    if (m && m.has(key)) return true;
  }
  return false;
}
/* How many cells of light (if any) an extendsLight piece on the seam above
   cell (cx,y) relays downward. 0 if none. Supports tools whose reach is a fixed
   number ({reach:N}) or a named rule field ({rule:'ampReach'}). */
function ampReachAt(state, cx, y) {
  let best = 0;
  for (const tool of state.rules.tools) {
    const ext = tool.extendsLight;
    if (!ext) continue;
    const m = state.pieces.get(tool.id);
    if (m && m.has(cx + ',' + y)) {
      const reach = ext.rule ? state.rules[ext.rule] || 0 : ext.reach || 0;
      if (reach > best) best = reach;
    }
  }
  return best;
}

/* ---- light ---- */
export function isCharged(state, x) {
  return x >= 0 && x < state.rules.cols && state.litCols[x];
}
/* Light depth for a column: anchor is infinite; a charged column reaches
   baseReach, extended by any relay seam inside its lit span. depth=-1 if dark.
   Cached per-tick: invalidated by state.lightGen, which bumps whenever the lit
   set or a light-affecting piece changes (ignite/place/remove). lightReach is
   called per-gem every tick, so this is the engine's main hot-path win. */
export function lightReach(state, cx) {
  const R = state.rules;
  if (cx < 0 || cx >= R.cols) return { depth: -1, ampSeams: [] };
  let cache = state._lrCache;
  if (!cache || cache.gen !== state.lightGen) { cache = { gen: state.lightGen, arr: new Array(R.cols) }; state._lrCache = cache; }
  if (cache.arr[cx] !== undefined) return cache.arr[cx];
  const res = computeLightReach(state, cx);
  cache.arr[cx] = res;
  return res;
}
function computeLightReach(state, cx) {
  const R = state.rules;
  if (!isCharged(state, cx)) return { depth: -1, ampSeams: [] };
  if (cx === R.anchor) return { depth: R.rows - 1, ampSeams: collectAmpSeams(state, cx, R.rows - 1) };
  let depth = R.baseReach - 1;
  const ampSeams = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 1; y <= Math.min(depth + 1, R.rows - 1); y++) {
      const reach = ampReachAt(state, cx, y);
      if (reach > 0 && y - 1 <= depth) {
        const nd = Math.min(R.rows - 1, y - 1 + reach);
        if (nd > depth) {
          depth = nd;
          changed = true;
        }
        if (!ampSeams.includes(y)) ampSeams.push(y);
      }
    }
  }
  return { depth: Math.min(depth, R.rows - 1), ampSeams };
}
function collectAmpSeams(state, cx, maxDepth) {
  const s = [];
  for (let y = 1; y <= maxDepth; y++) if (ampReachAt(state, cx, y) > 0) s.push(y);
  return s;
}
export function isLit(state, x, y) {
  if (!isCharged(state, x)) return false;
  return y <= lightReach(state, x).depth;
}
/* The deepest row a column COULD light if charged (ignoring flicker) — used to
   validate relay placement so you can build on a column that isn't lit yet. */
export function potentialReach(state, cx) {
  const R = state.rules;
  if (cx === R.anchor) return R.rows - 1;
  let depth = R.baseReach - 1;
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = 1; y <= Math.min(depth + 1, R.rows - 1); y++) {
      const reach = ampReachAt(state, cx, y);
      if (reach > 0 && y - 1 <= depth) {
        const nd = Math.min(R.rows - 1, y - 1 + reach);
        if (nd > depth) {
          depth = nd;
          changed = true;
        }
      }
    }
  }
  return Math.min(depth, R.rows - 1);
}

/* ---- match detection ---- */
export function matchesAt(state, x, y) {
  const R = state.rules, g = state.grid, set = new Set(), c = g[y][x];
  if (c === EMPTY) return set;
  let xs = x; while (xs - 1 >= 0 && g[y][xs - 1] === c) xs--;
  let xe = x; while (xe + 1 < R.cols && g[y][xe + 1] === c) xe++;
  if (xe - xs + 1 >= 3) for (let i = xs; i <= xe; i++) set.add(i + ',' + y);
  let ys = y; while (ys - 1 >= 0 && g[ys - 1][x] === c) ys--;
  let ye = y; while (ye + 1 < R.rows && g[ye + 1][x] === c) ye++;
  if (ye - ys + 1 >= 3) for (let j = ys; j <= ye; j++) set.add(x + ',' + j);
  return set;
}
export function allMatches(state) {
  const R = state.rules, set = new Set();
  for (let y = 0; y < R.rows; y++)
    for (let x = 0; x < R.cols; x++) {
      if (state.grid[y][x] === EMPTY) continue;
      for (const k of matchesAt(state, x, y)) set.add(k);
    }
  return set;
}
/* Every adjacent swap that would create a match (the legal "Cut" moves).
   Returns [{a,b,size,lit}] — size is a rough match magnitude, lit=1 if either
   cell is in the light (i.e. the swap would actually score). */
export function findMatchingSwaps(state) {
  const R = state.rules, g = state.grid, out = [];
  for (let y = 0; y < R.rows; y++)
    for (let x = 0; x < R.cols; x++) {
      const v = g[y][x];
      if (v === EMPTY) continue;
      const neigh = [[x + 1, y], [x, y + 1]];
      for (const [nx, ny] of neigh) {
        if (nx >= R.cols || ny >= R.rows) continue;
        const w = g[ny][nx];
        if (w === EMPTY || w === v) continue;
        g[y][x] = w; g[ny][nx] = v;
        const m = matchesAt(state, x, y).size + matchesAt(state, nx, ny).size;
        g[y][x] = v; g[ny][nx] = w;
        if (m > 0) out.push({ a: { x, y }, b: { x: nx, y: ny }, size: m, lit: isLit(state, x, y) || isLit(state, nx, ny) ? 1 : 0 });
      }
    }
  return out;
}

/* ---- spawning (seeded) ---- */
/* Choose a color for cell (x,y) that does not hand a free 3-run — every match
   must be earned by a swap/route. Falls back to any color if all collide. */
export function spawnColor(state, x, y) {
  const R = state.rules, g = state.grid, N = R.ncol;
  const bad = new Set();
  if (inBounds(state, x, y + 1) && inBounds(state, x, y + 2) && g[y + 1][x] !== EMPTY && g[y + 1][x] === g[y + 2][x]) bad.add(g[y + 1][x]);
  const L1 = inBounds(state, x - 1, y) ? g[y][x - 1] : EMPTY;
  const L2 = inBounds(state, x - 2, y) ? g[y][x - 2] : EMPTY;
  const R1 = inBounds(state, x + 1, y) ? g[y][x + 1] : EMPTY;
  const R2 = inBounds(state, x + 2, y) ? g[y][x + 2] : EMPTY;
  if (L1 !== EMPTY && L1 === L2) bad.add(L1);
  if (R1 !== EMPTY && R1 === R2) bad.add(R1);
  if (L1 !== EMPTY && L1 === R1) bad.add(L1);
  const choices = [];
  for (let c = 0; c < N; c++) if (!bad.has(c)) choices.push(c);
  const pool = choices.length ? choices : Array.from({ length: N }, (_, i) => i);
  return pool[Math.floor(state.rng() * pool.length)];
}
/* Drop up to n gems into the top run of empty cells of column x (match payout). */
export function refill(state, x, n) {
  const R = state.rules, g = state.grid;
  let placed = 0;
  for (let y = 0; y < R.rows && placed < n; y++) {
    if (g[y][x] === EMPTY) { g[y][x] = spawnColor(state, x, y); placed++; }
    else break;
  }
}
/* Permanently latch a neighbour column on, seeded so it's immediately playable. */
export function ignite(state, x) {
  const R = state.rules;
  if (x < 0 || x >= R.cols) return;
  if (!state.litCols[x]) {
    state.litCols[x] = true;
    state.lightGen++; // invalidate the lightReach cache
    if (state.events) state.events.newlyLit.push(x);
    refill(state, x, 3);
  }
}

/* ---- the three core phases (faithful to demo.html) ---- */
/* find a diverter (Fork) piece sitting in cell (x,y) */
function divertPieceAt(state, x, y) {
  for (const tool of state.rules.tools) {
    if (!tool.divert || tool.seam !== 'cell') continue;
    const m = state.pieces.get(tool.id);
    const p = m && m.get(x + ',' + y);
    if (p) return { tool, piece: p };
  }
  return null;
}
export function stepGravity(state) {
  const R = state.rules, g = state.grid;
  // anything marked fading last tick is now lost to the dark
  for (const key of state.fading) {
    const [x, y] = key.split(',').map(Number);
    if (g[y][x] !== EMPTY) { g[y][x] = EMPTY; state.lostToDark++; }
  }
  state.fading.clear();

  for (let y = R.rows - 2; y >= 0; y--) {
    for (let x = 0; x < R.cols; x++) {
      const c = g[y][x];
      if (c === EMPTY) continue;
      if (blockedBelow(state, x, y)) continue; // wall/lens holds it
      const below = y + 1;
      const litDepth = lightReach(state, x).depth; // -1 dark, rows-1 anchor
      if (below > litDepth) {
        state.fading.add(x + ',' + y); // falling past the light -> fades, lost next tick
        continue;
      }
      const fork = divertPieceAt(state, x, y);
      if (fork && fork.piece.flip) {
        const tx = x + fork.piece.dir;
        if (tx >= 0 && tx < R.cols && below <= lightReach(state, tx).depth && canRest(state, tx, below)) {
          g[below][tx] = c; g[y][x] = EMPTY; fork.piece.flip = !fork.piece.flip; continue;
        }
      }
      if (canRest(state, x, below)) {
        g[below][x] = c; g[y][x] = EMPTY;
        if (fork) fork.piece.flip = !fork.piece.flip;
      }
    }
  }
  // anchor floor: a gem resting on the bottom of the infinite column is harvested
  if (g[R.rows - 1][R.anchor] !== EMPTY) { state.collected++; g[R.rows - 1][R.anchor] = EMPTY; }
}
/* Only the anchor spawns freely each tick (the heartbeat). Every other lit
   column is fed solely by match payouts (resolveBoard -> refill). */
export function stepSpawn(state) {
  const R = state.rules, g = state.grid;
  if (g[0][R.anchor] === EMPTY) g[0][R.anchor] = spawnColor(state, R.anchor, 0);
}
/* Clear standing matches. Lit matched cells score and ignite the neighbour
   further from centre; dark matches clear but capture/ignite nothing. */
export function resolveBoard(state) {
  const m = allMatches(state);
  if (m.size === 0) return false;
  const R = state.rules, g = state.grid;
  const perCol = new Map();
  for (const k of m) {
    const [x, y] = k.split(',').map(Number);
    const lit = isLit(state, x, y);
    if (lit) { state.collected++; perCol.set(x, (perCol.get(x) || 0) + 1); }
    if (state.events) state.events.popping.push({ x, y, lit });
    g[y][x] = EMPTY;
  }
  for (const [x, n] of perCol) {
    if (x !== R.anchor) refill(state, x, n); // match-driven payout
    if (x === R.anchor) { ignite(state, x - 1); ignite(state, x + 1); }
    else if (x < R.anchor) ignite(state, x - 1);
    else ignite(state, x + 1);
  }
  return true;
}

/* ---- player / agent actions ---- */
export function playerSwap(state, a, b) {
  const g = state.grid;
  if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return false;
  if (!inBounds(state, a.x, a.y) || !inBounds(state, b.x, b.y)) return false;
  const va = g[a.y][a.x], vb = g[b.y][b.x];
  if (va === EMPTY || vb === EMPTY) return false;
  g[a.y][a.x] = vb; g[b.y][b.x] = va;
  if (matchesAt(state, a.x, a.y).size > 0 || matchesAt(state, b.x, b.y).size > 0) { resolveBoard(state); return true; }
  g[a.y][a.x] = va; g[b.y][b.x] = vb; // revert: no match
  return false;
}
export function place(state, toolId, pos) {
  const tool = findTool(state.rules, toolId);
  if (!tool || tool.kind === 'action') return false;
  if (tool.validate && !tool.validate(state, pos, H)) return false;
  const m = state.pieces.get(toolId);
  if (!m) return false;
  const payload = tool.divert ? { dir: pos.dir === -1 ? -1 : 1, flip: false } : true;
  m.set(pos.x + ',' + pos.y, payload);
  if (tool.extendsLight) state.lightGen++; // a Lens changes the light map
  return true;
}
export function remove(state, toolId, pos) {
  const m = state.pieces.get(toolId);
  if (!m) return false;
  const tool = findTool(state.rules, toolId);
  const had = m.delete(pos.x + ',' + pos.y);
  if (had && tool && tool.extendsLight) state.lightGen++;
  return had;
}
export function applyAction(state, action) {
  if (!action) return false;
  if (action.type === 'swap') return playerSwap(state, action.a, action.b);
  if (action.type === 'place') return place(state, action.tool, action);
  if (action.type === 'remove') return remove(state, action.tool, action);
  return false;
}

/* ---- lifecycle ---- */
export function countLit(litCols) {
  let n = 0;
  for (const v of litCols) if (v) n++;
  return n;
}
export function columnsLit(state) {
  return countLit(state.litCols);
}
export function createState(rules, seed, opts = {}) {
  const R = rules;
  const grid = [];
  for (let y = 0; y < R.rows; y++) grid.push(new Array(R.cols).fill(EMPTY));
  const litCols = new Array(R.cols).fill(false);
  litCols[R.anchor] = true;
  if (R.anchor - 1 >= 0) litCols[R.anchor - 1] = true;
  if (R.anchor + 1 < R.cols) litCols[R.anchor + 1] = true;
  const pieces = new Map();
  for (const tool of R.tools) if (tool.kind !== 'action') pieces.set(tool.id, new Map());
  const state = {
    rules: R,
    grid,
    litCols,
    pieces,
    collected: 0,
    lostToDark: 0,
    fading: new Set(),
    ticks: 0,
    peakLit: countLit(litCols),
    rng: mulberry32((seed | 0) >>> 0),
    events: opts.record ? { popping: [], newlyLit: [] } : null,
    lightGen: 0, // bumped when the light map changes; invalidates lightReach cache
    _lrCache: null,
  };
  // seed the starting first-ring columns (anchor self-fills via the heartbeat)
  if (R.anchor - 1 >= 0) refill(state, R.anchor - 1, 3);
  if (R.anchor + 1 < R.cols) refill(state, R.anchor + 1, 3);
  return state;
}
/* Advance one simulation tick through the configured phase order. */
export function tick(state) {
  const R = state.rules;
  if (state.events) { state.events.popping.length = 0; state.events.newlyLit.length = 0; }
  for (const phase of R.tickOrder) {
    if (phase === 'machines') {
      for (const tool of R.tools)
        if (typeof tool.tick === 'function') tool.tick(state, state.pieces.get(tool.id) || EMPTY_MAP, H);
    } else if (phase === 'resolve') resolveBoard(state);
    else if (phase === 'gravity') stepGravity(state);
    else if (phase === 'spawn') stepSpawn(state);
  }
  state.ticks++;
  const lit = countLit(state.litCols);
  if (lit > state.peakLit) state.peakLit = lit;
}

/* ---- reporting ---- */
export function metricsOf(state) {
  const pieces = {};
  let total = 0;
  for (const [id, m] of state.pieces) { pieces[id] = m.size; total += m.size; }
  return {
    collected: state.collected,
    lostToDark: state.lostToDark,
    litFinal: countLit(state.litCols),
    litPeak: state.peakLit,
    ticks: state.ticks,
    pieces,
    piecesTotal: total,
  };
}
/* A compact, serializable board snapshot for thumbnails / replay overlays. */
export function snapshot(state) {
  const pieces = {};
  for (const [id, m] of state.pieces) pieces[id] = [...m.entries()];
  return {
    grid: state.grid.map((row) => row.slice()),
    litCols: state.litCols.slice(),
    pieces,
    fading: [...state.fading],
    collected: state.collected,
    lostToDark: state.lostToDark,
    ticks: state.ticks,
    anchor: state.rules.anchor,
  };
}
/* Turn a snapshot back into a render-able view (pieces as Maps, fading as Set). */
export function viewFromSnapshot(snap, rules) {
  const pieces = new Map();
  for (const id in snap.pieces) pieces.set(id, new Map(snap.pieces[id]));
  return {
    rules,
    grid: snap.grid,
    litCols: snap.litCols,
    pieces,
    fading: new Set(snap.fading),
  };
}

/* Helper bundle handed to tool methods (and reused by the runner to build the
   agent API). Declared last so all functions above are in scope. */
export const H = {
  EMPTY,
  inBounds,
  canRest,
  isCharged,
  isLit,
  lightReach,
  potentialReach,
  matchesAt,
  allMatches,
  findMatchingSwaps,
  columnsLit,
};

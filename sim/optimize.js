/* =====================================================================
   BUILD OPTIMIZER

   Goal: find the static whole-board LAYOUT (a set of tool placements) that
   maximizes mean points over X seeds of T ticks, with NO cutting — the build
   must stand on its own as an autonomous machine.

   Problem class: noisy black-box combinatorial optimization on a fixed board.
   The single most important thing for reliability is the EVALUATION protocol:
   every candidate is scored on the SAME seed set (common random numbers), so
   "build A > build B" is a low-variance comparison rather than RNG luck.

   A "layout" is just an array of placements [{tool,x,y,dir?}] — i.e. a
   staticBuild plan. So the winner is directly replayable in the viewer.

   Three optimizers share one evaluator:
     - greedyBeam : constructive planner (add the best piece; keep top-B), with
                    racing (cheap seeds to shortlist, full seeds to confirm)
     - anneal     : simulated annealing over single-piece edits
     - genetic    : population + region-crossover + mutation
   ===================================================================== */
import { mulberry32 } from './rng.js';
import { makeRules } from './rules.js';
import { createState, tick, place, metricsOf } from './engine.js';
import { objective, DEFAULT_WEIGHTS } from './runner.js';

/* ---------- layout helpers ---------- */
export function keyOf(p) { return `${p.tool}:${p.x},${p.y}`; } // dir excluded: one piece per slot
function dedup(layout) {
  const seen = new Set(), out = [];
  for (const p of layout) { const k = keyOf(p); if (!seen.has(k)) { seen.add(k); out.push(p); } }
  return out;
}
/* place a whole layout at t=0. Lenses go last, shallow->deep per column, so the
   reach-gated validation passes when they're pre-placed before the column lights. */
export function applyLayout(state, layout) {
  const amps = [], others = [];
  for (const p of layout) (p.tool === 'amp' ? amps : others).push(p);
  for (const p of others) place(state, p.tool, p);
  amps.sort((a, b) => a.x - b.x || a.y - b.y);
  for (const p of amps) place(state, p.tool, p);
}

/* the set of placements the search may use (a bounded box around the active
   region — pieces far in the dark never help, so we don't waste evals on them) */
/* The GA/SA gene pool = every atomic placement in the box. DEFAULT is the WHOLE
   board (colSpan covers all columns, maxRow every row) so the pool equals the
   complete alphabet — every piece the engine can place. Greedy may pass a smaller
   box for speed, but a "full gamut" search must use the defaults. */
export function candidatePlacements(rules, cfg = {}) {
  const span = cfg.colSpan ?? Math.floor(rules.cols / 2); // covers every column
  const maxRow = cfg.maxRow ?? rules.rows - 1;            // covers every row
  const A = rules.anchor;
  const lo = Math.max(0, A - span), hi = Math.min(rules.cols - 1, A + span);
  const tools = cfg.tools || SEARCH_TOOLS;
  const out = [];
  for (let x = lo; x <= hi; x++) {
    for (let y = 0; y <= maxRow; y++) {
      if (tools.includes('dam') && y >= 1) out.push({ tool: 'dam', x, y });
      if (tools.includes('amp') && y >= 1) out.push({ tool: 'amp', x, y });
      if (tools.includes('swap') && x >= 1) out.push({ tool: 'swap', x, y });
      if (tools.includes('split')) { out.push({ tool: 'split', x, y, dir: 1 }); out.push({ tool: 'split', x, y, dir: -1 }); }
    }
  }
  return out;
}

/* Tools the SEARCH considers. Walls are dropped: a Lens strictly dominates a Wall
   (blocks fall AND relays light) while pieces are free, so a wall can never beat a
   lens in the same spot. h-seam alleles are therefore {none, lens}. The engine
   still supports walls — this only trims the optimizer's alphabet. */
export const SEARCH_TOOLS = ['amp', 'swap', 'split'];

/* The number of distinct atomic placements over a given tool set — the size of
   the allele alphabet. A full-board candidate pool should equal this. */
export function fullAlphabet(rules, tools = SEARCH_TOOLS) {
  const parts = {}, hseam = rules.cols * (rules.rows - 1);
  if (tools.includes('dam')) parts.walls = hseam;
  if (tools.includes('amp')) parts.lenses = hseam;
  if (tools.includes('swap')) parts.sorters = (rules.cols - 1) * rules.rows;
  if (tools.includes('split')) parts.forks = rules.cols * rules.rows * 2; // ±dir
  parts.total = Object.values(parts).reduce((a, b) => a + b, 0);
  return parts;
}

/* ---------- the evaluator (common random numbers) ---------- */
export function evaluateBuild(layout, opts) {
  const { seeds, ticks, rulesOverride = {}, weights = DEFAULT_WEIGHTS } = opts;
  const rules = makeRules(rulesOverride);
  const scores = [], lit = [], lost = [], coll = [];
  let pieces = 0;
  for (const seed of seeds) {
    const s = createState(rules, seed);
    applyLayout(s, layout);
    for (let t = 0; t < ticks; t++) tick(s);
    const m = metricsOf(s);
    scores.push(objective(m, weights));
    lit.push(m.litFinal); lost.push(m.lostToDark); coll.push(m.collected);
    pieces = m.piecesTotal;
  }
  const n = scores.length;
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(scores.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  // collectedMean is raw points (weight-independent) for honest reporting even
  // when `mean` carries a parsimony penalty in `weights`.
  return { mean, std, scores, pieces, litMean: avg(lit), lostMean: avg(lost), collectedMean: avg(coll) };
}

/* ---------- mutation / breeding ---------- */
function randomLayout(pool, rng, k) {
  const out = [];
  for (let i = 0; i < k; i++) out.push(pool[Math.floor(rng() * pool.length)]);
  return dedup(out);
}
function mutate(layout, pool, rng) {
  const L = layout.slice();
  const r = rng();
  if (L.length === 0 || r < 0.45) { // add
    L.push(pool[Math.floor(rng() * pool.length)]);
  } else if (r < 0.75) { // remove
    L.splice(Math.floor(rng() * L.length), 1);
  } else if (r < 0.9) { // move (remove one, add one)
    L.splice(Math.floor(rng() * L.length), 1);
    L.push(pool[Math.floor(rng() * pool.length)]);
  } else { // flip a fork's direction
    const forks = L.map((p, i) => (p.tool === 'split' ? i : -1)).filter((i) => i >= 0);
    if (forks.length) { const i = forks[Math.floor(rng() * forks.length)]; L[i] = { ...L[i], dir: -(L[i].dir || 1) }; }
    else L.push(pool[Math.floor(rng() * pool.length)]);
  }
  return dedup(L);
}
/* region crossover: child takes the left of A and the right of B (the board is
   near-symmetric, so board halves are meaningful building blocks) */
function crossover(a, b, rng, cols) {
  const cut = Math.floor(rng() * (cols + 1));
  const child = [];
  for (const p of a) if (p.x < cut) child.push(p);
  for (const p of b) if (p.x >= cut) child.push(p);
  return dedup(child);
}

/* ---------- racing: shortlist on few seeds, confirm survivors on all ---------- */
function race(layouts, ctx, shortSeeds, keepN) {
  let ranked = layouts.map((l) => ({ l, r: evaluateBuild(l, { ...ctx, seeds: shortSeeds }) }));
  ctx.evals += layouts.length;
  ranked.sort((p, q) => q.r.mean - p.r.mean);
  ranked = ranked.slice(0, keepN);
  for (const it of ranked) { it.r = evaluateBuild(it.l, { ...ctx, seeds: ctx.seeds }); ctx.evals++; }
  ranked.sort((p, q) => q.r.mean - p.r.mean);
  return ranked;
}

/* ---------- optimizer 1: greedy + beam ---------- */
export function greedyBeam(ctx, cfg = {}) {
  const rules = makeRules(ctx.rulesOverride);
  const pool = candidatePlacements(rules, cfg);
  const beamWidth = cfg.beamWidth ?? 4;
  const expand = cfg.expand ?? 3;
  const short = ctx.seeds.slice(0, Math.min(cfg.racingSeeds ?? 4, ctx.seeds.length));
  const history = [];
  let beam = [{ layout: [], r: evaluateBuild([], { ...ctx, seeds: ctx.seeds }) }];
  ctx.evals++;
  let best = beam[0];
  history.push({ evals: ctx.evals, bestMean: best.r.mean, pieces: 0 });
  for (let step = 0; step < (cfg.maxPieces ?? 14); step++) {
    const proposals = [], seen = new Set();
    for (const m of beam) {
      const present = new Set(m.layout.map(keyOf));
      for (const c of pool) {
        if (present.has(keyOf(c))) continue;
        const nl = m.layout.concat([c]);
        const sig = nl.map(keyOf).sort().join('|');
        if (seen.has(sig)) continue;
        seen.add(sig);
        proposals.push(nl);
      }
    }
    if (!proposals.length) break;
    // Optional safety cap for huge candidate pools. OFF by default: random
    // sampling drops synergistic follow-ups and stalls greedy. Prefer shrinking
    // the pool via colSpan/maxRow instead of capping here.
    const cap = cfg.maxProposalsPerStep ?? Infinity;
    let pruned = proposals;
    if (proposals.length > cap) {
      pruned = proposals.slice();
      for (let i = pruned.length - 1; i > 0; i--) { const j = Math.floor(ctx.rng() * (i + 1)); [pruned[i], pruned[j]] = [pruned[j], pruned[i]]; }
      pruned = pruned.slice(0, cap);
    }
    const ranked = race(pruned, ctx, short, beamWidth * expand);
    const newBeam = ranked.slice(0, beamWidth).map((it) => ({ layout: it.l, r: it.r }));
    const stepBest = newBeam[0];
    history.push({ evals: ctx.evals, bestMean: Math.max(best.r.mean, stepBest.r.mean), pieces: stepBest.layout.length });
    if (ctx.onProgress) ctx.onProgress({ method: 'greedy', step: step + 1, evals: ctx.evals, bestMean: Math.max(best.r.mean, stepBest.r.mean) });
    if (stepBest.r.mean <= best.r.mean + (cfg.minGain ?? 1e-6)) break; // converged
    best = stepBest;
    beam = newBeam;
  }
  return { method: 'greedy', best: { layout: best.layout, mean: best.r.mean, std: best.r.std }, history, evals: ctx.evals };
}

/* ---------- optimizer 2: simulated annealing ---------- */
export function anneal(ctx, cfg = {}) {
  const rules = makeRules(ctx.rulesOverride);
  const pool = candidatePlacements(rules, cfg);
  const iters = cfg.iters ?? 600;
  let temp = cfg.T0 ?? 40;
  const cooling = cfg.cooling ?? 0.992;
  const history = [];
  let cur = cfg.init ? cfg.init.slice() : randomLayout(pool, ctx.rng, 4);
  let curR = evaluateBuild(cur, ctx); ctx.evals++;
  let best = cur, bestR = curR;
  for (let i = 0; i < iters; i++) {
    const cand = mutate(cur, pool, ctx.rng);
    const candR = evaluateBuild(cand, ctx); ctx.evals++;
    const d = candR.mean - curR.mean;
    if (d > 0 || ctx.rng() < Math.exp(d / Math.max(0.0001, temp))) { cur = cand; curR = candR; }
    if (curR.mean > bestR.mean) { best = cur; bestR = curR; }
    temp *= cooling;
    if (i % 20 === 0) {
      history.push({ evals: ctx.evals, bestMean: bestR.mean, pieces: best.length });
      if (ctx.onProgress) ctx.onProgress({ method: 'sa', iter: i, evals: ctx.evals, bestMean: bestR.mean });
    }
  }
  return { method: 'sa', best: { layout: best, mean: bestR.mean, std: bestR.std }, history, evals: ctx.evals };
}

/* ---------- optimizer 3: genetic algorithm ---------- */
export function genetic(ctx, cfg = {}) {
  const rules = makeRules(ctx.rulesOverride);
  const pool = candidatePlacements(rules, cfg);
  const popSize = cfg.popSize ?? 40;
  const gens = cfg.gens ?? 25;
  const eliteFrac = cfg.eliteFrac ?? 0.25;
  const history = [];
  let pop = [];
  if (cfg.seedLayouts) for (const l of cfg.seedLayouts) pop.push(l.slice());
  // init across a range of densities so dense structure can emerge if it's good
  // (not crippled to sparse starts). initMaxPieces keeps the old default unless raised.
  const initMax = cfg.initMaxPieces ?? 10;
  while (pop.length < popSize) pop.push(randomLayout(pool, ctx.rng, 1 + Math.floor(ctx.rng() * initMax)));
  let best = null, bestR = { mean: -Infinity };
  for (let g = 0; g < gens; g++) {
    const scored = pop.map((l) => ({ l, r: evaluateBuild(l, ctx) }));
    ctx.evals += pop.length;
    scored.sort((p, q) => q.r.mean - p.r.mean);
    if (scored[0].r.mean > bestR.mean) { best = scored[0].l; bestR = scored[0].r; }
    history.push({ evals: ctx.evals, bestMean: bestR.mean, pieces: best.length });
    if (ctx.onProgress) ctx.onProgress({ method: 'ga', gen: g + 1, evals: ctx.evals, bestMean: bestR.mean });
    const nElite = Math.max(2, Math.floor(popSize * eliteFrac));
    const elites = scored.slice(0, nElite).map((s) => s.l);
    const next = elites.slice();
    while (next.length < popSize) {
      const a = elites[Math.floor(ctx.rng() * elites.length)];
      const b = elites[Math.floor(ctx.rng() * elites.length)];
      let child = crossover(a, b, ctx.rng, rules.cols);
      if (ctx.rng() < (cfg.mutRate ?? 0.7)) child = mutate(child, pool, ctx.rng);
      next.push(child);
    }
    pop = next;
  }
  return { method: 'ga', best: { layout: best, mean: bestR.mean, std: bestR.std }, history, evals: ctx.evals };
}

/* ---------- parsimony: prune dead pieces from a winner ----------
   Greedily drop any piece whose removal doesn't cost more than `tol` points
   (under common random numbers). Guarantees a minimal build — the essential
   machinery, with neutral GA bloat removed. */
export function pruneBuild(layout, evalOpts, tol = 0.5) {
  let cur = layout.slice();
  let curScore = evaluateBuild(cur, evalOpts).collectedMean;
  let improved = true, evals = 1;
  while (improved) {
    improved = false;
    for (let i = cur.length - 1; i >= 0; i--) {
      const trial = cur.slice(0, i).concat(cur.slice(i + 1));
      const s = evaluateBuild(trial, evalOpts).collectedMean; evals++;
      if (s >= curScore - tol) { cur = trial; curScore = s; improved = true; }
    }
  }
  return { layout: cur, collectedMean: curScore, evals };
}

/* ---------- generative full-board PATTERN builds ----------
   The strongest builds are dense regular tilings (forks route gems outward,
   sorters auto-harvest, lenses deepen the light) — NOT sparse cell picks. So
   instead of choosing individual placements, we generate a whole-board layout
   from a handful of parameters and tune THOSE. Tiny genome, fills the board,
   lights all columns, converges fast. (No walls — the meta doesn't use them.) */
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const FORK_DIRS = ['out', 'in', 'alt'];
// stable per-cell hash in [0,1): density params threshold against this, so a
// pattern is fixed across game seeds and grows monotonically with density.
function cellHash(x, y, salt) {
  let n = (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663) ^ Math.imul(salt + 1, 83492791)) >>> 0;
  n ^= n << 13; n >>>= 0; n ^= n >>> 17; n ^= n << 5; n >>>= 0;
  return n / 4294967296;
}
export function buildFromParams(p, rules) {
  const A = rules.anchor, layout = [];
  // The anchor is the harvest chute + the only free gem source. Lenses dam it
  // and forks divert it, which kills the heartbeat (score -> 0). So keep the
  // anchor column clear of those; sorters on its seams are fine and help bootstrap.
  for (let x = 0; x < rules.cols; x++) {
    const anchorCol = x === A;
    for (let y = 0; y < rules.rows; y++) {
      if (!anchorCol && cellHash(x, y, 1) < p.forkDensity) {
        let dir = 1;
        if (p.forkDir === 'out') dir = x < A ? -1 : 1;
        else if (p.forkDir === 'in') dir = x < A ? 1 : -1;
        else dir = (x + y) % 2 ? 1 : -1;
        layout.push({ tool: 'split', x, y, dir });
      }
      if (x >= 1 && cellHash(x, y, 2) < p.sorterDensity) layout.push({ tool: 'swap', x, y });
      if (!anchorCol && p.lensSpacing >= 1 && y >= 1 && y % Math.round(p.lensSpacing) === 0) layout.push({ tool: 'amp', x, y });
    }
  }
  return dedup(layout);
}
function randomParams(rng) {
  return {
    forkDensity: rng(), sorterDensity: rng(),
    lensSpacing: Math.floor(rng() * 6), // 0=off, else a lens every N rows
    forkDir: FORK_DIRS[Math.floor(rng() * FORK_DIRS.length)],
  };
}
export function tunePattern(ctx, cfg = {}) {
  const rules = makeRules(ctx.rulesOverride);
  const samples = cfg.samples ?? 60, refine = cfg.refine ?? 40;
  const history = [];
  const evalP = (p) => { ctx.evals++; return { p, layout: buildFromParams(p, rules), r: evaluateBuild(buildFromParams(p, rules), ctx) }; };
  let best = null;
  for (let i = 0; i < samples; i++) {
    const c = evalP(randomParams(ctx.rng));
    if (!best || c.r.mean > best.r.mean) { best = c; }
    if (i % 5 === 0) { history.push({ evals: ctx.evals, bestMean: best.r.mean, pieces: best.layout.length }); if (ctx.onProgress) ctx.onProgress({ method: 'pattern', iter: i, evals: ctx.evals, bestMean: best.r.mean }); }
  }
  for (let step = 0; step < refine; step++) { // hill-climb around the best params
    const p = { ...best.p };
    const k = ctx.rng();
    if (k < 0.4) p.forkDensity = clamp01(p.forkDensity + (ctx.rng() - 0.5) * 0.3);
    else if (k < 0.8) p.sorterDensity = clamp01(p.sorterDensity + (ctx.rng() - 0.5) * 0.3);
    else if (k < 0.9) p.lensSpacing = Math.max(0, Math.min(5, p.lensSpacing + (ctx.rng() < 0.5 ? -1 : 1)));
    else p.forkDir = FORK_DIRS[Math.floor(ctx.rng() * FORK_DIRS.length)];
    const c = evalP(p);
    if (c.r.mean > best.r.mean) best = c;
    if (step % 5 === 0) { history.push({ evals: ctx.evals, bestMean: best.r.mean, pieces: best.layout.length }); if (ctx.onProgress) ctx.onProgress({ method: 'pattern', iter: samples + step, evals: ctx.evals, bestMean: best.r.mean }); }
  }
  return { method: 'pattern', best: { layout: best.layout, mean: best.r.mean, std: best.r.std, params: best.p }, history, evals: ctx.evals };
}

/* ---------- dispatcher ---------- */
const OPTIMIZERS = { greedy: greedyBeam, sa: anneal, ga: genetic, pattern: tunePattern };

export function optimize(opts = {}) {
  const {
    method = 'all', rulesOverride = {}, ticks = 1000, weights = DEFAULT_WEIGHTS,
    numSeeds = 16, seeds, optimizerSeed = 1, onProgress, cfg = {},
    parsimony = 0, prune = true,
  } = opts;
  const seedSet = seeds || Array.from({ length: numSeeds }, (_, i) => i + 1);
  const rules = makeRules(rulesOverride);
  // PARSIMONY IS POST-HOC (the prune pass), not a search penalty: penalizing
  // pieces DURING search collapses cold runs, because the flywheel only pays off
  // after ~90 pieces cooperate, so early pieces look net-negative and get shed.
  // `parsimony` (default 0) is an OPT-IN per-piece search cost — use it only to
  // break ties on already-dense (e.g. seeded) runs. Reporting uses RAW points.
  const searchWeights = parsimony > 0 ? { ...weights, pieces: (weights.pieces || 0) - parsimony } : weights;
  const mkCtx = () => ({
    seeds: seedSet, ticks, rulesOverride, weights: searchWeights,
    rng: mulberry32((optimizerSeed * 2654435761) >>> 0), evals: 0,
    onProgress: onProgress ? (info) => onProgress(info) : null,
  });
  const results = {};
  if (method === 'all') {
    // The DRIVER is a full-board, complete-space search (GA over every tool/cell,
    // anchor included), so it can reach AND beat any structure. `pattern` and
    // `greedy` are just fast HYPOTHESES used to seed it — never the final answer
    // (experiment: seeded GA beats the prescribed pattern by ~30%). Single-method
    // runs stay cold, so `-m ga` alone still tests what emerges from scratch.
    const full = { colSpan: Math.floor(rules.cols / 2), maxRow: rules.rows - 1 };
    results.pattern = OPTIMIZERS.pattern(mkCtx(), cfg.pattern || {});       // dense hypothesis
    results.greedy = OPTIMIZERS.greedy(mkCtx(), cfg.greedy || {});          // sparse hypothesis
    const seedLayouts = [results.pattern.best.layout, results.greedy.best.layout];
    results.ga = OPTIMIZERS.ga(mkCtx(), { ...full, initMaxPieces: 100, seedLayouts, ...(cfg.ga || {}) });
    const leader = [results.pattern, results.greedy, results.ga].reduce((a, b) => (b.best.mean > a.best.mean ? b : a));
    results.sa = OPTIMIZERS.sa(mkCtx(), { ...full, init: leader.best.layout, ...(cfg.sa || {}) }); // polish the leader
  } else {
    results[method] = OPTIMIZERS[method](mkCtx(), cfg[method] || {});
  }
  // confirm every winner on the full seed set with RAW weights, pick overall best
  const rawEval = (layout) => evaluateBuild(layout, { seeds: seedSet, ticks, rulesOverride, weights });
  let best = null;
  for (const m in results) {
    const r = results[m].best;
    r.confirm = rawEval(r.layout);
    if (!best || r.confirm.collectedMean > best.confirm.collectedMean) best = { method: m, ...r };
  }
  // prune the overall winner to its essential pieces (parsimony guarantee)
  if (prune && best) {
    best.pruned = pruneBuild(best.layout, { seeds: seedSet, ticks, rulesOverride, weights });
    best.prunedConfirm = rawEval(best.pruned.layout);
  }
  const baseline = rawEval([]);
  const pool = candidatePlacements(rules).length;
  const coverage = { poolSize: pool, fullAlphabet: fullAlphabet(rules).total, complete: pool === fullAlphabet(rules).total };
  return { params: { method, ticks, weights, parsimony, seeds: seedSet, rulesOverride }, results, best, baseline, coverage };
}

/* a layout -> a viewer recipe (staticBuild plan, no cutting) */
export function layoutToRecipe(layout, { rulesOverride = {}, seed = 1, ticks = 1000 } = {}) {
  return { rulesOverride, strategyId: 'staticBuild', config: { plan: layout, thenGreedy: false }, seed, maxTicks: ticks };
}

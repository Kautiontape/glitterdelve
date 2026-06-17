/* =====================================================================
   RUNNER

   - runGame:   one deterministic game -> metrics + snapshot + replay recipe
   - runBatch:  strategies x seeds -> per-strategy aggregates, ranked
   - runBatchAsync: same, but yields to the event loop with progress (for the
     web UI so the tab stays responsive on big sweeps)
   - makeReplayer: re-run a recipe tick-by-tick for the viewer (deterministic,
     so replays are tiny — just the recipe)
   - objective:  configurable weighted score over metrics ("all, configurable")

   Pure / environment-agnostic: imported by both cli.js (Node) and ui.js
   (browser).
   ===================================================================== */
import { mulberry32, hashSeed } from './rng.js';
import { makeRules } from './rules.js';
import { STRATEGIES } from './strategies.js';
import {
  createState, tick, applyAction, metricsOf, snapshot,
  findMatchingSwaps, isLit, lightReach, columnsLit,
} from './engine.js';

/* ---- objective ---- */
/* Weighted sum over metrics. Costs (lostToDark, pieces) take NEGATIVE weights.
   Aliases: columnsLit->litFinal, pieces->piecesTotal. Default ranks by score. */
export const DEFAULT_WEIGHTS = { collected: 1 };
export const OBJECTIVE_PRESETS = {
  score: { collected: 1 },
  survival: { columnsLit: 10, lostToDark: -1 },
  efficiency: { collected: 1, pieces: -5 },
  clean: { collected: 1, lostToDark: -0.5 },
};
function metricValue(metrics, key) {
  if (key === 'columnsLit') return metrics.litFinal;
  if (key === 'pieces') return metrics.piecesTotal;
  return metrics[key] ?? 0;
}
export function objective(metrics, weights = DEFAULT_WEIGHTS) {
  let s = 0;
  for (const k in weights) s += weights[k] * (metricValue(metrics, k) || 0);
  return s;
}

/* ---- agent + api ---- */
export function makeAgent(strategyId, config = {}) {
  const def = STRATEGIES[strategyId];
  if (!def) throw new Error(`Unknown strategy: ${strategyId}`);
  return def.factory(config);
}
function makeApi(state, seed) {
  return {
    rng: mulberry32(hashSeed(seed, 0x9e3779b9)), // independent reproducible stream
    rules: state.rules,
    findMatchingSwaps: (s) => findMatchingSwaps(s),
    isLit: (s, x, y) => isLit(s, x, y),
    lightReach: (s, cx) => lightReach(s, cx),
    columnsLit: (s) => columnsLit(s),
  };
}

/* ---- one game ---- */
export function runGame({ rulesOverride = {}, strategyId, config = {}, seed = 1, maxTicks = 1500, record = false }) {
  const rules = makeRules(rulesOverride);
  const state = createState(rules, seed, { record });
  const agent = makeAgent(strategyId, config);
  const api = makeApi(state, seed);
  const series = record ? { t: [], collected: [], lostToDark: [], lit: [] } : null;
  const sampleEvery = Math.max(1, Math.floor(maxTicks / 200));
  for (let t = 0; t < maxTicks; t++) {
    let acts = [];
    try { acts = agent.act(state, api) || []; } catch (_) { acts = []; }
    for (const a of acts) applyAction(state, a);
    tick(state);
    if (series && t % sampleEvery === 0) {
      series.t.push(t);
      series.collected.push(state.collected);
      series.lostToDark.push(state.lostToDark);
      series.lit.push(columnsLit(state));
    }
  }
  return {
    metrics: metricsOf(state),
    snapshot: snapshot(state),
    recipe: { rulesOverride, strategyId, config, seed, maxTicks },
    seed,
    series,
  };
}

/* ---- replay (for the viewer) ---- */
export function makeReplayer(recipe) {
  const rules = makeRules(recipe.rulesOverride || {});
  const state = createState(rules, recipe.seed, { record: true });
  const agent = makeAgent(recipe.strategyId, recipe.config || {});
  const api = makeApi(state, recipe.seed);
  let lastActions = [];
  return {
    state,
    rules,
    maxTicks: recipe.maxTicks,
    get tickNo() { return state.ticks; },
    actions() { return lastActions; },
    done() { return state.ticks >= recipe.maxTicks; },
    step() {
      if (state.ticks >= recipe.maxTicks) return false;
      let acts = [];
      try { acts = agent.act(state, api) || []; } catch (_) { acts = []; }
      for (const a of acts) applyAction(state, a);
      lastActions = acts;
      tick(state);
      return true;
    },
  };
}

/* ---- aggregation ---- */
function stats(arr) {
  if (!arr.length) return { mean: 0, median: 0, min: 0, max: 0, std: 0 };
  const s = arr.slice().sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const variance = s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  return { mean, median, min: s[0], max: s[n - 1], std: Math.sqrt(variance) };
}
const METRIC_KEYS = ['collected', 'lostToDark', 'litFinal', 'litPeak', 'piecesTotal', 'ticks'];
function aggregate(games, weights) {
  const agg = {};
  for (const k of METRIC_KEYS) agg[k] = stats(games.map((g) => g.metrics[k]));
  agg.score = stats(games.map((g) => g.score));
  return agg;
}
/* keep the best / median / worst game (by score) of a strategy, with replay */
function pickNoted(games) {
  if (!games.length) return [];
  const sorted = games.slice().sort((a, b) => a.score - b.score);
  const idx = { worst: 0, median: (sorted.length - 1) >> 1, best: sorted.length - 1 };
  const out = [];
  for (const label of ['best', 'median', 'worst']) {
    const g = sorted[idx[label]];
    out.push({ kind: label, seed: g.seed, score: g.score, metrics: g.metrics, recipe: g.recipe, snapshot: g.snapshot });
  }
  return out;
}

/* ---- batch (sync, for the CLI) ---- */
export function runBatch(opts) {
  const {
    rulesOverride = {}, strategies, seeds, maxTicks = 1500,
    weights = DEFAULT_WEIGHTS, keepNoted = true, keepAll = false,
  } = opts;
  const perStrategy = [];
  for (const strat of strategies) {
    const games = [];
    for (const seed of seeds) {
      const g = runGame({ rulesOverride, strategyId: strat.id, config: strat.config || {}, seed, maxTicks });
      g.score = objective(g.metrics, weights);
      if (!keepAll) g.snapshot = keepNoted ? g.snapshot : null; // keep for noted selection
      games.push(g);
    }
    const entry = {
      id: strat.id,
      label: strat.label || strat.id,
      config: strat.config || {},
      agg: aggregate(games, weights),
      noted: keepNoted ? pickNoted(games) : [],
      games: keepAll ? games : games.map((g) => ({ seed: g.seed, score: g.score, metrics: g.metrics, recipe: g.recipe, snapshot: g.snapshot })),
    };
    perStrategy.push(entry);
  }
  perStrategy.sort((a, b) => b.agg.score.mean - a.agg.score.mean);
  return { params: { rulesOverride, maxTicks, weights, seeds, strategies: strategies.map((s) => ({ id: s.id, label: s.label, config: s.config })) }, perStrategy };
}

/* ---- batch (async, for the web UI) ---- */
export async function runBatchAsync(opts, onProgress) {
  const {
    rulesOverride = {}, strategies, seeds, maxTicks = 1500,
    weights = DEFAULT_WEIGHTS, keepAll = true, chunk = 8,
  } = opts;
  const total = strategies.length * seeds.length;
  let done = 0;
  const perStrategy = [];
  for (const strat of strategies) {
    const games = [];
    for (const seed of seeds) {
      const g = runGame({ rulesOverride, strategyId: strat.id, config: strat.config || {}, seed, maxTicks });
      g.score = objective(g.metrics, weights);
      games.push(g);
      done++;
      if (done % chunk === 0) {
        if (onProgress) onProgress(done, total);
        await new Promise((r) => setTimeout(r, 0)); // yield so the tab stays alive
      }
    }
    perStrategy.push({
      id: strat.id,
      label: strat.label || strat.id,
      config: strat.config || {},
      agg: aggregate(games, weights),
      noted: pickNoted(games),
      games: keepAll
        ? games.map((g) => ({ seed: g.seed, score: g.score, metrics: g.metrics, recipe: g.recipe, snapshot: g.snapshot }))
        : [],
    });
  }
  if (onProgress) onProgress(total, total);
  perStrategy.sort((a, b) => b.agg.score.mean - a.agg.score.mean);
  return { params: { rulesOverride, maxTicks, weights, seeds, strategies: strategies.map((s) => ({ id: s.id, label: s.label, config: s.config })) }, perStrategy };
}

/* re-score an existing batch under new weights without re-running games */
export function rescore(batch, weights) {
  for (const s of batch.perStrategy) {
    for (const g of s.games || []) g.score = objective(g.metrics, weights);
    for (const n of s.noted || []) n.score = objective(n.metrics, weights);
    s.agg = aggregate(s.games || s.noted, weights);
  }
  batch.perStrategy.sort((a, b) => b.agg.score.mean - a.agg.score.mean);
  batch.params.weights = weights;
  return batch;
}

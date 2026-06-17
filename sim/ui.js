/* =====================================================================
   WEB VIEWER  (browser only)

   Imports the same pure engine/runner/strategies as the CLI, so it always
   reflects the current rules and tools. Lets you:
     - configure strategies, batch size, objective weights, and rule knobs
     - run the batch (chunked + async, with a progress bar)
     - see a ranked results table and a gallery of every game's final board
     - click a board to replay it tick-by-tick with the agent's decisions
     - "note" games (persisted in localStorage) to revisit
   ===================================================================== */
import { STRATEGIES } from './strategies.js';
import { makeRules } from './rules.js';
import { viewFromSnapshot } from './engine.js';
import { runBatchAsync, makeReplayer, OBJECTIVE_PRESETS } from './runner.js';
import { drawState, computeLayout } from './render.js';

const $ = (id) => document.getElementById(id);
let lastBatch = null;

/* ---------- build controls ---------- */
const stratsBox = $('strats');
for (const id in STRATEGIES) {
  const def = STRATEGIES[id];
  const row = document.createElement('label');
  row.className = 'strat';
  row.innerHTML = `<input type="checkbox" value="${id}" ${['noop', 'greedyCut', 'autoSorters'].includes(id) ? 'checked' : ''}>
    <span><span class="nm">${def.label}</span><br><span class="nt">${def.note || ''}</span></span>`;
  stratsBox.appendChild(row);
}
const presetSel = $('preset');
for (const p in OBJECTIVE_PRESETS) {
  const o = document.createElement('option');
  o.value = p; o.textContent = `${p}  ${JSON.stringify(OBJECTIVE_PRESETS[p])}`;
  presetSel.appendChild(o);
}
presetSel.onchange = () => { $('weights').value = weightsToStr(OBJECTIVE_PRESETS[presetSel.value]); };

function weightsToStr(w) { return Object.entries(w).map(([k, v]) => `${k}=${v}`).join(','); }
function parseWeights(s) {
  const o = {};
  for (const pair of s.split(',')) { const [k, v] = pair.split('='); if (k && k.trim()) o[k.trim()] = Number(v); }
  return o;
}
function readRules() {
  const num = (id, d) => { const v = parseInt($(id).value, 10); return Number.isFinite(v) ? v : d; };
  return { cols: num('r_cols', 9), rows: num('r_rows', 14), ncol: num('r_ncol', 6),
    baseReach: num('r_baseReach', 4), anchor: num('r_anchor', 4), ampReach: num('r_ampReach', 4) };
}

/* ---------- run ---------- */
$('run').onclick = async () => {
  const ids = [...stratsBox.querySelectorAll('input:checked')].map((c) => c.value);
  if (!ids.length) { $('status').textContent = 'Select at least one strategy.'; return; }
  const strategies = ids.map((id) => ({ id, label: STRATEGIES[id].label, config: {} }));
  const games = Math.max(1, parseInt($('games').value, 10) || 1);
  const ticks = Math.max(1, parseInt($('ticks').value, 10) || 1);
  const weights = parseWeights($('weights').value);
  const rulesOverride = readRules();
  const seeds = Array.from({ length: games }, (_, i) => i + 1);

  $('run').disabled = true;
  $('bar').style.display = 'block';
  const fill = $('bar').firstElementChild;
  const t0 = performance.now();
  $('status').textContent = `running ${strategies.length} × ${games} games…`;

  const batch = await runBatchAsync(
    { rulesOverride, strategies, seeds, maxTicks: ticks, weights, keepAll: true },
    (done, total) => { fill.style.width = `${(done / total) * 100}%`; }
  );
  lastBatch = batch;
  const dt = Math.round(performance.now() - t0);
  $('status').textContent = `${strategies.length} strategies × ${games} games × ${ticks} ticks in ${dt} ms`;
  $('bar').style.display = 'none';
  $('run').disabled = false;
  renderResults(batch);
  renderGallery(batch);
};

/* ---------- results table ---------- */
function renderResults(batch) {
  const cols = [
    ['Strategy', (s) => s.label, true],
    ['Score µ', (s) => fmt(s.agg.score.mean)],
    ['Collected µ', (s) => fmt(s.agg.collected.mean)],
    ['min–max', (s) => `${s.agg.collected.min}–${s.agg.collected.max}`],
    ['Lost µ', (s) => fmt(s.agg.lostToDark.mean)],
    ['Lit µ', (s) => fmt(s.agg.litFinal.mean)],
    ['Peak lit', (s) => fmt(s.agg.litPeak.mean)],
    ['Pieces µ', (s) => fmt(s.agg.piecesTotal.mean)],
  ];
  let h = '<table><thead><tr>' + cols.map((c) => `<th>${c[0]}</th>`).join('') + '</tr></thead><tbody>';
  batch.perStrategy.forEach((s, i) => {
    h += `<tr class="${i === 0 ? 'best' : ''}">` + cols.map((c) => `<td>${c[1](s)}</td>`).join('') + '</tr>';
  });
  h += '</tbody></table>';
  $('results').innerHTML = h;
}
function fmt(x) { return Number.isInteger(x) ? String(x) : x.toFixed(1); }

/* ---------- gallery ---------- */
function renderGallery(batch) {
  const wrap = $('gallery');
  wrap.innerHTML = '';
  for (const strat of batch.perStrategy) {
    const group = document.createElement('div');
    group.className = 'group';
    const noted = new Set(strat.noted.map((n) => n.seed));
    const best = strat.noted.find((n) => n.kind === 'best');
    group.innerHTML = `<div class="gh"><b>${strat.label}</b>
      <span>${strat.games.length} games · best ${best ? fmt(best.score) : '—'} · score µ ${fmt(strat.agg.score.mean)}</span></div>`;
    const grid = document.createElement('div');
    grid.className = 'gallery';
    for (const g of strat.games) grid.appendChild(makeThumb(g, batch.params, noted.has(g.seed)));
    group.appendChild(grid);
    wrap.appendChild(group);
  }
}
function makeThumb(game, params, isNoted) {
  const el = document.createElement('div');
  el.className = 'thumb';
  const rules = makeRules(game.recipe.rulesOverride || {});
  const cv = document.createElement('canvas');
  const W = 90, H = Math.round((W * rules.rows) / rules.cols);
  cv.width = W; cv.height = H;
  drawThumb(cv, game.snapshot, rules);
  el.appendChild(cv);
  el.insertAdjacentHTML('beforeend',
    `<div class="cap"><span>#${game.seed}</span><span>${fmt(game.score)}</span></div>
     ${isNoted ? '<span class="pin">★</span>' : ''}`);
  el.onclick = () => openReplay(game.recipe, game.metrics);
  return el;
}
function drawThumb(cv, snap, rules) {
  const ctx = cv.getContext('2d');
  const view = viewFromSnapshot(snap, rules);
  const layout = computeLayout(cv.width, cv.height, rules, { pad: 2, top: 2 });
  drawState(ctx, view, rules, layout, { detail: false });
}

/* ---------- replay modal ---------- */
let replayer = null, replayRecipe = null, replayRules = null, playing = null, scrubTo = 0;
const mCanvas = $('m_canvas'), mCtx = mCanvas.getContext('2d');

function openReplay(recipe, finalMetrics) {
  replayRecipe = recipe;
  replayRules = makeRules(recipe.rulesOverride || {});
  $('m_title').textContent = STRATEGIES[recipe.strategyId]?.label || recipe.strategyId;
  $('m_seed').textContent = `seed ${recipe.seed} · ${recipe.maxTicks} ticks`;
  $('m_range').max = recipe.maxTicks;
  $('m_range').value = recipe.maxTicks;
  $('modal').classList.add('open');
  seekTo(recipe.maxTicks); // show final state first
  updatePinButton();
}
function rebuildReplayer() { replayer = makeReplayer(replayRecipe); }
function seekTo(targetTick) {
  // deterministic: rebuild from 0 and step forward (fast enough for a few thousand ticks)
  if (!replayer || replayer.tickNo > targetTick) rebuildReplayer();
  while (replayer.tickNo < targetTick && replayer.step()) { /* advance */ }
  drawReplay();
}
function drawReplay() {
  const layout = computeLayout(mCanvas.width, mCanvas.height, replayRules, { pad: 10, top: 18 });
  drawState(mCtx, replayer.state, replayRules, layout, { actions: replayer.actions() });
  const s = replayer.state;
  $('m_tick').textContent = `tick ${s.ticks} / ${replayRecipe.maxTicks}`;
  $('m_range').value = s.ticks;
  $('m_pills').innerHTML =
    `cut <b>${s.collected}</b> &nbsp; lost <b>${s.lostToDark}</b> &nbsp; lit <b>${s.litCols.filter(Boolean).length}/${replayRules.cols}</b>`;
  const acts = replayer.actions();
  $('m_acts').textContent = acts.length
    ? 'decision: ' + acts.map(describeAction).join(', ')
    : 'decision: (wait)';
}
function describeAction(a) {
  if (a.type === 'swap') return `cut (${a.a.x},${a.a.y})↔(${a.b.x},${a.b.y})`;
  if (a.type === 'place') return `place ${a.tool} @(${a.x},${a.y})`;
  if (a.type === 'remove') return `remove ${a.tool} @(${a.x},${a.y})`;
  return a.type;
}
$('m_range').oninput = () => { stopPlay(); seekTo(parseInt($('m_range').value, 10)); };
$('m_play').onclick = () => { playing ? stopPlay() : startPlay(); };
function startPlay() {
  if (replayer.tickNo >= replayRecipe.maxTicks) rebuildReplayer();
  $('m_play').textContent = '❚❚ pause';
  playing = setInterval(() => {
    if (!replayer.step()) { stopPlay(); return; }
    drawReplay();
  }, 60);
}
function stopPlay() { if (playing) { clearInterval(playing); playing = null; $('m_play').textContent = '▶ play'; } }
$('m_close').onclick = () => { stopPlay(); $('modal').classList.remove('open'); };
$('modal').onclick = (e) => { if (e.target === $('modal')) { stopPlay(); $('modal').classList.remove('open'); } };

/* ---------- noted games (localStorage) ---------- */
const PIN_KEY = 'glitterdelve.noted';
function loadPins() { try { return JSON.parse(localStorage.getItem(PIN_KEY)) || []; } catch { return []; } }
function savePins(p) { localStorage.setItem(PIN_KEY, JSON.stringify(p)); renderPins(); }
function pinId(r) { return `${r.strategyId}|${r.seed}|${r.maxTicks}|${JSON.stringify(r.rulesOverride)}`; }
function isPinned(r) { return loadPins().some((p) => pinId(p.recipe) === pinId(r)); }
function updatePinButton() {
  $('m_pin').textContent = isPinned(replayRecipe) ? '★ noted (remove)' : '☆ note this game';
}
$('m_pin').onclick = () => {
  const pins = loadPins();
  const id = pinId(replayRecipe);
  const idx = pins.findIndex((p) => pinId(p.recipe) === id);
  if (idx >= 0) pins.splice(idx, 1);
  else pins.push({ recipe: replayRecipe });
  savePins(pins);
  updatePinButton();
  if (lastBatch) renderGallery(lastBatch); // refresh ★ marks
};
$('pinClear').onclick = () => savePins([]);

function renderPins() {
  const pins = loadPins();
  $('pinnedWrap').style.display = pins.length ? 'block' : 'none';
  const wrap = $('pinned');
  wrap.innerHTML = '';
  for (const p of pins) {
    const rules = makeRules(p.recipe.rulesOverride || {});
    // replay to the end to get a final snapshot for the thumbnail
    const r = makeReplayer(p.recipe);
    while (r.step()) { /* run to end */ }
    const snap = snapshotFromState(r.state);
    const el = document.createElement('div');
    el.className = 'thumb pinned';
    const cv = document.createElement('canvas');
    const W = 90, Hh = Math.round((W * rules.rows) / rules.cols);
    cv.width = W; cv.height = Hh;
    drawThumb(cv, snap, rules);
    el.appendChild(cv);
    el.insertAdjacentHTML('beforeend',
      `<div class="cap"><span>${STRATEGIES[p.recipe.strategyId]?.label.slice(0, 8) || p.recipe.strategyId}</span><span>#${p.recipe.seed}</span></div><span class="pin">★</span>`);
    el.onclick = () => openReplay(p.recipe, r.state);
    wrap.appendChild(el);
  }
}
// minimal snapshot for a live state (avoids importing snapshot just for pins)
function snapshotFromState(s) {
  const pieces = {};
  for (const [id, m] of s.pieces) pieces[id] = [...m.entries()];
  return { grid: s.grid.map((r) => r.slice()), litCols: s.litCols.slice(), pieces, fading: [...s.fading], anchor: s.rules.anchor };
}

/* ---------- build optimizer (runs in a Web Worker) ---------- */
let optWorker = null;
const optHistory = [];

$('optRun').onclick = () => {
  if (optWorker) optWorker.terminate();
  const colSpan = Math.max(0, parseInt($('o_colspan').value, 10) || 2);
  const opts = {
    method: $('o_method').value,
    ticks: Math.max(1, parseInt($('o_ticks').value, 10) || 800),
    numSeeds: Math.max(1, parseInt($('o_seeds').value, 10) || 10),
    weights: parseWeights($('weights').value),
    rulesOverride: readRules(),
    cfg: {
      greedy: { colSpan, maxPieces: Math.max(1, parseInt($('o_maxpieces').value, 10) || 8), beamWidth: 3, racingSeeds: 3 }, // boxed sparse tool
      sa: { iters: 400 },                                  // full board (default pool)
      ga: { popSize: 40, gens: 35, initMaxPieces: 100 },   // full board, density-varied
      pattern: { samples: 60, refine: 40 },
    },
  };
  optHistory.length = 0;
  $('optResultWrap').style.display = 'block';
  $('optResult').innerHTML =
    `<canvas id="optSpark" width="600" height="80" style="width:100%;max-width:600px;background:var(--panel);border:1px solid var(--line);border-radius:8px"></canvas>
     <div class="muted" id="optLive" style="margin-top:6px">starting…</div>`;
  $('optRun').disabled = true;
  $('optStatus').textContent = 'running…';

  optWorker = new Worker('./optimize-worker.js', { type: 'module' });
  optWorker.onmessage = (e) => {
    const d = e.data;
    if (d.type === 'progress') {
      optHistory.push({ evals: d.info.evals, best: d.info.bestMean });
      const live = $('optLive');
      if (live) live.textContent = `${d.info.method}: best ${fmt(d.info.bestMean)} (evals ${d.info.evals})`;
      drawSpark();
    } else if (d.type === 'done') {
      $('optRun').disabled = false;
      $('optStatus').textContent = 'done';
      renderOptResult(d.res, opts);
      optWorker.terminate(); optWorker = null;
    } else if (d.type === 'error') {
      $('optRun').disabled = false;
      $('optStatus').textContent = 'error: ' + d.message;
    }
  };
  optWorker.postMessage(opts);
};

function drawSpark() {
  const cv = document.getElementById('optSpark');
  if (!cv || !optHistory.length) return;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const ys = optHistory.map((p) => p.best);
  const min = Math.min(...ys), max = Math.max(...ys), span = Math.max(1, max - min);
  const pad = 8, W = cv.width, H = cv.height;
  ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 2; ctx.beginPath();
  optHistory.forEach((p, i) => {
    const x = pad + (W - 2 * pad) * (i / Math.max(1, optHistory.length - 1));
    const y = H - pad - (H - 2 * pad) * ((p.best - min) / span);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = '#8a82a8'; ctx.font = '10px ui-sans-serif,sans-serif';
  ctx.fillText('best ' + fmt(max), pad, 12);
}

function renderOptResult(res, opts) {
  const b = res.best;
  const base = res.baseline.collectedMean;
  const pts = b.confirm.collectedMean;
  const gain = pts - base;
  const pct = ((pts / base - 1) * 100).toFixed(0);
  const cov = res.coverage;
  const essential = b.pruned ? b.pruned.layout.length : b.layout.length;
  const essentialPts = b.prunedConfirm ? b.prunedConfirm.collectedMean : pts;
  const rules = makeRules(opts.rulesOverride);
  const methods = Object.keys(res.results);
  let table = '<table style="margin-top:10px"><thead><tr><th>Method</th><th>Points ± std</th><th>Lit</th><th>Pieces</th><th>Evals</th></tr></thead><tbody>';
  for (const m of methods) {
    const r = res.results[m], cf = r.best.confirm;
    table += `<tr class="${m === b.method ? 'best' : ''}"><td>${m}</td><td>${fmt(cf.mean)} ± ${fmt(cf.std)}</td><td>${cf.litMean.toFixed(1)}/${rules.cols}</td><td>${r.best.layout.length}</td><td>${r.evals}</td></tr>`;
  }
  table += '</tbody></table>';

  $('optResult').innerHTML =
    `<div style="margin-bottom:4px">baseline <b>${fmt(base)}</b> → best
       <b style="color:var(--good)">${fmt(pts)} ± ${fmt(b.confirm.std)}</b>
       <span class="muted">(${b.method}, +${fmt(gain)}, ${pct}% · lit ${b.confirm.litMean.toFixed(1)}/${rules.cols} · ${b.layout.length} pieces)</span></div>
     <div class="muted" style="margin-bottom:8px;font-size:12px">gene pool ${cov.poolSize}/${cov.fullAlphabet} alleles ${cov.complete ? '✓ complete' : '⚠ INCOMPLETE'} · essential after prune: <b>${essential} pieces</b> for ${fmt(essentialPts)} pts</div>
     <canvas id="optSpark" width="600" height="80" style="width:100%;max-width:600px;background:var(--panel);border:1px solid var(--line);border-radius:8px"></canvas>
     <div style="display:flex;gap:14px;align-items:center;margin-top:12px;flex-wrap:wrap">
       <div class="thumb" id="optThumb" style="width:120px;cursor:pointer"></div>
       <button class="ghost" id="optReplay">▶ replay best build</button>
       <button class="ghost" id="optPin">☆ note it</button>
     </div>
     ${table}`;
  drawSpark();

  const plan = b.pruned ? b.pruned.layout : b.layout; // replay the essential (pruned) build
  const recipe = { rulesOverride: opts.rulesOverride, strategyId: 'staticBuild',
    config: { plan, thenGreedy: false }, seed: res.params.seeds[0], maxTicks: opts.ticks };
  const r = makeReplayer(recipe);
  while (r.step()) { /* run to end for the thumbnail */ }
  const snap = snapshotFromState(r.state);
  const thumb = document.getElementById('optThumb');
  const cv = document.createElement('canvas');
  cv.width = 120; cv.height = Math.round((120 * rules.rows) / rules.cols);
  drawThumb(cv, snap, rules);
  thumb.appendChild(cv);
  thumb.onclick = () => openReplay(recipe, r.state);
  document.getElementById('optReplay').onclick = () => openReplay(recipe, r.state);
  document.getElementById('optPin').onclick = () => { const pins = loadPins(); pins.push({ recipe }); savePins(pins); };
}

renderPins();

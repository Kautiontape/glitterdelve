/* =====================================================================
   GLITTERDELVE — THE CLIMB (demo 2), browser front-end on climb-engine.
   Pure builder: deploy structures to route falling, decaying gems into the
   rising light. Camera follows the frontier up a tall shaft to the Source.
   Ruleset is read from the URL so a tweaked game is shareable/bookmarkable.
   ===================================================================== */
import { CLIMB_RULES, makeClimbRules } from './rules.js';
import {
  createClimbState, tickClimb, placeClimb, removeClimb, bombClimb, costOf, lightCeiling, inBounds, EMPTY,
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

/* camera: follow the light ceiling, clamped to the shaft. With rows == view the
   whole shaft is on screen and this stays 0 (no scroll). */
function camTopFor() {
  const top = lightCeiling(state) - 4;
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
  document.getElementById('total').textContent = state.energy.toLocaleString(); // spendable balance
  const counts = rules.tools.filter((t) => t.kind !== 'action')
    .map((t) => `${t.name.toLowerCase()} <b>${(state.pieces.get(t.id) || new Map()).size}</b>`).join(' · ');
  document.getElementById('stats').innerHTML =
    `harvested <b>${state.harvested}</b> · lost <b>${state.lost}</b> · to source <b>${lightCeiling(state)}</b><br>${counts}`;
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

// expose live state + engine ops for console tinkering and harness checks (lab tool)
window.__climb = { get state() { return state; }, get rules() { return rules; }, placeClimb, tickClimb, bombClimb };

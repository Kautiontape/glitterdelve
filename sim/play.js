/* =====================================================================
   GLITTERDELVE — PLAYABLE (browser), on the shared modular engine.

   This is the real game, driven by the SAME engine/rules/render the sim uses,
   so any rule or tool change shows up here too. Input is adapted from demo.html
   but everything mechanical (gravity, light, matches, tools) comes from engine.js.

   Ruleset is read from the URL (?cols=11&baseReach=6&...), so a tweaked game is
   shareable/bookmarkable — handy for inverting rules and picking up elsewhere.
   ===================================================================== */
import { DEFAULT_RULES, makeRules } from './rules.js';
import { createState, tick, place, remove, playerSwap, EMPTY, inBounds } from './engine.js';
import { drawState, computeLayout } from './render.js';

const cv = document.getElementById('cv'), ctx = cv.getContext('2d'), stage = document.getElementById('stage');

/* ---- ruleset from URL (so tweaks survive a reload / move to another PC) ---- */
const RULE_KEYS = ['cols', 'rows', 'ncol', 'anchor', 'baseReach', 'ampReach'];
function readOverridesFromURL() {
  const q = new URLSearchParams(location.search), o = {};
  for (const k of RULE_KEYS) if (q.has(k)) o[k] = parseInt(q.get(k), 10);
  return o;
}
let overrides = readOverridesFromURL();
let seed = parseInt(new URLSearchParams(location.search).get('seed') || '1', 10) || 1;
let TICK = parseInt(new URLSearchParams(location.search).get('tick') || '260', 10) || 260;

let rules, state, layout = { cell: 40, ox: 0, oy: 0 };
let paused = false;

function newGame() {
  rules = makeRules(overrides);
  state = createState(rules, seed, { record: true }); // record => fade/pop events for visuals
  resize();
  buildToolbar();
  updateStats();
}

/* ---- layout / resize ---- */
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = stage.clientWidth, h = stage.clientHeight;
  cv.width = w * dpr | 0; cv.height = h * dpr | 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout = computeLayout(w, h, rules, { pad: 16, top: 64 });
}
addEventListener('resize', resize);

const cellX = (x) => layout.ox + x * layout.cell;
const cellY = (y) => layout.oy + y * layout.cell;
const pixelToCell = (px, py) => ({ x: Math.floor((px - layout.ox) / layout.cell), y: Math.floor((py - layout.oy) / layout.cell) });
const pixelToCorner = (px, py) => ({ cx: Math.round((px - layout.ox) / layout.cell), cy: Math.round((py - layout.oy) / layout.cell) });
const adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

/* ---- toolbar (built from the registry, so new tools just appear) ---- */
let tool = 'move';
function buildToolbar() {
  const bar = document.getElementById('toolbar');
  bar.innerHTML = '';
  for (const t of rules.tools) {
    const el = document.createElement('div');
    el.className = 'tool' + (t.id === tool ? ' active' : '');
    el.dataset.tool = t.id;
    el.innerHTML = `<span class="ic">${t.icon || '?'}</span>${t.name}`;
    el.onclick = () => {
      tool = t.id; sel = null;
      [...bar.children].forEach((c) => c.classList.toggle('active', c.dataset.tool === tool));
      showHint();
    };
    bar.appendChild(el);
  }
}

/* ---- place / remove with toggle UX ---- */
function togglePiece(toolId, pos) {
  const map = state.pieces.get(toolId);
  if (!map) return;
  const key = pos.x + ',' + pos.y;
  const tdef = rules.tools.find((t) => t.id === toolId);
  if (tdef.seam === 'cell' && tdef.divert) {
    const ex = map.get(key);
    if (ex && ex.dir === (pos.dir || 1)) remove(state, toolId, pos); // same dir again -> remove
    else place(state, toolId, pos);
  } else {
    if (map.has(key)) remove(state, toolId, pos);
    else place(state, toolId, pos); // place() validates legality
  }
  updateStats();
}
function placeFromCorners(a, b) {
  const tdef = rules.tools.find((t) => t.id === tool);
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return;
  if (tdef.seam === 'horizontal' && Math.abs(dx) === 1) {
    const x = Math.min(a.cx, b.cx), y = a.cy;
    if (x >= 0 && x < rules.cols && y >= 1 && y < rules.rows) togglePiece(tool, { x, y });
  } else if (tdef.seam === 'vertical' && Math.abs(dy) === 1) {
    const x = a.cx, y = Math.min(a.cy, b.cy);
    if (x >= 1 && x < rules.cols && y >= 0 && y < rules.rows) togglePiece(tool, { x, y });
  }
}

/* ---- input ---- */
let sel = null, drag = null;
stage.addEventListener('contextmenu', (e) => e.preventDefault());
stage.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  stage.setPointerCapture(e.pointerId);
  const tdef = rules.tools.find((t) => t.id === tool);
  if (tool === 'move' || tdef.kind === 'action') {
    const c = pixelToCell(e.clientX, e.clientY);
    if (inBounds(state, c.x, c.y)) {
      if (sel && adjacent(sel, c)) { playerSwap(state, sel, c); updateStats(); sel = null; }
      else sel = c;
    }
    drag = { mode: 'swapdrag', from: c };
  } else if (tdef.seam === 'cell') {
    drag = { mode: 'cell', from: pixelToCell(e.clientX, e.clientY), sx: e.clientX, px: e.clientX, py: e.clientY };
  } else {
    drag = { mode: 'seam', fromCorner: pixelToCorner(e.clientX, e.clientY), px: e.clientX, py: e.clientY };
  }
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.px = e.clientX; drag.py = e.clientY;
  if (drag.mode === 'swapdrag' && sel) {
    const c = pixelToCell(e.clientX, e.clientY);
    if (inBounds(state, c.x, c.y) && adjacent(sel, c)) { playerSwap(state, sel, c); updateStats(); sel = null; drag = null; }
  }
});
stage.addEventListener('pointerup', (e) => {
  if (drag && drag.mode === 'seam') {
    placeFromCorners(drag.fromCorner, pixelToCorner(e.clientX, e.clientY));
  } else if (drag && drag.mode === 'cell') {
    const c = drag.from;
    if (inBounds(state, c.x, c.y)) { const dir = (e.clientX - drag.sx) < 0 ? -1 : 1; togglePiece(tool, { x: c.x, y: c.y, dir }); }
  }
  drag = null;
});

/* ---- render (engine board via render.js, then play affordances on top) ---- */
function draw() {
  drawState(ctx, state, rules, layout, {});
  const C = layout.cell;
  // selection (Cut)
  if (sel) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
    rr(cellX(sel.x) + 3, cellY(sel.y) + 3, C - 6, C - 6, 10); ctx.stroke(); ctx.globalAlpha = 1;
  }
  const tdef = rules.tools.find((t) => t.id === tool);
  // seam placement affordance: glowing corners + drag preview
  if (tdef && (tdef.seam === 'horizontal' || tdef.seam === 'vertical')) {
    ctx.fillStyle = '#c9a227'; ctx.globalAlpha = 0.4;
    for (let cx = 0; cx <= rules.cols; cx++) for (let cy = 0; cy <= rules.rows; cy++) {
      ctx.beginPath(); ctx.arc(cellX(cx), cellY(cy), 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (drag && drag.mode === 'seam') {
      const a = drag.fromCorner;
      ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 4; ctx.globalAlpha = 0.8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cellX(a.cx), cellY(a.cy)); ctx.lineTo(drag.px, drag.py); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  // cell (fork) affordance
  if (tdef && tdef.seam === 'cell') {
    ctx.fillStyle = '#ff8a4c'; ctx.globalAlpha = 0.18;
    for (let x = 0; x < rules.cols; x++) for (let y = 0; y < rules.rows; y++) {
      ctx.beginPath(); ctx.arc(cellX(x) + C / 2, cellY(y) + C / 2, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (drag && drag.mode === 'cell' && inBounds(state, drag.from.x, drag.from.y)) {
      const c = drag.from, dir = (drag.px - drag.sx) < 0 ? -1 : 1;
      ctx.strokeStyle = '#ff8a4c'; ctx.lineWidth = 2; ctx.globalAlpha = 0.8;
      rr(cellX(c.x) + 3, cellY(c.y) + 3, C - 6, C - 6, 8); ctx.stroke();
      ctx.fillStyle = '#ff8a4c';
      const ax = cellX(c.x) + C / 2 + dir * C * 0.3, ay = cellY(c.y) + C / 2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - dir * 8, ay - 5); ctx.lineTo(ax - dir * 8, ay + 5); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}
function rr(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/* ---- stats ---- */
function updateStats() {
  document.getElementById('total').textContent = state.collected.toLocaleString();
  let lit = 0; for (const v of state.litCols) if (v) lit++;
  const counts = rules.tools.filter((t) => t.kind !== 'action')
    .map((t) => `${t.name.toLowerCase()} <b>${(state.pieces.get(t.id) || new Map()).size}</b>`).join(' · ');
  document.getElementById('stats').innerHTML =
    `${counts}<br>warrens lit <b>${lit} / ${rules.cols}</b> · lost to the dark <b>${state.lostToDark}</b>`;
}

/* ---- hint ---- */
let hintTimer;
function showHint() {
  const tdef = rules.tools.find((t) => t.id === tool);
  const msgs = {
    move: 'Cut: click a gem, then an adjacent one to swap — holds only if it makes a match of 3+.',
    dam: 'Wall: drag along a horizontal grid line to weld a barrier. Gems pile on top.',
    amp: 'Lens: drag along a horizontal grid line. Blocks the fall AND carries light deeper.',
    swap: 'Sorter: drag along a vertical grid line. Auto-swaps the two gems when it makes a match.',
    split: 'Fork: click a cell and drag left/right to choose the push direction. Diverts every other gem.',
  };
  const h = document.getElementById('hint');
  h.textContent = msgs[tool] || (tdef ? tdef.name : '');
  h.style.opacity = '1';
  clearTimeout(hintTimer); hintTimer = setTimeout(() => { h.style.opacity = '0'; }, 3200);
}

/* ---- rules panel ---- */
const panel = document.getElementById('panel');
document.getElementById('gear').onclick = () => { syncPanel(); panel.classList.toggle('open'); };
function syncPanel() {
  for (const k of RULE_KEYS) document.getElementById('r_' + k).value = (overrides[k] ?? DEFAULT_RULES[k]);
  document.getElementById('r_seed').value = seed;
  document.getElementById('r_tick').value = TICK;
}
document.getElementById('restart').onclick = () => {
  overrides = {};
  for (const k of RULE_KEYS) { const v = parseInt(document.getElementById('r_' + k).value, 10); if (Number.isFinite(v)) overrides[k] = v; }
  seed = parseInt(document.getElementById('r_seed').value, 10) || 1;
  TICK = Math.max(20, parseInt(document.getElementById('r_tick').value, 10) || 260);
  // persist to the URL so a reload / another machine reproduces it
  const q = new URLSearchParams();
  for (const k of RULE_KEYS) if (overrides[k] !== undefined && overrides[k] !== DEFAULT_RULES[k]) q.set(k, overrides[k]);
  if (seed !== 1) q.set('seed', seed);
  if (TICK !== 260) q.set('tick', TICK);
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
  panel.classList.remove('open');
  newGame();
};
const pauseBtn = document.getElementById('pause');
pauseBtn.onclick = () => { paused = !paused; pauseBtn.textContent = paused ? 'Resume' : 'Pause'; };

/* ---- main loop ---- */
let acc = 0, last = performance.now();
function frame(now) {
  acc += now - last; last = now;
  let ticked = false;
  if (!paused) { while (acc >= TICK) { tick(state); acc -= TICK; ticked = true; } }
  else acc = 0;
  draw();
  if (ticked) updateStats(); // keep the HUD live (not just on input)
  requestAnimationFrame(frame);
}
newGame();
showHint();
requestAnimationFrame((n) => { last = n; requestAnimationFrame(frame); });

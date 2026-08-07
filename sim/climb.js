/* =====================================================================
   GLITTERDELVE — THE CLIMB (demo 2), browser front-end on climb-engine.
   Pure builder: deploy a routing machine (ramps, sorters, conveyors, walls)
   that herds like colours into the lit columns so they pile and pop; raise the
   safe light with lenses toward the Source. Placement is single-click (no drag),
   with a ghost preview and dots that mark the buildable, lit zone.
   Ruleset is read from the URL so a tweaked game is shareable.
   ===================================================================== */
import { CLIMB_RULES, makeClimbRules } from './rules.js';
import {
  createClimbState, tickClimb, placeClimb, removeClimb, adjustClimb, bombClimb,
  costOf, litColumns, comboMult, lensSpot, inBounds, EMPTY,
} from './climb-engine.js';
import { drawClimb, computeLayout } from './render.js';

const cv = document.getElementById('cv'), ctx = cv.getContext('2d'), stage = document.getElementById('stage');

const RULE_KEYS = ['cols', 'rows', 'baseReach', 'dimBand', 'lensReach', 'spawnDensity'];
function readOverridesFromURL() {
  const q = new URLSearchParams(location.search), o = {};
  for (const k of RULE_KEYS) if (q.has(k)) o[k] = k === 'spawnDensity' ? parseFloat(q.get(k)) : parseInt(q.get(k), 10);
  return o;
}
let overrides = readOverridesFromURL();
let seed = parseInt(new URLSearchParams(location.search).get('seed') || '1', 10) || 1;
let TICK = parseInt(new URLSearchParams(location.search).get('tick') || '0', 10) || CLIMB_RULES.tickMs;

let rules, state, layout = { cell: 40, ox: 0, oy: 0 }, paused = false;
let tool = 'sorter';
let hover = null;            // {kind:'cell'|'seam', x, y}
const particles = [];

function newGame() {
  rules = makeClimbRules(overrides);
  state = createClimbState(rules, seed, { record: true });
  particles.length = 0;
  resize();
  buildToolbar();
  document.getElementById('win').classList.remove('show');
  updateStats();
}

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = stage.clientWidth, h = stage.clientHeight;
  cv.width = w * dpr | 0; cv.height = h * dpr | 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout = computeLayout(w, h, { cols: rules.cols, rows: rules.rows }, { pad: 16, top: 64 });
}
addEventListener('resize', resize);

/* screen px -> grid coords (no camera; the whole shaft is on screen) */
const cellAtX = (px) => Math.floor((px - layout.ox) / layout.cell);
const cellAtY = (py) => Math.floor((py - layout.oy) / layout.cell);
/* nearest horizontal seam row for a click (top or bottom edge of the hovered cell) */
function seamAt(px, py) {
  const x = cellAtX(px);
  const f = (py - layout.oy) / layout.cell;
  const y = (f - Math.floor(f)) < 0.5 ? Math.floor(f) : Math.floor(f) + 1;
  return { x, y };
}

/* ---- toolbar ---- */
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
function toolDef(id) { return rules.tools.find((t) => t.id === id); }

/* ---- placement helpers ---- */
function cellPieceAt(x, y) { // any wedge/conveyor occupying a cell
  for (const t of rules.tools) {
    if (t.seam !== 'cell') continue;
    const m = state.pieces.get(t.id);
    if (m && m.has(x + ',' + y)) return t.id;
  }
  return null;
}
function seamPieceAt(x, y) { // any wall/lens on a seam
  for (const t of rules.tools) {
    if (t.seam !== 'horizontal') continue;
    const m = state.pieces.get(t.id);
    if (m && m.has(x + ',' + y)) return t.id;
  }
  return null;
}

function leftClick(px, py) {
  const t = toolDef(tool);
  if (t.kind === 'action') { // Bomb
    const x = cellAtX(px), y = cellAtY(py);
    if (inBounds(state, x, y)) bombClimb(state, x, y);
  } else if (t.seam === 'cell') {
    const x = cellAtX(px), y = cellAtY(py);
    if (!inBounds(state, x, y)) return;
    const here = cellPieceAt(x, y);
    if (here === tool) adjustClimb(state, tool, { x, y });           // cycle in place
    else if (here) flashHint('Another piece is here — right-click to remove it');
    else if (!placeClimb(state, tool, { x, y, dir: 1, tc: 0 })) flashHint(affordMsg(tool, x, y));
  } else if (t.extendsLight) { // Lens — snaps to the column's bright edge (the rung)
    const x = cellAtX(px);
    if (x < 0 || x >= rules.cols) return;
    const y = lensSpot(state, x);
    if (y < 1) { flashHint('This column already reaches the Source.'); return; }
    if (!placeClimb(state, tool, { x, y })) flashHint(affordMsg(tool, x, y));
  } else if (t.seam === 'horizontal') {
    const { x, y } = seamAt(px, py);
    if (seamPieceAt(x, y) === tool) { flashHint('Already here — right-click to remove'); return; }
    if (!placeClimb(state, tool, { x, y })) flashHint(affordMsg(tool, x, y));
  }
  updateStats();
}
function rightClick(px, py) { // remove + refund whatever is under the cursor
  const cx = cellAtX(px), cy = cellAtY(py);
  const cp = cellPieceAt(cx, cy);
  if (cp) { removeClimb(state, cp, { x: cx, y: cy }); updateStats(); return; }
  const s = seamAt(px, py);
  for (const sy of [s.y, s.y - 1, s.y + 1]) {
    const sp = seamPieceAt(s.x, sy);
    if (sp) { removeClimb(state, sp, { x: s.x, y: sy }); updateStats(); return; }
  }
}
function affordMsg(toolId, x, y) {
  if (state.energy < costOf(state, toolId)) return 'Not enough energy';
  return 'Build only in the lit zone (the dots)';
}

/* ---- input (single click; no drag) ---- */
stage.addEventListener('contextmenu', (e) => e.preventDefault());
stage.addEventListener('pointerdown', (e) => {
  if (e.button === 2) { rightClick(e.clientX, e.clientY); return; }
  if (e.button !== 0) return;
  leftClick(e.clientX, e.clientY);
});
stage.addEventListener('pointermove', (e) => {
  const t = toolDef(tool);
  if (t.seam === 'horizontal') hover = { kind: 'seam', ...seamAt(e.clientX, e.clientY) };
  else hover = { kind: 'cell', x: cellAtX(e.clientX), y: cellAtY(e.clientY) };
});
stage.addEventListener('pointerleave', () => { hover = null; });

/* ---- particles (juice): sparkles on a lit pop, puffs on a dim shatter ---- */
function spawnParticles() {
  if (!state.events) return;
  const { cell, ox, oy } = layout;
  for (const p of state.events.popping) {
    if (!p.lit) continue;
    const sx = ox + p.x * cell + cell / 2, sy = oy + p.y * cell + cell / 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      particles.push({ x: sx, y: sy, vx: Math.cos(a) * (1 + i % 2), vy: Math.sin(a) * (1 + i % 2) - 0.5, life: 1, c: '255,238,168' });
    }
  }
  for (const b of state.events.broke) {
    const sx = ox + b.x * cell + cell / 2, sy = oy + b.y * cell + cell / 2;
    if (b.lens) { // a gem smashed a lens — bright yellow shards so you SEE it break
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; particles.push({ x: sx, y: sy, vx: Math.cos(a) * 2.2, vy: Math.sin(a) * 2.2, life: 1, c: '255,225,77' }); }
      flashHint('A gem smashed your lens — divert the rain off that column to protect it.');
      continue;
    }
    for (let i = 0; i < 4; i++) particles.push({ x: sx, y: sy, vx: (Math.random() - 0.5) * 1.5, vy: -Math.random() * 1.2, life: 1, c: '150,140,170' });
  }
}
function drawParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt * 0.06; p.y += p.vy * dt * 0.06; p.vy += dt * 0.004; p.life -= dt * 0.0022;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.fillStyle = `rgba(${p.c},${p.life})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, layout.cell * 0.08 * p.life), 0, Math.PI * 2); ctx.fill();
  }
}

/* ---- HUD ---- */
function updateStats() {
  document.getElementById('total').textContent = state.energy.toLocaleString();
  const mult = comboMult(state);
  const counts = rules.tools.filter((t) => t.kind !== 'action')
    .map((t) => `${t.name.toLowerCase()} <b>${(state.pieces.get(t.id) || new Map()).size}</b>`).join(' · ');
  const spree = mult > 1 ? ` · <span style="color:#ffd24a">spree ×${mult}</span>` : '';
  document.getElementById('stats').innerHTML =
    `harvested <b>${state.harvested}</b> · lost <b>${state.lost}</b> · shaft lit <b>${litColumns(state)}/${rules.cols}</b>${spree}<br>${counts}`;
  if (state.won) {
    document.getElementById('winsub').textContent = `${state.harvested} energy harvested, ${state.lost} lost to the dark.`;
    document.getElementById('win').classList.add('show');
  }
}

/* ---- hints ---- */
let hintTimer;
function showHint() {
  const msgs = {
    bomb: 'Bomb (free): left-click a gem to destroy it. Clears jams and mistakes.',
    dam: 'Wall: left-click a horizontal grid line. Gems pile on top — match them in the light.',
    ramp: 'Ramp: left-click a cell to drop it; click it again to flip. Gems slide one column off it.',
    sorter: 'Sorter: left-click a cell; click it again to cycle its colour. That colour goes one way, the rest the other — build colour lanes.',
    conveyor: 'Conveyor: left-click a cell; click again to flip. Carries resting gems sideways into a column.',
    amp: 'Lens: left-click a column at its glowing rung to raise that column\'s light a few rows. Chain rung by rung up to the Source to win.',
  };
  flashHint(msgs[tool] || tool);
}
function flashHint(text) {
  const h = document.getElementById('hint');
  h.textContent = text; h.style.opacity = '1';
  clearTimeout(hintTimer); hintTimer = setTimeout(() => { h.style.opacity = '0'; }, 3600);
}

/* ---- rules panel ---- */
const panel = document.getElementById('panel');
document.getElementById('gear').onclick = () => { syncPanel(); panel.classList.toggle('open'); };
function syncPanel() {
  for (const k of RULE_KEYS) { const el = document.getElementById('r_' + k); if (el) el.value = (overrides[k] != null ? overrides[k] : CLIMB_RULES[k]); }
  document.getElementById('r_seed').value = seed;
  document.getElementById('r_tick').value = TICK;
}
document.getElementById('restart').onclick = () => {
  overrides = {};
  for (const k of RULE_KEYS) { const el = document.getElementById('r_' + k); if (!el) continue; const v = k === 'spawnDensity' ? parseFloat(el.value) : parseInt(el.value, 10); if (Number.isFinite(v)) overrides[k] = v; }
  seed = parseInt(document.getElementById('r_seed').value, 10) || 1;
  TICK = Math.max(60, parseInt(document.getElementById('r_tick').value, 10) || CLIMB_RULES.tickMs);
  const q = new URLSearchParams();
  for (const k of RULE_KEYS) if (overrides[k] !== undefined && overrides[k] !== CLIMB_RULES[k]) q.set(k, overrides[k]);
  if (seed !== 1) q.set('seed', seed);
  if (TICK !== CLIMB_RULES.tickMs) q.set('tick', TICK);
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
  panel.classList.remove('open');
  newGame();
};
const pauseBtn = document.getElementById('pause');
pauseBtn.onclick = () => { paused = !paused; pauseBtn.textContent = paused ? 'Resume' : 'Pause'; };

/* ---- main loop ---- */
let acc = 0, last = performance.now();
function frame(now) {
  const dt = now - last; acc += dt; last = now;
  let ticked = false;
  if (!paused && !state.won) { while (acc >= TICK) { tickClimb(state); spawnParticles(); acc -= TICK; ticked = true; } }
  else acc = 0;
  drawClimb(ctx, state, rules, layout, { tool, hover, dir: 1 });
  drawParticles(dt);
  if (ticked || (state.won && !document.getElementById('win').classList.contains('show'))) updateStats();
  requestAnimationFrame(frame);
}
newGame();
showHint();
requestAnimationFrame((n) => { last = n; requestAnimationFrame(frame); });

// expose live state + engine ops for console tinkering and harness checks
window.__climb = { get state() { return state; }, get rules() { return rules; }, placeClimb, tickClimb, bombClimb, removeClimb, adjustClimb };

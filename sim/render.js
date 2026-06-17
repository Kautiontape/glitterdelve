/* =====================================================================
   RENDER  (browser only)

   Canvas drawing for a board, adapted from demo.html's draw() but pure: it
   takes (ctx, view, rules, layout, opts) and draws — no globals, no input.
   `view` is anything with {grid, litCols, pieces:Map<toolId,Map>, fading:Set};
   both a live engine state and viewFromSnapshot(...) satisfy that. Used for
   gallery thumbnails AND the full replay viewer, so the sim looks like the game.
   ===================================================================== */
import { lightReach } from './engine.js';
import { isLit as climbIsLit, lightCeiling as climbLightCeiling } from './climb-engine.js';

// palette copied from demo.html's :root so render is self-contained
const COLORS = ['#e0496b', '#3fb6d3', '#5dd36a', '#f2b134', '#9b6cf0', '#ec6fb0'];
const DAMC = '#c9a227', SWAPC = '#5fe0d0', SPLITC = '#ff8a4c', AMPC = '#ffe14d', LIGHTC = '#fff2a8';
const SLOPEC = '#7fd49a';
const EMPTY = -1;

export function computeLayout(w, h, rules, opts = {}) {
  const pad = opts.pad ?? 8;
  const top = opts.top ?? pad;
  const cell = Math.max(1, Math.min((w - pad * 2) / rules.cols, (h - top - pad) / rules.rows));
  const ox = (w - cell * rules.cols) / 2;
  const oy = top + (h - top - pad - cell * rules.rows) / 2;
  return { cell, ox, oy };
}

function lighten(hex, amt) {
  let c = hex.replace('#', '');
  let r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function hexA(hex, a) {
  const c = hex.replace('#', '');
  return `rgba(${parseInt(c.slice(0, 2), 16)},${parseInt(c.slice(2, 4), 16)},${parseInt(c.slice(4, 6), 16)},${a})`;
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function drawState(ctx, view, rules, layout, opts = {}) {
  const { cell, ox, oy } = layout;
  const detail = opts.detail !== false && cell >= 18; // skip fine detail on tiny thumbnails
  const cx = (x) => ox + x * cell, cy = (y) => oy + y * cell;
  const lr = (x) => lightReach(view, x).depth; // view doubles as state for lightReach
  ctx.clearRect(opts.clearX ?? 0, opts.clearY ?? 0, opts.clearW ?? ctx.canvas.width, opts.clearH ?? ctx.canvas.height);

  // play-field frame
  ctx.fillStyle = '#00000035';
  ctx.fillRect(ox - 4, oy - 4, cell * rules.cols + 8, cell * rules.rows + 8);

  // light columns
  for (let x = 0; x < rules.cols; x++) {
    if (!view.litCols[x]) continue;
    const depth = lr(x);
    if (depth < 0) continue;
    const anchor = x === rules.anchor;
    const g = ctx.createLinearGradient(0, oy, 0, cy(depth + 1));
    g.addColorStop(0, hexA(LIGHTC, anchor ? 0.26 : 0.2));
    g.addColorStop(1, hexA(LIGHTC, anchor ? 0.1 : 0.06));
    ctx.fillStyle = g;
    ctx.fillRect(cx(x), oy, cell, (depth + 1) * cell);
  }

  // ceiling bar + droppers
  if (detail) {
    ctx.fillStyle = '#241a3a';
    ctx.fillRect(ox - 4, oy - 14, cell * rules.cols + 8, 11);
    for (let x = 0; x < rules.cols; x++) {
      const on = view.litCols[x];
      const dx = cx(x) + cell * 0.2, w = cell * 0.6;
      if (on) { ctx.fillStyle = x === rules.anchor ? '#ffe14d' : '#e8c14a'; ctx.fillRect(dx, oy - 14, w, 11); }
      else { ctx.strokeStyle = '#5a5470'; ctx.lineWidth = 1.2; ctx.strokeRect(dx, oy - 12, w, 8); }
    }
  }

  // gems
  for (let y = 0; y < rules.rows; y++)
    for (let x = 0; x < rules.cols; x++) {
      const c = view.grid[y][x];
      if (c === EMPTY) continue;
      const fad = view.fading.has(x + ',' + y);
      if (fad) ctx.globalAlpha = 0.32;
      drawGem(ctx, cx(x), cy(y), cell, c, detail);
      ctx.globalAlpha = 1;
    }

  // pieces
  drawPieces(ctx, view, rules, layout, detail);

  // optional action overlay (replay: highlight this tick's decisions)
  if (opts.actions) drawActions(ctx, opts.actions, rules, layout);
}

function drawGem(ctx, sx, sy, cell, color, detail) {
  const pad = cell * 0.12, x = sx + pad, y = sy + pad, s = cell - pad * 2;
  const c = COLORS[color % COLORS.length];
  if (detail) {
    const g = ctx.createLinearGradient(x, y, x + s, y + s);
    g.addColorStop(0, lighten(c, 0.35)); g.addColorStop(0.55, c); g.addColorStop(1, lighten(c, -0.3));
    rr(ctx, x, y, s, s, s * 0.22); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + s * 0.18, y + s * 0.18); ctx.lineTo(x + s * 0.6, y + s * 0.2);
    ctx.lineTo(x + s * 0.3, y + s * 0.5); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
  } else {
    rr(ctx, x, y, s, s, Math.max(1, s * 0.22)); ctx.fillStyle = c; ctx.fill();
  }
}

function drawPieces(ctx, view, rules, layout, detail) {
  const { cell, ox, oy } = layout;
  const cx = (x) => ox + x * cell, cy = (y) => oy + y * cell;
  const get = (id) => view.pieces.get(id) || new Map();
  // walls (horizontal seams)
  for (const key of get('dam').keys()) { const [x, y] = key.split(',').map(Number);
    ctx.strokeStyle = DAMC; ctx.lineWidth = Math.max(2, cell * 0.09); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx(x) + 3, cy(y)); ctx.lineTo(cx(x) + cell - 3, cy(y)); ctx.stroke();
  }
  // lenses (double bar)
  for (const key of get('amp').keys()) { const [x, y] = key.split(',').map(Number);
    ctx.strokeStyle = AMPC; ctx.lineWidth = Math.max(1.5, cell * 0.07); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx(x) + 3, cy(y) - 2); ctx.lineTo(cx(x) + cell - 3, cy(y) - 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx(x) + 3, cy(y) + 2); ctx.lineTo(cx(x) + cell - 3, cy(y) + 2); ctx.stroke();
  }
  // sorters (vertical seams)
  for (const key of get('swap').keys()) { const [x, y] = key.split(',').map(Number);
    ctx.strokeStyle = SWAPC; ctx.lineWidth = Math.max(2, cell * 0.09); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx(x), cy(y) + 3); ctx.lineTo(cx(x), cy(y) + cell - 3); ctx.stroke();
  }
  // forks (chevron in a cell, pointing the push direction)
  for (const [key, s] of get('split')) { const [x, y] = key.split(',').map(Number); const m = cell / 2;
    const dir = s && s.dir ? s.dir : 1;
    ctx.strokeStyle = SPLITC; ctx.lineWidth = Math.max(2, cell * 0.07); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx(x) + m, cy(y) + cell * 0.18);
    ctx.lineTo(cx(x) + m, cy(y) + cell * 0.55);
    ctx.lineTo(cx(x) + m + dir * cell * 0.28, cy(y) + cell * 0.82);
    ctx.moveTo(cx(x) + m, cy(y) + cell * 0.55);
    ctx.lineTo(cx(x) + m, cy(y) + cell * 0.82);
    ctx.stroke();
  }
}

function drawActions(ctx, actions, rules, layout) {
  const { cell, ox, oy } = layout;
  const cx = (x) => ox + x * cell, cy = (y) => oy + y * cell;
  for (const a of actions) {
    if (a.type === 'swap') {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, cell * 0.08); ctx.globalAlpha = 0.95;
      for (const p of [a.a, a.b]) { rr(ctx, cx(p.x) + 2, cy(p.y) + 2, cell - 4, cell - 4, 6); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx(a.a.x) + cell / 2, cy(a.a.y) + cell / 2);
      ctx.lineTo(cx(a.b.x) + cell / 2, cy(a.b.y) + cell / 2); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (a.type === 'place') {
      ctx.fillStyle = hexA('#ffffff', 0.85);
      ctx.beginPath(); ctx.arc(cx(a.x) + (a.tool === 'split' ? cell / 2 : 0), cy(a.y), Math.max(2, cell * 0.12), 0, Math.PI * 2); ctx.fill();
    }
  }
}

/* =====================================================================
   CLIMB RENDER (demo 2). Draws a VIEW-row window of the tall shaft at world
   offset camTop: the rising light band, decaying gems (dim in the dark, faint
   when dying), the Glitterdelve floor, the Source, and the climb pieces.
   ===================================================================== */
export function drawClimb(ctx, state, rules, layout, camTop) {
  const { cell, ox, oy } = layout;
  const view = rules.view;
  const cxp = (x) => ox + x * cell;
  const ryp = (y) => oy + (y - camTop) * cell; // world row -> screen y
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // frame
  ctx.fillStyle = '#00000035';
  ctx.fillRect(ox - 4, oy - 4, cell * rules.cols + 8, cell * view + 8);

  // light band (full width up to the lens-raised ceiling; base band reads brighter)
  const ceil = climbLightCeiling(state);
  const base = rules.rows - rules.baseReach;
  for (let sy = 0; sy < view; sy++) {
    const y = camTop + sy;
    if (y < 0 || y >= rules.rows || y < ceil) continue;
    ctx.fillStyle = hexA(LIGHTC, y >= base ? 0.16 : 0.10);
    ctx.fillRect(cxp(0), ryp(y), cell * rules.cols, cell);
  }

  // faint grid
  ctx.strokeStyle = '#ffffff0c'; ctx.lineWidth = 1;
  for (let x = 0; x <= rules.cols; x++) { ctx.beginPath(); ctx.moveTo(cxp(x), oy); ctx.lineTo(cxp(x), oy + cell * view); ctx.stroke(); }
  for (let sy = 0; sy <= view; sy++) { ctx.beginPath(); ctx.moveTo(ox, oy + sy * cell); ctx.lineTo(ox + cell * rules.cols, oy + sy * cell); ctx.stroke(); }

  // Glitterdelve floor (if the bottom is in view)
  if (rules.rows - 1 >= camTop && rules.rows - 1 < camTop + view) {
    const fy = ryp(rules.rows - 1);
    ctx.fillStyle = '#e8c14a'; ctx.fillRect(ox - 4, fy + cell - 3, cell * rules.cols + 8, 6);
  }
  // The Source (if the top is in view) — glows pink when revealed (won)
  if (camTop <= 0) {
    ctx.fillStyle = state.won ? '#ff6b9d' : '#3a2a52';
    ctx.fillRect(ox - 4, ryp(0) - 12, cell * rules.cols + 8, 10);
  }

  // gems: full alpha when lit, dimmed when dark, faint when about to break
  for (let sy = 0; sy < view; sy++) {
    const y = camTop + sy;
    if (y < 0 || y >= rules.rows) continue;
    for (let x = 0; x < rules.cols; x++) {
      const c = state.grid[y][x];
      if (c === EMPTY) continue;
      const lit = climbIsLit(state, x, y);
      const dying = state.life[y][x] <= 1;
      ctx.globalAlpha = dying ? 0.3 : (lit ? 1 : 0.5);
      drawGem(ctx, cxp(x), ryp(y), cell, c, cell >= 18);
      ctx.globalAlpha = 1;
    }
  }

  drawClimbPieces(ctx, state, rules, layout, camTop);
}

function drawClimbPieces(ctx, state, rules, layout, camTop) {
  const { cell, ox } = layout;
  const cxp = (x) => ox + x * cell;
  const ryp = (y) => layout.oy + (y - camTop) * cell;
  const get = (id) => state.pieces.get(id) || new Map();
  const inView = (y) => y >= camTop && y < camTop + rules.view + 1;

  // Walls (horizontal seam)
  for (const key of get('dam').keys()) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    if (!inView(y)) continue;
    ctx.strokeStyle = DAMC; ctx.lineWidth = Math.max(2, cell * 0.09); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cxp(x) + 3, ryp(y)); ctx.lineTo(cxp(x) + cell - 3, ryp(y)); ctx.stroke();
  }
  // Lenses (double bar; drawn dashed-ish to read as fragile)
  for (const key of get('amp').keys()) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    if (!inView(y)) continue;
    ctx.strokeStyle = AMPC; ctx.lineWidth = Math.max(1.5, cell * 0.06); ctx.lineCap = 'butt';
    ctx.setLineDash([Math.max(3, cell * 0.14), Math.max(2, cell * 0.08)]);
    ctx.beginPath(); ctx.moveTo(cxp(x) + 3, ryp(y) - 2); ctx.lineTo(cxp(x) + cell - 3, ryp(y) - 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cxp(x) + 3, ryp(y) + 2); ctx.lineTo(cxp(x) + cell - 3, ryp(y) + 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  // Swappers (vertical seam)
  for (const key of get('swap').keys()) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    if (!inView(y)) continue;
    ctx.strokeStyle = SWAPC; ctx.lineWidth = Math.max(2, cell * 0.09); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cxp(x), ryp(y) + 3); ctx.lineTo(cxp(x), ryp(y) + cell - 3); ctx.stroke();
  }
  // Splitters (downward fork chevron in a cell)
  for (const [key, p] of get('split')) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    if (!inView(y)) continue;
    const m = cell / 2, dir = p && p.dir ? p.dir : 1;
    ctx.strokeStyle = SPLITC; ctx.lineWidth = Math.max(2, cell * 0.07); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cxp(x) + m, ryp(y) + cell * 0.18);
    ctx.lineTo(cxp(x) + m, ryp(y) + cell * 0.55);
    ctx.lineTo(cxp(x) + m + dir * cell * 0.28, ryp(y) + cell * 0.82);
    ctx.moveTo(cxp(x) + m, ryp(y) + cell * 0.55);
    ctx.lineTo(cxp(x) + m, ryp(y) + cell * 0.82);
    ctx.stroke();
  }
  // Slopes (a solid ramp triangle pointing the push direction)
  for (const [key, p] of get('slope')) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    if (!inView(y)) continue;
    const dir = p && p.dir ? p.dir : 1;
    const x0 = cxp(x) + cell * 0.15, x1 = cxp(x) + cell * 0.85, yb = ryp(y) + cell * 0.8, yt = ryp(y) + cell * 0.25;
    ctx.fillStyle = hexA(SLOPEC, 0.85);
    ctx.beginPath();
    if (dir > 0) { ctx.moveTo(x0, yb); ctx.lineTo(x1, yb); ctx.lineTo(x1, yt); }
    else { ctx.moveTo(x1, yb); ctx.lineTo(x0, yb); ctx.lineTo(x0, yt); }
    ctx.closePath(); ctx.fill();
  }
}

export { COLORS };

/* =====================================================================
   RENDER  (browser only)

   Canvas drawing for a board, adapted from demo.html's draw() but pure: it
   takes (ctx, view, rules, layout, opts) and draws — no globals, no input.
   `view` is anything with {grid, litCols, pieces:Map<toolId,Map>, fading:Set};
   both a live engine state and viewFromSnapshot(...) satisfy that. Used for
   gallery thumbnails AND the full replay viewer, so the sim looks like the game.
   ===================================================================== */
import { lightReach } from './engine.js';
import { brightCeiling, dimCeiling, isBright, crackStage } from './climb-engine.js';

// palette copied from demo.html's :root so render is self-contained
const COLORS = ['#e0496b', '#3fb6d3', '#5dd36a', '#f2b134', '#9b6cf0', '#ec6fb0'];
const DAMC = '#c9a227', SWAPC = '#5fe0d0', SPLITC = '#ff8a4c', AMPC = '#ffe14d', LIGHTC = '#fff2a8';
const SLOPEC = '#7fd49a';
// climb piece palette
const RAMPC = '#7fd49a', SORTERC = '#c08bff', CONVC = '#5fb8e0';
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
   CLIMB RENDER (demo 2). The whole shaft is on screen (rows == view, no scroll).
   Per-column three-tier light: bright (warm, gems glow "prime"), dim (hazy,
   buildable, gems crack as they decay), dark (an opaque void — gems hidden, the
   "where's it coming from" mystery). Plus a placement overlay (dots + ghost).
   ===================================================================== */
export function drawClimb(ctx, state, rules, layout, overlay) {
  const { cell, ox, oy } = layout;
  const cols = rules.cols, rows = rules.rows;
  const cxp = (x) => ox + x * cell;
  const ryp = (y) => oy + y * cell;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // per-column light heights
  const bc = [], dc = [];
  for (let x = 0; x < cols; x++) { bc[x] = brightCeiling(state, x); dc[x] = dimCeiling(state, x); }

  // frame
  ctx.fillStyle = '#00000040';
  ctx.fillRect(ox - 4, oy - 4, cell * cols + 8, cell * rows + 8);

  // bright + dim bands, per column
  for (let x = 0; x < cols; x++) {
    if (bc[x] <= rows - 1) {
      const g = ctx.createLinearGradient(0, ryp(bc[x]), 0, ryp(rows));
      g.addColorStop(0, hexA(LIGHTC, 0.10)); g.addColorStop(1, hexA(LIGHTC, 0.22));
      ctx.fillStyle = g; ctx.fillRect(cxp(x), ryp(bc[x]), cell, (rows - bc[x]) * cell);
    }
    if (dc[x] < bc[x]) { ctx.fillStyle = hexA('#7c8fd0', 0.07); ctx.fillRect(cxp(x), ryp(dc[x]), cell, (bc[x] - dc[x]) * cell); }
  }

  // faint grid (covered by the dark veil where it's dark)
  ctx.strokeStyle = '#ffffff0c'; ctx.lineWidth = 1;
  for (let x = 0; x <= cols; x++) { ctx.beginPath(); ctx.moveTo(cxp(x), oy); ctx.lineTo(cxp(x), oy + cell * rows); ctx.stroke(); }
  for (let y = 0; y <= rows; y++) { ctx.beginPath(); ctx.moveTo(ox, oy + y * cell); ctx.lineTo(ox + cell * cols, oy + y * cell); ctx.stroke(); }

  // dark veil per column (opaque void above the dim frontier)
  for (let x = 0; x < cols; x++) {
    if (dc[x] <= 0) continue;
    const g = ctx.createLinearGradient(0, ryp(0), 0, ryp(dc[x]));
    g.addColorStop(0, hexA('#0b0814', 0.97)); g.addColorStop(1, hexA('#0b0814', 0.82));
    ctx.fillStyle = g; ctx.fillRect(cxp(x), ryp(0), cell, dc[x] * cell);
  }
  // bright-frontier accent line per column (your safe line)
  ctx.lineWidth = Math.max(1, cell * 0.04); ctx.lineCap = 'round';
  for (let x = 0; x < cols; x++) {
    if (bc[x] <= 0 || bc[x] >= rows) continue;
    ctx.strokeStyle = hexA(LIGHTC, 0.5);
    ctx.beginPath(); ctx.moveTo(cxp(x) + 2, ryp(bc[x])); ctx.lineTo(cxp(x) + cell - 2, ryp(bc[x])); ctx.stroke();
  }

  // Glitterdelve floor
  ctx.fillStyle = '#e8c14a'; ctx.fillRect(ox - 4, ryp(rows - 1) + cell - 3, cell * cols + 8, 6);
  // The Source (top) — a faint glimmer, blazing pink when reached (won)
  const sg = ctx.createLinearGradient(0, oy - 14, 0, oy + 6);
  sg.addColorStop(0, state.won ? '#ff6b9d' : hexA('#caa6ff', 0.55)); sg.addColorStop(1, 'transparent');
  ctx.fillStyle = sg; ctx.fillRect(ox - 4, oy - 14, cell * cols + 8, 20);

  // gems — dark cells are invisible; bright gems glow; dim gems crack as they decay
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = state.grid[y][x];
      if (c === EMPTY || y < dc[x]) continue; // dark = hidden
      const sx = cxp(x), sy = ryp(y);
      if (y >= bc[x]) { // bright / prime
        ctx.save();
        ctx.shadowColor = hexA(COLORS[c % COLORS.length], 0.95); ctx.shadowBlur = cell * 0.45;
        drawGem(ctx, sx, sy, cell, c, cell >= 16);
        ctx.restore();
      } else { // dim / at risk
        ctx.globalAlpha = 0.8; drawGem(ctx, sx, sy, cell, c, cell >= 16); ctx.globalAlpha = 1;
        const st = crackStage(state, x, y);
        if (st > 0) drawCracks(ctx, sx, sy, cell, st);
      }
    }
  }

  drawClimbPieces(ctx, state, rules, layout);
  if (overlay && overlay.tool) drawClimbOverlay(ctx, state, rules, layout, overlay, bc, dc);
}

/* Jagged dark fractures over a decaying gem; a red rim once it's near shatter. */
function drawCracks(ctx, sx, sy, cell, st) {
  const cx = sx + cell / 2, cy = sy + cell / 2, r = cell * 0.34;
  ctx.strokeStyle = `rgba(8,5,12,${0.35 + 0.5 * st})`; ctx.lineWidth = Math.max(1, cell * 0.045); ctx.lineJoin = 'round';
  const ang = [-0.4, 1.9, 3.4];
  for (let i = 0; i < ang.length; i++) {
    const a = ang[i];
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55);
    ctx.lineTo(cx + Math.cos(a + 0.5) * r, cy + Math.sin(a + 0.5) * r);
    ctx.stroke();
  }
  if (st > 0.5) {
    ctx.strokeStyle = `rgba(255,96,96,${(st - 0.5) * 1.4})`; ctx.lineWidth = Math.max(1.5, cell * 0.06);
    rr(ctx, sx + cell * 0.14, sy + cell * 0.14, cell * 0.72, cell * 0.72, cell * 0.18); ctx.stroke();
  }
}

function drawClimbPieces(ctx, state, rules, layout) {
  const { cell, ox, oy } = layout;
  const cxp = (x) => ox + x * cell, ryp = (y) => oy + y * cell;
  const get = (id) => state.pieces.get(id) || new Map();

  // Walls (horizontal seam)
  for (const key of get('dam').keys()) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    ctx.strokeStyle = DAMC; ctx.lineWidth = Math.max(2, cell * 0.11); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cxp(x) + 3, ryp(y)); ctx.lineTo(cxp(x) + cell - 3, ryp(y)); ctx.stroke();
  }
  // Lenses (dashed double bar — reads as fragile)
  for (const key of get('amp').keys()) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    ctx.save();
    ctx.shadowColor = hexA(AMPC, 0.8); ctx.shadowBlur = cell * 0.3;
    ctx.strokeStyle = AMPC; ctx.lineWidth = Math.max(1.5, cell * 0.07); ctx.lineCap = 'butt';
    ctx.setLineDash([Math.max(3, cell * 0.16), Math.max(2, cell * 0.09)]);
    ctx.beginPath(); ctx.moveTo(cxp(x) + 3, ryp(y) - 2); ctx.lineTo(cxp(x) + cell - 3, ryp(y) - 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cxp(x) + 3, ryp(y) + 2); ctx.lineTo(cxp(x) + cell - 3, ryp(y) + 2); ctx.stroke();
    ctx.restore();
  }
  // Ramps (solid wedge sloping toward the push direction)
  for (const [key, p] of get('ramp')) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    drawWedge(ctx, cxp(x), ryp(y), cell, (p && p.dir) || 1, RAMPC);
  }
  // Sorters (a colour funnel: target colour drops through, the rest kicked aside)
  for (const [key, p] of get('sorter')) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    const dir = (p && p.dir) || 1, tc = (p && p.tc) | 0;
    drawSorter(ctx, cxp(x), ryp(y), cell, dir, tc);
  }
  // Conveyors (a belt of chevrons pointing the carry direction)
  for (const [key, p] of get('conveyor')) {
    const ci = key.indexOf(','); const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    const dir = (p && p.dir) || 1;
    ctx.strokeStyle = CONVC; ctx.lineWidth = Math.max(1.5, cell * 0.06); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const yb = ryp(y) + cell - 4;
    ctx.fillStyle = hexA(CONVC, 0.16); ctx.fillRect(cxp(x) + 2, yb - 4, cell - 4, 6);
    for (let i = 0; i < 3; i++) {
      const bx = cxp(x) + cell * (0.3 + i * 0.2);
      ctx.beginPath();
      ctx.moveTo(bx - dir * cell * 0.06, yb - cell * 0.12);
      ctx.lineTo(bx + dir * cell * 0.06, yb - cell * 0.06);
      ctx.lineTo(bx - dir * cell * 0.06, yb); ctx.stroke();
    }
  }
}

/* a colour funnel: a V that drops the target colour straight down, with a small
   arrow showing where other colours are kicked */
function drawSorter(ctx, sx, sy, cell, dir, tc) {
  const m = sx + cell / 2;
  ctx.strokeStyle = SORTERC; ctx.lineWidth = Math.max(1.5, cell * 0.07); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); // funnel walls
  ctx.moveTo(sx + cell * 0.16, sy + cell * 0.2); ctx.lineTo(m - cell * 0.1, sy + cell * 0.62);
  ctx.moveTo(sx + cell * 0.84, sy + cell * 0.2); ctx.lineTo(m + cell * 0.1, sy + cell * 0.62);
  ctx.stroke();
  // target-colour core falling through the throat
  ctx.fillStyle = COLORS[tc % COLORS.length];
  ctx.beginPath(); ctx.arc(m, sy + cell * 0.74, Math.max(2.5, cell * 0.12), 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = hexA('#ffffff', 0.55); ctx.lineWidth = 1; ctx.stroke();
  // reject arrow
  ctx.strokeStyle = hexA(SORTERC, 0.8); ctx.lineWidth = Math.max(1, cell * 0.05);
  const ax = m + dir * cell * 0.34, ay = sy + cell * 0.34;
  ctx.beginPath(); ctx.moveTo(m + dir * cell * 0.18, ay); ctx.lineTo(ax, ay);
  ctx.moveTo(ax, ay); ctx.lineTo(ax - dir * cell * 0.08, ay - cell * 0.06);
  ctx.moveTo(ax, ay); ctx.lineTo(ax - dir * cell * 0.08, ay + cell * 0.06); ctx.stroke();
}

/* a filled right-triangle wedge: the vertical (high) face is on the push side */
function drawWedge(ctx, sx, sy, cell, dir, color) {
  const x0 = sx + cell * 0.12, x1 = sx + cell * 0.88, yb = sy + cell * 0.86, yt = sy + cell * 0.16;
  ctx.fillStyle = hexA(color, 0.9);
  ctx.beginPath();
  if (dir > 0) { ctx.moveTo(x0, yb); ctx.lineTo(x1, yb); ctx.lineTo(x1, yt); }
  else { ctx.moveTo(x1, yb); ctx.lineTo(x0, yb); ctx.lineTo(x0, yt); }
  ctx.closePath(); ctx.fill();
}

/* Placement overlay: green dots/ticks on every legal spot for the selected tool
   (only in the buildable, lit zone — so the dots ARE the build-zone signal), and
   a ghost of the piece under the cursor. */
function drawClimbOverlay(ctx, state, rules, layout, overlay, bc, dc) {
  const { cell, ox, oy } = layout;
  const cxp = (x) => ox + x * cell, ryp = (y) => oy + y * cell;
  const cols = rules.cols, rows = rules.rows;
  const t = rules.tools.find((tt) => tt.id === overlay.tool);
  if (!t) return;
  const DOT = hexA('#7ef0a8', 0.5);

  if (t.kind === 'action') { // Bomb: ring the hovered gem
    const h = overlay.hover;
    if (h && h.kind === 'cell' && state.grid[h.y] && state.grid[h.y][h.x] !== EMPTY) {
      ctx.strokeStyle = hexA('#ff6b6b', 0.85); ctx.lineWidth = Math.max(2, cell * 0.06);
      rr(ctx, cxp(h.x) + 3, ryp(h.y) + 3, cell - 6, cell - 6, 6); ctx.stroke();
    }
    return;
  }

  if (t.extendsLight) { // Lens — one rung per column, at its bright edge
    for (let x = 0; x < cols; x++) {
      if (bc[x] < 1) continue;             // column already reaches the Source
      const y = bc[x];
      ctx.fillStyle = hexA(AMPC, 0.7);
      ctx.beginPath(); ctx.arc(cxp(x) + cell * 0.5, ryp(y), Math.max(2, cell * 0.08), 0, Math.PI * 2); ctx.fill();
    }
    const h = overlay.hover;
    if (h && h.kind === 'seam' && bc[h.x] >= 1) {
      ctx.strokeStyle = hexA(AMPC, 0.9); ctx.lineWidth = Math.max(2, cell * 0.1); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cxp(h.x) + 3, ryp(bc[h.x])); ctx.lineTo(cxp(h.x) + cell - 3, ryp(bc[h.x])); ctx.stroke();
    }
    return;
  }
  if (t.seam === 'horizontal') { // Wall — ticks on buildable seams
    for (let x = 0; x < cols; x++)
      for (let y = 1; y < rows; y++) {
        if (y < dc[x]) continue; // dark
        ctx.fillStyle = DOT; ctx.fillRect(cxp(x) + cell * 0.5 - 1.5, ryp(y) - 1.5, 3, 3);
      }
    const h = overlay.hover;
    if (h && h.kind === 'seam' && h.y >= 1 && h.y < rows && h.y >= dc[h.x]) {
      ctx.strokeStyle = hexA(DAMC, 0.85); ctx.lineWidth = Math.max(2, cell * 0.1); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cxp(h.x) + 3, ryp(h.y)); ctx.lineTo(cxp(h.x) + cell - 3, ryp(h.y)); ctx.stroke();
    }
    return;
  }

  // cell pieces (ramp / sorter / conveyor) — dots on buildable empty cells
  for (let x = 0; x < cols; x++)
    for (let y = 0; y < rows; y++) {
      if (y < dc[x]) continue;
      if (state.grid[y][x] !== EMPTY) continue;
      ctx.fillStyle = DOT;
      ctx.beginPath(); ctx.arc(cxp(x) + cell / 2, ryp(y) + cell / 2, Math.max(1.5, cell * 0.06), 0, Math.PI * 2); ctx.fill();
    }
  const h = overlay.hover;
  if (h && h.kind === 'cell' && h.x >= 0 && h.x < cols && h.y >= 0 && h.y < rows && h.y >= dc[h.x] && state.grid[h.y][h.x] === EMPTY) {
    ctx.globalAlpha = 0.55;
    if (t.id === 'conveyor') { ctx.fillStyle = hexA(CONVC, 0.4); ctx.fillRect(cxp(h.x) + 2, ryp(h.y) + cell - 8, cell - 4, 6); }
    else if (t.id === 'sorter') drawSorter(ctx, cxp(h.x), ryp(h.y), cell, overlay.dir || 1, 0);
    else drawWedge(ctx, cxp(h.x), ryp(h.y), cell, overlay.dir || 1, RAMPC);
    ctx.globalAlpha = 1;
  }
}

export { COLORS };

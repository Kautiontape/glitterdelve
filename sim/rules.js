/* =====================================================================
   DEFAULT RULESET + TOOL REGISTRY

   This is the single source of truth for "what the game is". Changing a
   number here (or via makeRules overrides) re-tunes the engine, the CLI,
   and the web viewer at once — they all consume this.

   ADDING / CHANGING A TOOL: add an entry to TOOLS. Declare which simulation
   phase it hooks into via capability flags/methods (see comments below). The
   engine dispatches generically — no other file needs to change, and the web
   toolbar is built from this list too.
   ===================================================================== */

/* Each tool is plain data + optional behavior hooks. Recognized fields:
     id        unique string
     name      display name
     icon      single glyph for UI
     seam      'horizontal' | 'vertical' | 'cell'  (where it lives / how placed)
     kind      'action' => not placed; invoked by the agent (e.g. Cut)
     blocksFall    truthy => gems can't fall through the seam above its cell
     extendsLight  {reach:N} or {rule:'ampReach'} => relays light downward
     divert        truthy (+ seam:'cell') => diverts every other falling gem;
                   its piece payload is {dir:+1|-1, flip:false}
     validate(state,pos,H) -> bool   placement legality
     tick(state, ownPieceMap, H)     runs in the 'machines' phase each tick */
export const TOOLS = [
  {
    id: 'move',
    name: 'Cut',
    icon: '✥',
    kind: 'action', // the player swap; emitted by the agent as {type:'swap',a,b}
  },
  {
    id: 'dam',
    name: 'Wall',
    icon: '▬',
    seam: 'horizontal',
    blocksFall: true,
    validate: (s, p) => p.x >= 0 && p.x < s.rules.cols && p.y >= 1 && p.y < s.rules.rows,
  },
  {
    id: 'swap',
    name: 'Sorter',
    icon: '⇄',
    seam: 'vertical',
    validate: (s, p) => p.x >= 1 && p.x < s.rules.cols && p.y >= 0 && p.y < s.rules.rows,
    // each tick, swap the two gems across the seam ONLY if it makes a match
    tick: (s, map, H) => {
      const g = s.grid;
      for (const key of map.keys()) {
        const [x, y] = key.split(',').map(Number); // seam between (x-1,y) and (x,y)
        const ax = x - 1, ay = y, bx = x, by = y;
        if (!H.inBounds(s, ax, ay) || !H.inBounds(s, bx, by)) continue;
        const a = g[ay][ax], b = g[by][bx];
        if (a === H.EMPTY || b === H.EMPTY || a === b) continue;
        g[ay][ax] = b; g[by][bx] = a; // try it
        if (H.matchesAt(s, ax, ay).size > 0 || H.matchesAt(s, bx, by).size > 0) {
          // keep; resolveBoard will clear it
        } else { g[ay][ax] = a; g[by][bx] = b; } // revert
      }
    },
  },
  {
    id: 'split',
    name: 'Fork',
    icon: '⋔',
    seam: 'cell',
    divert: true,
    validate: (s, p, H) => H.inBounds(s, p.x, p.y),
  },
  {
    id: 'amp',
    name: 'Lens',
    icon: '≣',
    seam: 'horizontal',
    blocksFall: true,
    extendsLight: { rule: 'ampReach' },
    // valid where the seam sits within the column's POTENTIAL reach
    validate: (s, p, H) =>
      p.x >= 0 && p.x < s.rules.cols && p.y >= 1 && p.y < s.rules.rows && p.y - 1 <= H.potentialReach(s, p.x),
  },
];

export const DEFAULT_RULES = {
  cols: 9,
  rows: 14,
  ncol: 6, // number of gem colors
  baseReach: 4, // cells of light a charged (non-anchor) column projects
  anchor: 4, // the infinite center column
  ampReach: 4, // cells of light a Lens relays downward
  tickOrder: ['machines', 'resolve', 'gravity', 'spawn', 'resolve'],
  tools: TOOLS,
};

/* Build a ruleset from scalar overrides. Tools/tickOrder fall back to defaults.
   Overrides are plain JSON (cols, rows, ncol, baseReach, anchor, ampReach), so
   they serialize cleanly into replay recipes and CLI --rules files. */
export function makeRules(overrides = {}) {
  const r = Object.assign({}, DEFAULT_RULES, overrides);
  r.tools = overrides.tools || DEFAULT_RULES.tools;
  r.tickOrder = overrides.tickOrder || DEFAULT_RULES.tickOrder.slice();
  return r;
}

/* =====================================================================
   CLIMB MODE ("The Climb") — demo 2 ruleset + tool registry.
   Bottom-anchored rising light, per-fall decay, energy economy. Consumed
   by climb-engine.js / climb.js. DEFAULT_RULES/TOOLS above are untouched.
   ===================================================================== */
/* Tools are routing/light pieces — there is no manual matcher. Matches emerge
   when a built machine herds like colours into a lit column. Ramps and sorters
   are SOLID wedges (gems can't rest inside; they deflect on entry — the fix for
   the old "slope swallows the gem" stall). Conveyor is a floor tag. Lens is a
   per-column light relay. */
export const CLIMB_TOOLS = [
  { id: 'bomb', name: 'Bomb', icon: '✸', kind: 'action' }, // destroys one gem; free
  {
    id: 'dam', name: 'Wall', icon: '▬', seam: 'horizontal', blocksFall: true,
    validate: (s, p, H) => p.x >= 0 && p.x < s.rules.cols && p.y >= 1 && p.y < s.rules.rows && H.isBuildable(s, p.x, p.y),
  },
  {
    id: 'ramp', name: 'Ramp', icon: '◣', seam: 'cell', wedge: true, dirPiece: true,
    // a solid wedge: a gem entering from above is deflected to (x+dir, y); chains
    validate: (s, p, H) => H.inBounds(s, p.x, p.y) && H.isBuildable(s, p.x, p.y) && s.grid[p.y][p.x] === H.EMPTY,
  },
  {
    id: 'sorter', name: 'Sorter', icon: '⧖', seam: 'cell', sorter: true, dirPiece: true,
    // a colour FILTER (not solid): the target colour falls straight through into the
    // lane below; every other colour is kicked aside to (x+dir). One sorter over a
    // column makes a pure-colour lane that matches on its own.
    validate: (s, p, H) => H.inBounds(s, p.x, p.y) && H.isBuildable(s, p.x, p.y) && s.grid[p.y][p.x] === H.EMPTY,
  },
  {
    id: 'conveyor', name: 'Conveyor', icon: '⇶', seam: 'cell', conveyor: true, dirPiece: true,
    // carries a RESTING gem one cell/tick toward dir; needs support under it
    validate: (s, p, H) => H.inBounds(s, p.x, p.y) && H.isBuildable(s, p.x, p.y),
  },
  {
    id: 'amp', name: 'Lens', icon: '≣', seam: 'horizontal', extendsLight: { rule: 'lensReach' },
    // sturdy light relay: gems fall straight through it; it raises THIS column's
    // bright light by lensReach. It only works at the column's current bright edge
    // (the one "fed" seam), so that's the only legal spot — climb it rung by rung.
    validate: (s, p, H) => p.x >= 0 && p.x < s.rules.cols && p.y >= 1 && p.y === H.brightCeiling(s, p.x),
  },
];

export const CLIMB_RULES = {
  cols: 9,
  rows: 16,          // shaft height (fully visible: rows == view, no camera scroll)
  ncol: 5,           // gem colours — few, so same-colour lanes match readily
  baseReach: 5,      // bright rows above the floor at the start (per column)
  dimBand: 3,        // dim rows above each column's bright ceiling (buildable, gems decay)
  lensReach: 3,      // rows a fed Lens raises ITS column's bright ceiling (per column)
  // Decay is the "settle beat": falling gems never decay; a gem that comes to REST
  // in a non-bright cell sits `settle` ticks, then cracks over `crack` ticks, then
  // shatters. Bright is safe. Overflow at the base drains (stepFloorDrain) instead
  // of dying, so losses only come from gems parked unlit on a raised structure.
  settle: 3,         // ticks a rested gem sits intact before it starts cracking
  crack: 4,          // ticks of visible cracking before it shatters
  floorHarvest: 0,   // energy the delve gives per absorbed overflow gem (0 = pure relief valve)
  initDensity: 0,    // start empty — watch the shaft rain in (grasp the source)
  spawnDensity: 0.12,// chance the Source emits into an empty top cell each tick
  startGrant: 30,    // starting energy — enough for a starter machine
  view: 16,          // rows visible (== rows)
  costs: { bomb: 0, dam: 2, ramp: 2, sorter: 5, conveyor: 3, amp: 8 },
  scoring: { 3: 4, 4: 10, 5: 24 }, // base energy per BRIGHT run of N (then +8/extra)
  comboCap: 4,       // max extra spree multiplier steps (×1 → ×5)
  tickMs: 480,       // default ms per tick (front-end pacing)
  tickOrder: ['machines', 'resolve', 'gravity', 'decay', 'spawn', 'resolve', 'floor'], // informational
  tools: CLIMB_TOOLS,
};

/* Build a climb ruleset from scalar overrides. tools/costs/scoring/tickOrder fall
   back to the climb defaults. */
export function makeClimbRules(overrides = {}) {
  const r = Object.assign({}, CLIMB_RULES, overrides);
  r.tools = overrides.tools || CLIMB_RULES.tools;
  r.costs = overrides.costs || CLIMB_RULES.costs;
  r.scoring = overrides.scoring || CLIMB_RULES.scoring;
  r.tickOrder = overrides.tickOrder || CLIMB_RULES.tickOrder.slice();
  return r;
}

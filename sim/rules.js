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

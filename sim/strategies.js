/* =====================================================================
   STRATEGIES (agents)

   An agent decides what the "player" does. Once per tick (before the world
   advances) the runner calls agent.act(state, api) and applies the returned
   actions. Actions:
     {type:'swap',  a:{x,y}, b:{x,y}}        the Cut move
     {type:'place', tool, x, y, dir?}        build a piece
     {type:'remove',tool, x, y}              remove a piece

   The `api` (built by the runner) exposes read helpers + a SEPARATE seeded RNG
   so agent randomness is reproducible and independent of the game RNG:
     api.rng()                 -> [0,1)
     api.rules                 -> the active ruleset
     api.findMatchingSwaps(s)  -> legal Cut moves [{a,b,size,lit}]
     api.isLit(s,x,y), api.lightReach(s,cx)

   ADDING A STRATEGY: add an entry to STRATEGIES. factory(config) returns an
   object with act(state, api). Anything registered here shows up in the CLI
   (--strategies) and the web viewer automatically.
   ===================================================================== */

/* pick the best legal Cut: prefer ones that actually score (lit), then bigger */
function bestCut(state, api) {
  const sw = api.findMatchingSwaps(state);
  if (!sw.length) return null;
  sw.sort((p, q) => q.lit - p.lit || q.size - p.size);
  return { type: 'swap', a: sw[0].a, b: sw[0].b };
}

export const STRATEGIES = {
  noop: {
    label: 'Do nothing',
    note: 'Baseline — only the anchor heartbeat scores.',
    factory: () => ({ act: () => [] }),
  },

  greedyCut: {
    label: 'Greedy cut',
    note: 'Each tick, make the best adjacent swap that completes a (preferably lit) match.',
    factory: () => ({
      act(state, api) {
        const c = bestCut(state, api);
        return c ? [c] : [];
      },
    }),
  },

  staticBuild: {
    label: 'Static build',
    note: 'Place a fixed list of pieces at t=0, then optionally greedy-cut. config: {plan:[{tool,x,y,dir}], thenGreedy:bool}',
    factory: (cfg = {}) => {
      let placed = false;
      return {
        act(state, api) {
          const acts = [];
          if (!placed) {
            placed = true;
            for (const p of cfg.plan || []) acts.push({ type: 'place', tool: p.tool, x: p.x, y: p.y, dir: p.dir });
          }
          if (cfg.thenGreedy !== false) {
            const c = bestCut(state, api);
            if (c) acts.push(c);
          }
          return acts;
        },
      };
    },
  },

  autoSorters: {
    label: 'Auto sorters + cut',
    note: 'Line vertical seams in the central lit band with Sorters (auto-harvesters), then greedy-cut. config: {seams:[x], rows:[y]}',
    factory: (cfg = {}) => {
      let placed = false;
      return {
        act(state, api) {
          const acts = [];
          if (!placed) {
            placed = true;
            const R = state.rules;
            const seams = cfg.seams || [R.anchor, R.anchor + 1, R.anchor + 2];
            const rows = cfg.rows || [2, 3, 4, 5, 6];
            for (const x of seams)
              for (const y of rows)
                if (x >= 1 && x < R.cols && y >= 0 && y < R.rows) acts.push({ type: 'place', tool: 'swap', x, y });
          }
          const c = bestCut(state, api);
          if (c) acts.push(c);
          return acts;
        },
      };
    },
  },

  randomCut: {
    label: 'Random cut',
    note: 'Make a random legal match each tick (uses the agent RNG). A noisy lower bound on cutting.',
    factory: () => ({
      act(state, api) {
        const sw = api.findMatchingSwaps(state);
        if (!sw.length) return [];
        const pick = sw[Math.floor(api.rng() * sw.length)];
        return [{ type: 'swap', a: pick.a, b: pick.b }];
      },
    }),
  },
};

export function strategyIds() {
  return Object.keys(STRATEGIES);
}

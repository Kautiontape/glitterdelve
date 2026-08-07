/* Quick balance probe for the Climb. Run: node climb-balance.js
   Not a test — it prints economy numbers so we can tune costs/pacing/decay.
   Asks: does the base loop earn passively without melting everything to the
   dark, and is a lens ladder affordable in a reasonable session? */
import { makeClimbRules } from './rules.js';
import { createClimbState, tickClimb, placeClimb, brightCeiling, frontier, EMPTY } from './climb-engine.js';

function pileReach(s) { // highest occupied row per column (smaller = taller pile)
  const R = s.rules, out = [];
  for (let x = 0; x < R.cols; x++) { let top = R.rows; for (let y = 0; y < R.rows; y++) if (s.grid[y][x] !== EMPTY) { top = y; break; } out.push(top); }
  return out;
}
function run(label, over, ticks, build, seeds = [1, 2, 3, 4, 5]) {
  let H = 0, L = 0, D = 0, E = 0;
  for (const seed of seeds) {
    const R = makeClimbRules(over);
    const s = createClimbState(R, seed);
    if (build) build(s);
    for (let i = 0; i < ticks; i++) tickClimb(s);
    H += s.harvested; L += s.lost; D += s.drained; E += s.energy;
  }
  const n = seeds.length;
  console.log(`${label.padEnd(26)} harvested=${(H / n).toFixed(0).padStart(4)}  drained=${(D / n).toFixed(0).padStart(4)}  lost(unlit)=${(L / n).toFixed(0).padStart(3)}  energy=${(E / n).toFixed(0).padStart(4)}`);
}

console.log('Glitterdelve CLIMB balance probe over 600 ticks (5 seeds)\n');
console.log('Goal: base is CALM (overflow drains, not dies), passive harvest is alive,');
console.log('and building a colour lane clearly out-earns doing nothing.\n');

// no build: gentle base — overflow should DRAIN, with little/no unlit loss.
run('no build (defaults)', {}, 600);

// a colour lane: wall a column, sorters in the two neighbours push colour 0 in.
const laneBuild = (s) => {
  const R = s.rules, base = R.rows - R.baseReach, lane = 4;
  // sorters at the dim frontier on each side, target colour 0 pointed at the lane
  placeClimb(s, 'sorter', { x: lane - 1, y: base - 1, tc: 0, dir: 1 });
  placeClimb(s, 'sorter', { x: lane + 1, y: base - 1, tc: 0, dir: -1 });
  placeClimb(s, 'sorter', { x: lane - 2, y: base - 1, tc: 0, dir: 1 });
  placeClimb(s, 'sorter', { x: lane + 2, y: base - 1, tc: 0, dir: -1 });
};
run('one colour lane', {}, 600, laneBuild);

// affordability of a lens ladder, no build
{
  const R = makeClimbRules();
  const s = createClimbState(R, 1);
  const cap = 1200;
  for (let i = 0; i < cap; i++) tickClimb(s);
  console.log(`\nafter ${cap} ticks (~${(cap * R.tickMs / 60000).toFixed(1)} min, no build): energy ${s.energy}, drained ${s.drained}, lost ${s.lost}`);
  console.log(`= ${Math.floor(s.energy / R.costs.amp)} lenses; a win column needs ~${Math.ceil((R.rows - R.baseReach) / R.lensReach)} (${Math.ceil((R.rows - R.baseReach) / R.lensReach) * R.costs.amp} energy).`);
}

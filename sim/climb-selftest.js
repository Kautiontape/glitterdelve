/* Climb-engine invariant checks. Run: node climb-selftest.js
   Exits non-zero on any failure. Mirrors selftest.js for the climb mode. */
import { makeClimbRules, CLIMB_TOOLS } from './rules.js';
import {
  createClimbState, tickClimb, stepGravityClimb, resolveClimb, stepSwappersClimb,
  stepSpawnClimb, placeClimb, removeClimb, bombClimb, costOf, isLit, litCeiling, EMPTY,
} from './climb-engine.js';
import { allMatches } from './engine.js';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}
function approx(name, a, b) { ok(`${name} (${a} === ${b})`, a === b); }

console.log('Glitterdelve CLIMB self-test\n');

/* 1. ruleset shape */
{
  const R = makeClimbRules();
  approx('climb has 6 tools', R.tools.length, 6);
  ok('bomb is a free action', R.tools[0].id === 'bomb' && R.tools[0].kind === 'action' && R.costs.bomb === 0);
  ok('lens (amp) does not block fall and is fragile', !R.tools.find((t) => t.id === 'amp').blocksFall && R.tools.find((t) => t.id === 'amp').fragile === true);
  ok('slope diverts every gem (always)', R.tools.find((t) => t.id === 'slope').always === true);
  ok('overrides apply (rows)', makeClimbRules({ rows: 40 }).rows === 40);
}

/* 2. createClimbState: deterministic shape, no free matches, frontier + grant set */
{
  const R = makeClimbRules();
  const s = createClimbState(R, 7);
  ok('grid is rows x cols', s.grid.length === R.rows && s.grid[0].length === R.cols);
  ok('life grid mirrors the gem grid', s.life.length === R.rows && s.life[5].length === R.cols);
  ok('starting energy is the grant', s.energy === R.startGrant);
  ok('total harvested starts at 0', s.harvested === 0);
  approx('frontier starts baseReach above the floor', s.frontier, R.rows - 1 - (R.baseReach - 1));
  ok('pre-fill leaves no free matches', allMatches(s).size === 0);
  let gems = 0; for (let y = 0; y < R.rows; y++) for (let x = 0; x < R.cols; x++) if (s.grid[y][x] !== EMPTY) gems++;
  ok('pre-fill placed some gems', gems > 0);
  ok('every gem has positive life', (() => { for (let y = 0; y < R.rows; y++) for (let x = 0; x < R.cols; x++) { if (s.grid[y][x] !== EMPTY && s.life[y][x] < 1) return false; } return true; })());
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
